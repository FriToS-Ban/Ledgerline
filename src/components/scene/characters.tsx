"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Shape,
  type Color,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type SpriteMaterial,
} from "three";
import { glowTexture } from "./glow";
import { readPalette } from "./palette";

/*
  The cast. Every buddy is built from a handful of three.js primitives with neon emissive
  materials and an additive glow sprite (fake bloom, no post-processing). Each one owns its
  idle personality in useFrame: blinking, waving, scanning, stamping. They are drawn facing
  the camera (+z) at roughly 1.4 world units tall.
*/

export type BuddyKind = "coin" | "invoice" | "shield" | "stamp";
export const BUDDIES: BuddyKind[] = ["coin", "invoice", "shield", "stamp"];

const HALF_PI = Math.PI / 2;

/** Cheap deterministic 0..1 noise for blink timing. */
function hash01(n: number) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

export function Glow({
  color,
  scale,
  opacity = 0.55,
  position = [0, 0, -0.3],
}: {
  color: Color;
  scale: number | [number, number];
  opacity?: number;
  position?: [number, number, number];
}) {
  const map = useMemo(() => glowTexture(), []);
  const s: [number, number, number] = Array.isArray(scale) ? [scale[0], scale[1], 1] : [scale, scale, 1];
  return (
    <sprite position={position} scale={s} renderOrder={-1}>
      <spriteMaterial
        map={map}
        color={color}
        transparent
        opacity={opacity}
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </sprite>
  );
}

/** Two cartoon eyes with a highlight that blink at a random cadence and glance around. */
function Eyes({ y, z, gap = 0.14, r = 0.078, seed = 0 }: { y: number; z: number; gap?: number; r?: number; seed?: number }) {
  const p = readPalette();
  const lids = useRef<Group>(null);
  const pupils = useRef<Group>(null);
  const nextBlink = useRef(1 + hash01(seed) * 2);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    let open = 1;
    const d = t - nextBlink.current;
    if (d > 0) {
      open = d < 0.07 ? 1 - d / 0.07 : d < 0.15 ? (d - 0.07) / 0.08 : 1;
      if (d >= 0.15) {
        // sometimes a double blink
        const r1 = hash01(t + seed);
        nextBlink.current = t + (r1 < 0.2 ? 0.18 : 2 + r1 * 3.5);
      }
    }
    if (lids.current) lids.current.scale.y = Math.max(0.08, open);
    if (pupils.current) {
      pupils.current.position.x = Math.sin(t * 0.7 + seed) * r * 0.28;
      pupils.current.position.y = Math.sin(t * 0.43 + seed * 2) * r * 0.18;
    }
  });

  return (
    <group position={[0, y, z]}>
      <group ref={lids}>
        {[-1, 1].map((sx) => (
          <group key={sx} position={[sx * gap, 0, 0]}>
            <mesh scale={[1, 1.15, 0.55]}>
              <sphereGeometry args={[r, 20, 14]} />
              <meshStandardMaterial color={p.text} emissive={p.text} emissiveIntensity={0.35} roughness={0.35} />
            </mesh>
          </group>
        ))}
        <group ref={pupils}>
          {[-1, 1].map((sx) => (
            <group key={sx} position={[sx * gap, 0, r * 0.42]}>
              <mesh scale={[1, 1.1, 0.5]}>
                <sphereGeometry args={[r * 0.55, 16, 12]} />
                <meshStandardMaterial color={p.void} roughness={0.2} metalness={0.1} />
              </mesh>
              <mesh position={[r * 0.18, r * 0.2, r * 0.3]}>
                <sphereGeometry args={[r * 0.17, 8, 6]} />
                <meshBasicMaterial color={p.text} toneMapped={false} />
              </mesh>
            </group>
          ))}
        </group>
      </group>
    </group>
  );
}

