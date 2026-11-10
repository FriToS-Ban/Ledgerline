"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, type Group, type ShaderMaterial, type Sprite } from "three";
import { glowTexture } from "./glow";
import { readPalette } from "./palette";
import { scrollState } from "./scroll";

const vertex = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.6 + 0.4 * sin(uTime * (0.5 + aPhase * 1.8) + aPhase * 6.2831);
    vTwinkle = tw;
    vColor = aColor;
    gl_PointSize = aSize * uPixelRatio * (34.0 / -mv.z) * (0.75 + 0.5 * tw);
  }
`;

const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a *= a;
    gl_FragColor = vec4(vColor * (0.7 + 0.5 * vTwinkle), a * vTwinkle);
  }
`;

/** Build the star buffer: deterministic pseudo-random so every mount looks the same. */
function buildStars(count: number) {
  const p = readPalette();
  const tints = [p.text, p.text, p.text, p.blueText, p.violetText, p.cyan];
  const pos: number[] = [];
  const col: number[] = [];
  const size: number[] = [];
  const phase: number[] = [];
  // deterministic pseudo-random so every mount looks the same
  let s = 1337;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const r = 22 + rnd() * 40;
    const q = Math.sqrt(1 - u * u);
    pos.push(r * q * Math.cos(th), r * u, r * q * Math.sin(th) - 8);
    const c = tints[Math.floor(rnd() * tints.length)];
    col.push(c.r, c.g, c.b);
    const big = rnd() > 0.93;
    size.push(big ? 3 + rnd() * 2.5 : 0.8 + rnd() * 1.6);
    phase.push(rnd());
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("aColor", new Float32BufferAttribute(col, 3));
  g.setAttribute("aSize", new Float32BufferAttribute(size, 1));
  g.setAttribute("aPhase", new Float32BufferAttribute(phase, 1));
  return g;
}

/** One draw call: a shell of twinkling points around the camera, tinted from the design tokens. */
export function Starfield({ count = 1100 }: { count?: number }) {
  const group = useRef<Group>(null);
  const mat = useRef<ShaderMaterial>(null);
  const dpr = useThree((s) => s.viewport.dpr);

  const geometry = useMemo(() => buildStars(count), [count]);

  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uPixelRatio: { value: 1 } }), []);

  useFrame(({ clock }, delta) => {
    if (mat.current) {
      mat.current.uniforms.uTime.value = clock.elapsedTime;
      mat.current.uniforms.uPixelRatio.value = dpr;
    }
    if (group.current) {
      // slow drift plus scroll parallax: scrolling down tilts the sky upward
      group.current.rotation.y += delta * 0.006;
      const target = scrollState.y * 0.00018;
      group.current.rotation.x += (target - group.current.rotation.x) * Math.min(1, delta * 4);
    }
  });

  return (
    <group ref={group}>
      <points geometry={geometry} frustumCulled={false}>
        <shaderMaterial
          ref={mat}
          vertexShader={vertex}
          fragmentShader={fragment}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </points>
    </group>
  );
}

/** Three huge, faint additive sprites that breathe: the nebula. */
export function Nebula() {
  const p = readPalette();
  const refs = useRef<(Sprite | null)[]>([]);
  const clouds = useMemo(
    () => [
      { color: p.blue, pos: [-14, 6, -30] as const, scale: 38, opacity: 0.16 },
      { color: p.violet, pos: [16, -2, -34] as const, scale: 44, opacity: 0.15 },
      { color: p.cyan, pos: [2, -12, -40] as const, scale: 36, opacity: 0.07 },
    ],
    [p],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    refs.current.forEach((s, i) => {
      if (!s) return;
      const k = 1 + Math.sin(t * 0.12 + i * 2) * 0.06;
      s.scale.set(clouds[i].scale * k, clouds[i].scale * k * 0.7, 1);
      s.position.y = clouds[i].pos[1] + scrollState.y * 0.002 * (i + 1) * 0.5;
    });
  });

  return (
    <>
      {clouds.map((c, i) => (
        <sprite
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          position={[c.pos[0], c.pos[1], c.pos[2]]}
          scale={[c.scale, c.scale * 0.7, 1]}
        >
          <spriteMaterial
            map={glowTexture()}
            color={c.color}
            transparent
            opacity={c.opacity}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
      ))}
    </>
  );
}