function Smile({ y, z, r = 0.12, tube = 0.024, color }: { y: number; z: number; r?: number; tube?: number; color: Color }) {
  return (
    <mesh position={[0, y, z]} rotation={[0, 0, Math.PI]}>
      <torusGeometry args={[r, tube, 8, 20, Math.PI]} />
      <meshStandardMaterial color={color} roughness={0.4} />
    </mesh>
  );
}

function Cheeks({ y, z, gap, color }: { y: number; z: number; gap: number; color: Color }) {
  return (
    <>
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * gap, y, z]}>
          <circleGeometry args={[0.055, 16]} />
          <meshBasicMaterial color={color} transparent opacity={0.55} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ coin buddy */

export function CoinBuddy({ seed = 0 }: { seed?: number }) {
  const p = readPalette();
  const body = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const sparkle = useRef<Group>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed;
    if (body.current) {
      body.current.rotation.y = Math.sin(t * 1.3) * 0.32;
      body.current.rotation.z = Math.sin(t * 0.9) * 0.06;
    }
    // right arm waves hello, left arm swings lazily
    if (armR.current) armR.current.rotation.z = -0.5 - Math.max(0, Math.sin(t * 2.2)) * 0.9 - Math.sin(t * 13) * 0.12;
    if (armL.current) armL.current.rotation.z = 0.45 + Math.sin(t * 1.7) * 0.18;
    if (sparkle.current) {
      sparkle.current.position.set(Math.cos(t * 1.6) * 0.82, 0.55 + Math.sin(t * 2.3) * 0.12, Math.sin(t * 1.6) * 0.4);
      sparkle.current.rotation.z = t * 2;
      const s = 0.6 + Math.abs(Math.sin(t * 3.1)) * 0.6;
      sparkle.current.scale.setScalar(s);
    }
  });

  return (
    <group>
      <Glow color={p.gold} scale={3.1} opacity={0.42} />
      <group ref={body}>
        <mesh rotation={[HALF_PI, 0, 0]}>
          <cylinderGeometry args={[0.62, 0.62, 0.18, 48]} />
          <meshStandardMaterial color={p.gold} emissive={p.amber} emissiveIntensity={0.55} metalness={0.55} roughness={0.28} />
        </mesh>
        {[0.095, -0.095].map((z) => (
          <mesh key={z} position={[0, 0, z]}>
            <torusGeometry args={[0.55, 0.045, 10, 48]} />
            <meshStandardMaterial color={p.gold} emissive={p.gold} emissiveIntensity={0.9} metalness={0.6} roughness={0.25} />
          </mesh>
        ))}
        <Eyes y={0.12} z={0.1} gap={0.17} r={0.09} seed={seed + 1} />
        <Smile y={-0.1} z={0.11} r={0.13} color={p.void} />
        <Cheeks y={-0.06} z={0.105} gap={0.32} color={p.red} />
        {/* stubby arms with mitten hands */}
        {[
          { ref: armL, x: -0.6, sx: -1 },
          { ref: armR, x: 0.6, sx: 1 },
        ].map(({ ref, x, sx }) => (
          <group key={sx} ref={ref} position={[x, -0.05, 0]}>
            <mesh position={[sx * 0.17, 0, 0]} rotation={[0, 0, HALF_PI]}>
              <capsuleGeometry args={[0.045, 0.22, 4, 8]} />
              <meshStandardMaterial color={p.gold} emissive={p.amber} emissiveIntensity={0.4} roughness={0.4} />
            </mesh>
            <mesh position={[sx * 0.33, 0, 0]}>
              <sphereGeometry args={[0.075, 12, 10]} />
              <meshStandardMaterial color={p.text} emissive={p.text} emissiveIntensity={0.2} roughness={0.5} />
            </mesh>
          </group>
        ))}
      </group>
      <group ref={sparkle}>
        <mesh>
          <octahedronGeometry args={[0.06, 0]} />
          <meshBasicMaterial color={p.text} toneMapped={false} />
        </mesh>
        <Glow color={p.gold} scale={0.5} opacity={0.8} position={[0, 0, 0]} />
      </group>
    </group>
  );
}

/* ------------------------------------------------------------- invoice buddy */

const SHEET_W = 0.95;
const SHEET_H = 1.25;
const SHEET_CUT = 0.26;
let sheetGeo: ExtrudeGeometry | null = null;
let flapGeo: BufferGeometry | null = null;

function sheetGeometry() {
  if (sheetGeo) return sheetGeo;
  const w = SHEET_W / 2;
  const h = SHEET_H / 2;
  const s = new Shape();
  s.moveTo(-w, -h);
  s.lineTo(w, -h);
  s.lineTo(w, h - SHEET_CUT);
  s.lineTo(w - SHEET_CUT, h);
  s.lineTo(-w, h);
  s.closePath();
  sheetGeo = new ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 });
  sheetGeo.translate(0, 0, -0.02);
  return sheetGeo;
}

/** The folded corner, in hinge space: the hinge runs along local x. */
function flapGeometry() {
  if (flapGeo) return flapGeo;
  const d = SHEET_CUT / Math.SQRT2;
  flapGeo = new BufferGeometry();
  flapGeo.setAttribute("position", new Float32BufferAttribute([-d, 0, 0, d, 0, 0, 0, -d, 0], 3));
  flapGeo.computeVertexNormals();
  return flapGeo;
}

export function InvoiceBuddy({ seed = 0 }: { seed?: number }) {
  const p = readPalette();
  const body = useRef<Group>(null);
  const flap = useRef<Group>(null);
  const total = useRef<Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed;
    if (body.current) {
      body.current.rotation.z = Math.sin(t * 1.4) * 0.08;
      body.current.rotation.y = Math.sin(t * 0.8) * 0.22;
      body.current.rotation.x = Math.sin(t * 1.1) * 0.06;
    }
    // the corner flaps like a little hand waving
    if (flap.current) flap.current.rotation.x = -0.35 - (0.5 + 0.5 * Math.sin(t * 4.2)) * 1.25;
    if (total.current) (total.current.material as MeshBasicMaterial).opacity = 0.7 + Math.sin(t * 3) * 0.3;
  });

  const hingeX = SHEET_W / 2 - SHEET_CUT / 2;
  const hingeY = SHEET_H / 2 - SHEET_CUT / 2;
  const front = 0.035;

  return (
    <group>
      <Glow color={p.blue} scale={[2.6, 3.0]} opacity={0.5} />
      <group ref={body}>
        <mesh geometry={sheetGeometry()}>
          <meshStandardMaterial color={p.text} emissive={p.blueText} emissiveIntensity={0.22} roughness={0.75} />
        </mesh>
        <group position={[hingeX, hingeY, front]} rotation={[0, 0, -Math.PI / 4]}>
          <group ref={flap}>
            <mesh geometry={flapGeometry()}>
              <meshStandardMaterial color={p.blueText} emissive={p.blue} emissiveIntensity={0.5} side={DoubleSide} roughness={0.6} />
            </mesh>
          </group>
        </group>
        {/* header bar + line items */}
        <mesh position={[-0.17, 0.47, front]}>
          <boxGeometry args={[0.42, 0.07, 0.01]} />
          <meshBasicMaterial color={p.blue} toneMapped={false} />
        </mesh>
        {[-0.2, -0.29, -0.38].map((y, i) => (
          <mesh key={y} position={[-0.1 + i * 0.03, y, front]}>
            <boxGeometry args={[0.55 - i * 0.08, 0.035, 0.01]} />
            <meshBasicMaterial color={p.mute} toneMapped={false} />
          </mesh>
        ))}
        <mesh ref={total} position={[0.24, -0.5, front]}>
          <boxGeometry args={[0.28, 0.055, 0.01]} />
          <meshBasicMaterial color={p.violet} transparent toneMapped={false} />
        </mesh>
        <Eyes y={0.2} z={front + 0.01} gap={0.15} r={0.08} seed={seed + 2} />
        <Smile y={0.02} z={front + 0.012} r={0.1} tube={0.02} color={p.void} />
        <Cheeks y={0.06} z={front + 0.006} gap={0.29} color={p.violetText} />
      </group>
    </group>
  );
}

/* ---------------------------------------------------------- shield robot */

let shieldGeo: ExtrudeGeometry | null = null;
function shieldGeometry() {
  if (shieldGeo) return shieldGeo;
  const s = new Shape();
  s.moveTo(-0.55, 0.42);
  s.quadraticCurveTo(0, 0.6, 0.55, 0.42);
  s.lineTo(0.55, 0.02);
  s.quadraticCurveTo(0.5, -0.48, 0, -0.78);
  s.quadraticCurveTo(-0.5, -0.48, -0.55, 0.02);
  s.closePath();
  shieldGeo = new ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, curveSegments: 16 });
  shieldGeo.translate(0, 0, -0.07);
  return shieldGeo;
}

export function ShieldRobot({ seed = 0 }: { seed?: number }) {
  const p = readPalette();
  const body = useRef<Group>(null);
  const scanner = useRef<Mesh>(null);
  const visorGlow = useRef<SpriteMaterial>(null);
  const tip = useRef<MeshBasicMaterial>(null);
  const handL = useRef<Group>(null);
  const handR = useRef<Group>(null);
  const jet = useRef<Group>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed;
    if (body.current) {
      body.current.rotation.y = Math.sin(t * 0.9) * 0.25;
      body.current.rotation.z = Math.sin(t * 1.3) * 0.05;
    }
    // KITT-style scanning dot across the visor
    if (scanner.current) scanner.current.position.x = Math.sin(t * 2.6) * 0.2;
    if (visorGlow.current) visorGlow.current.opacity = 0.55 + Math.sin(t * 5.2) * 0.2;
    if (tip.current) tip.current.opacity = Math.sin(t * 3.4) > 0.2 ? 1 : 0.25;
    if (handL.current) handL.current.position.y = -0.05 + Math.sin(t * 2.1) * 0.06;
    if (handR.current) {
      // salute every few seconds
      const salute = Math.max(0, Math.sin(t * 0.9)) ** 4;
      handR.current.position.set(0.78 - salute * 0.1, -0.05 + salute * 0.85 + Math.sin(t * 2.1 + 1) * 0.06, 0.05);
    }
    if (jet.current) {
      const f = 0.85 + Math.sin(t * 31) * 0.1 + Math.sin(t * 17) * 0.08;
      jet.current.scale.set(f, f * 1.2, 1);
    }
  });

  return (
    <group>
      <Glow color={p.violet} scale={3.2} opacity={0.5} />
      <group ref={body}>
        <mesh geometry={shieldGeometry()}>
          <meshStandardMaterial color={p.violet} emissive={p.violet} emissiveIntensity={0.45} metalness={0.5} roughness={0.32} />
        </mesh>
        <mesh geometry={shieldGeometry()} scale={[0.78, 0.78, 0.4]} position={[0, -0.02, 0.07]}>
          <meshStandardMaterial color={p.void} emissive={p.violet} emissiveIntensity={0.12} metalness={0.3} roughness={0.5} />
        </mesh>
        {/* check mark */}
        <group position={[-0.02, -0.08, 0.16]}>
          {/* short stroke down-right, then the long stroke up-right: a proper tick */}
          <mesh position={[-0.13, -0.06, 0]} rotation={[0, 0, -Math.PI / 4]}>
            <boxGeometry args={[0.22, 0.07, 0.04]} />
            <meshBasicMaterial color={p.green} toneMapped={false} />
          </mesh>
          <mesh position={[0.07, 0.03, 0]} rotation={[0, 0, 0.84]}>
            <boxGeometry args={[0.44, 0.07, 0.04]} />
            <meshBasicMaterial color={p.green} toneMapped={false} />
          </mesh>
          <Glow color={p.green} scale={0.9} opacity={0.45} position={[0, 0, 0.02]} />
        </group>
        {/* head with visor */}
        <group position={[0, 0.78, 0]}>
          <RoundedBox args={[0.68, 0.42, 0.44]} radius={0.13} smoothness={3}>
            <meshStandardMaterial color={p.blueText} emissive={p.blue} emissiveIntensity={0.18} metalness={0.6} roughness={0.3} />
          </RoundedBox>
          <mesh position={[0, 0.0, 0.215]}>
            <boxGeometry args={[0.52, 0.14, 0.03]} />
            <meshBasicMaterial color={p.void} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.0, 0.232]}>
            <boxGeometry args={[0.48, 0.03, 0.01]} />
            <meshBasicMaterial color={p.cyan} transparent opacity={0.45} toneMapped={false} />
          </mesh>
          <mesh ref={scanner} position={[0, 0, 0.236]}>
            <sphereGeometry args={[0.045, 12, 8]} />
            <meshBasicMaterial color={p.cyan} toneMapped={false} />
          </mesh>
          <sprite position={[0, 0, 0.26]} scale={[0.9, 0.35, 1]}>
            <spriteMaterial
              ref={visorGlow}
              map={glowTexture()}
              color={p.cyan}
              transparent
              opacity={0.6}
              blending={AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </sprite>
          {/* antenna */}
          <mesh position={[0.18, 0.32, 0]}>
            <cylinderGeometry args={[0.012, 0.012, 0.22, 6]} />
            <meshStandardMaterial color={p.mute} metalness={0.7} roughness={0.3} />
          </mesh>
          <mesh position={[0.18, 0.45, 0]}>
            <sphereGeometry args={[0.045, 12, 8]} />
            <meshBasicMaterial ref={tip} color={p.red} transparent toneMapped={false} />
          </mesh>
          <Glow color={p.red} scale={0.45} opacity={0.7} position={[0.18, 0.45, 0]} />
        </group>
        {/* floating hands */}
        {[
          { ref: handL, x: -0.78 },
          { ref: handR, x: 0.78 },
        ].map(({ ref, x }) => (
          <group key={x} ref={ref} position={[x, -0.05, 0.05]}>
            <mesh>
              <sphereGeometry args={[0.1, 14, 10]} />
              <meshStandardMaterial color={p.blueText} emissive={p.blue} emissiveIntensity={0.3} metalness={0.5} roughness={0.35} />
            </mesh>
          </group>
        ))}
        {/* thruster */}
        <group ref={jet} position={[0, -0.95, -0.05]}>
          <Glow color={p.cyan} scale={[0.45, 0.9]} opacity={0.85} position={[0, 0, 0]} />
        </group>
      </group>
    </group>
  );
}

/* ----------------------------------------------------------- stamp buddy */

const STAMP_CYCLE = 2.8;

export function StampBuddy({ seed = 0 }: { seed?: number }) {
  const p = readPalette();
  const body = useRef<Group>(null);
  const ring = useRef<Mesh>(null);
  const ringMat = useRef<MeshBasicMaterial>(null);
  const flash = useRef<SpriteMaterial>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed;
    const ph = (t % STAMP_CYCLE) / STAMP_CYCLE;
    let y = 0;
    let sx = 1;
    let sy = 1;
    if (ph < 0.35) {
      // wind up: rise and stretch
      const k = Math.sin((ph / 0.35) * HALF_PI);
      y = k * 0.32;
      sy = 1 + k * 0.1;
      sx = 1 - k * 0.05;
    } else if (ph < 0.45) {
      // slam
      const k = (ph - 0.35) / 0.1;
      y = 0.32 - k * k * 0.42;
    } else if (ph < 0.6) {
      // squash and recover
      const k = (ph - 0.45) / 0.15;
      y = -0.1 + k * 0.1;
      const sq = Math.sin(k * Math.PI) * (1 - k * 0.4);
      sy = 1 - sq * 0.22;
      sx = 1 + sq * 0.16;
    }
    if (body.current) {
      body.current.position.y = y;
      body.current.scale.set(sx, sy, sx);
      body.current.rotation.y = Math.sin(t * 0.7) * 0.3;
    }
    // impact ring + flash right after the slam
    const since = ph - 0.45;
    const active = since >= 0 && since < 0.4;
    const k = active ? since / 0.4 : 1;
    if (ring.current) ring.current.scale.setScalar(0.4 + k * 1.6);
    if (ringMat.current) ringMat.current.opacity = active ? (1 - k) * 0.9 : 0;
    if (flash.current) flash.current.opacity = active ? (1 - k) ** 2 * 0.9 : 0;
  });

  return (
    <group>
      <Glow color={p.red} scale={2.8} opacity={0.4} />
      <group ref={body}>
        {/* knob + neck */}
        <mesh position={[0, 0.8, 0]}>
          <sphereGeometry args={[0.2, 20, 14]} />
          <meshStandardMaterial color={p.red} emissive={p.crimson} emissiveIntensity={0.5} roughness={0.3} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0.52, 0]}>
          <cylinderGeometry args={[0.08, 0.11, 0.4, 14]} />
          <meshStandardMaterial color={p.mute} metalness={0.7} roughness={0.25} />
        </mesh>
        {/* body */}
        <mesh position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.4, 0.44, 0.56, 32]} />
          <meshStandardMaterial color={p.crimson} emissive={p.crimson} emissiveIntensity={0.35} roughness={0.45} />
        </mesh>
        {/* ink pad */}
        <mesh position={[0, -0.27, 0]}>
          <cylinderGeometry args={[0.47, 0.47, 0.1, 32]} />
          <meshStandardMaterial color={p.void} emissive={p.green} emissiveIntensity={0.35} roughness={0.6} />
        </mesh>
        <Eyes y={0.16} z={0.41} gap={0.14} r={0.075} seed={seed + 3} />
        {/* determined little grin */}
        <mesh position={[0, -0.02, 0.425]}>
          <boxGeometry args={[0.16, 0.03, 0.02]} />
          <meshStandardMaterial color={p.void} />
        </mesh>
        {/* eyebrows */}
        {[-1, 1].map((sx) => (
          <mesh key={sx} position={[sx * 0.14, 0.29, 0.415]} rotation={[0, 0, sx * -0.3]}>
            <boxGeometry args={[0.1, 0.025, 0.02]} />
            <meshStandardMaterial color={p.void} />
          </mesh>
        ))}
      </group>
      <mesh ref={ring} position={[0, -0.42, 0]} rotation={[-HALF_PI + 0.35, 0, 0]}>
        <torusGeometry args={[0.5, 0.025, 6, 40]} />
        <meshBasicMaterial ref={ringMat} color={p.green} transparent opacity={0} toneMapped={false} depthWrite={false} />
      </mesh>
      <sprite position={[0, -0.4, 0.1]} scale={[2.2, 0.8, 1]}>
        <spriteMaterial
          ref={flash}
          map={glowTexture()}
          color={p.green}
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
    </group>
  );
}

export function Buddy({ kind, seed }: { kind: BuddyKind; seed?: number }) {
  switch (kind) {
    case "coin":
      return <CoinBuddy seed={seed} />;
    case "invoice":
      return <InvoiceBuddy seed={seed} />;
    case "shield":
      return <ShieldRobot seed={seed} />;
    case "stamp":
      return <StampBuddy seed={seed} />;
  }
}
