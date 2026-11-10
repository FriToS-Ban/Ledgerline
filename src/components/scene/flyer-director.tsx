"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { AdditiveBlending, Vector3, type Group, type Sprite, type SpriteMaterial } from "three";
import { BUDDIES, Buddy, type BuddyKind } from "./characters";
import { glowTexture } from "./glow";
import { readPalette } from "./palette";
import { scrollState } from "./scroll";

export type FlyersVariant = "app" | "login";

type Tuning = { hold: number; gap: number; scale: number; inset: number; first: [BuddyKind, BuddyKind] | null };

const TUNING: Record<FlyersVariant, Tuning> = {
  // in the app the pair says hello, hangs around in the gutters, then gets out of the way
  app: { hold: 6.5, gap: 9, scale: 0.85, inset: 0.45, first: null },
  // on the login screen they stand guard either side of the form for longer
  login: { hold: 11, gap: 2.5, scale: 0.9, inset: 0.6, first: ["shield", "stamp"] },
};

type Wave = { id: number; kinds: [BuddyKind, BuddyKind]; seed: number; leaving: boolean };

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Pick two different buddies, and never the exact same pair as the one before. */
function pickPair(seed: number, prev?: [BuddyKind, BuddyKind]): [BuddyKind, BuddyKind] {
  const n = BUDDIES.length;
  for (let i = 0; i < n * n; i++) {
    const s = seed + i * 7;
    const a = s % n;
    const b = (a + 1 + ((s >>> 3) % (n - 1))) % n;
    const pair: [BuddyKind, BuddyKind] = [BUDDIES[a], BUDDIES[b]];
    if (!prev || !(pair.includes(prev[0]) && pair.includes(prev[1]))) return pair;
  }
  return [BUDDIES[0], BUDDIES[1]];
}

function makeWave(id: number, routeKey: string, variant: FlyersVariant, prev?: Wave): Wave {
  const seed = hashString(`${routeKey}:${id}`);
  const first = TUNING[variant].first;
  return { id, kinds: id === 0 && first ? first : pickPair(seed, prev?.kinds), seed: (seed % 1000) / 37, leaving: false };
}

/**
 * Owns the waves of flyers. A route change sends any visible pair off-screen fast and brings
 * in a fresh pair; when a pair finishes its natural cycle, the next one arrives after a pause.
 */
export function FlyerDirector({ routeKey, variant }: { routeKey: string; variant: FlyersVariant }) {
  const [state, setState] = useState(() => {
    const first = makeWave(0, routeKey, variant);
    return { route: routeKey, next: 1, last: first, waves: [first] };
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // adjust state while rendering when the route changes (no effect round-trip)
  if (state.route !== routeKey) {
    setState((s) => {
      const wave = makeWave(s.next, routeKey, variant, s.last);
      return { route: routeKey, next: s.next + 1, last: wave, waves: [...s.waves.map((w) => ({ ...w, leaving: true })), wave] };
    });
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    // a route change cancels any pending "next wave" timer; the new wave is already on its way
    if (timer.current) clearTimeout(timer.current);
  }, [routeKey]);

  const newest = useRef(0);
  useEffect(() => {
    newest.current = state.waves.at(-1)?.id ?? -1;
  }, [state.waves]);

  function done(id: number, natural: boolean) {
    if (natural && id === newest.current) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setState((cur) => {
          const wave = makeWave(cur.next, cur.route, variant, cur.last);
          return { ...cur, next: cur.next + 1, last: wave, waves: [...cur.waves, wave] };
        });
      }, TUNING[variant].gap * 1000);
    }
    setState((s) => ({ ...s, waves: s.waves.filter((w) => w.id !== id) }));
  }

  return (
    <>
      {state.waves.map((w) => (
        <WavePair key={w.id} wave={w} variant={variant} onDone={done} />
      ))}
    </>
  );
}

function WavePair({ wave, variant, onDone }: { wave: Wave; variant: FlyersVariant; onDone: (id: number, natural: boolean) => void }) {
  const finished = useRef(0);
  const natural = useRef(true);
  const report = (wasNatural: boolean) => {
    if (!wasNatural) natural.current = false;
    finished.current += 1;
    if (finished.current === 2) onDone(wave.id, natural.current);
  };
  return (
    <>
      <Flyer kind={wave.kinds[0]} side={-1} seed={wave.seed} delay={0} leaving={wave.leaving} variant={variant} onDone={report} />
      <Flyer kind={wave.kinds[1]} side={1} seed={wave.seed + 5} delay={0.45} leaving={wave.leaving} variant={variant} onDone={report} />
    </>
  );
}

const tmp = new Vector3();

function Flyer({
  kind,
  side,
  seed,
  delay,
  leaving,
  variant,
  onDone,
}: {
  kind: BuddyKind;
  side: -1 | 1;
  seed: number;
  delay: number;
  leaving: boolean;
  variant: FlyersVariant;
  onDone: (natural: boolean) => void;
}) {
  const outer = useRef<Group>(null);
  const parallax = useRef<Group>(null);
  const bob = useRef<Group>(null);
  const trail = useRef<Sprite>(null);
  const trailMat = useRef<SpriteMaterial>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);
  const last = useRef(new Vector3());
  const viewport = useThree((s) => s.viewport);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  const p = readPalette();
  const trailColor = kind === "coin" ? p.gold : kind === "invoice" ? p.blue : kind === "shield" ? p.violet : p.red;

  // the flight plan: swoop in from the edge, say hello, hover, then drift off the same side
  useEffect(() => {
    const g = outer.current;
    if (!g) return;
    const t = TUNING[variant];
    const w = viewport.width;
    const narrow = w < 7;
    const scale = Math.min(t.scale, Math.max(0.55, w / 11)) * (narrow ? 0.85 : 1);
    const inset = (narrow ? 0.35 : t.inset) * scale;
    const yBand = side < 0 ? 0.4 + (seed % 1) * 1.0 : -0.7 - (seed % 1) * 1.3;
    const parkX = side * (w / 2 - inset);
    const offX = side * (w / 2 + 2.6 * scale);

    g.scale.setScalar(scale);
    g.position.set(offX, yBand - 1.2, -0.5);
    g.rotation.set(0, 0, -side * 0.55);
    last.current.copy(g.position);

    const tl1 = gsap.timeline({ delay, onComplete: () => onDoneRef.current(true) });
    tl1
      .to(g.position, { x: parkX, y: yBand, z: 0, duration: 1.7, ease: "back.out(1.3)" }, 0)
      .to(g.rotation, { z: 0, duration: 1.4, ease: "power2.out" }, 0.15)
      // a little hello spin once parked
      .to(g.rotation, { y: Math.PI * 2, duration: 0.9, ease: "power2.inOut" }, 1.6)
      .set(g.rotation, { y: 0 })
      // hover, then lean and drift out and up the way it came
      .to(g.rotation, { z: side * 0.45, duration: 0.6, ease: "sine.inOut" }, 1.7 + t.hold)
      .to(g.position, { x: offX * 1.15, y: yBand + 2.4, z: -1, duration: 2.3, ease: "power2.in" }, 1.8 + t.hold);
    tl.current = tl1;
    return () => {
      tl1.kill();
    };
    // the flight is planned once per mount; a resize simply lets the current flight finish
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // route changed: abandon the plan and zip off-screen
  useEffect(() => {
    if (!leaving) return;
    const g = outer.current;
    tl.current?.kill();
    if (!g) {
      onDoneRef.current(false);
      return;
    }
    const tw = gsap.to(g.position, {
      x: side * (viewport.width / 2 + 3),
      y: g.position.y + 1.2,
      duration: 0.75,
      ease: "power3.in",
      onComplete: () => onDoneRef.current(false),
    });
    const rot = gsap.to(g.rotation, { z: side * 0.6, duration: 0.5, ease: "power2.out" });
    return () => {
      tw.kill();
      rot.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    if (bob.current) {
      bob.current.position.y = Math.sin(t * 1.6 + seed) * 0.12;
      bob.current.rotation.z = Math.sin(t * 1.1 + seed) * 0.06;
      // glance toward the content
      bob.current.rotation.y = -side * 0.22 + Math.sin(t * 0.5 + seed) * 0.08;
    }
    if (parallax.current) {
      // nearer than the stars: scroll lifts the flyers more, but never off-screen
      const target = Math.tanh(scrollState.y / 900) * 1.4 + scrollState.py * -0.15;
      parallax.current.position.y += (target - parallax.current.position.y) * Math.min(1, delta * 5);
      parallax.current.position.x += (scrollState.px * 0.18 - parallax.current.position.x) * Math.min(1, delta * 3);
    }
    // comet trail stretched along the velocity
    const g = outer.current;
    if (g && trail.current && trailMat.current && delta > 0) {
      tmp.copy(g.position).sub(last.current).divideScalar(delta);
      last.current.copy(g.position);
      const speed = Math.min(tmp.length(), 14);
      const len = 0.2 + speed * 0.22;
      trail.current.scale.set(len, 0.55, 1);
      trailMat.current.rotation = Math.atan2(tmp.y, tmp.x);
      const inv = speed > 0.01 ? 1 / speed : 0;
      trail.current.position.set(-tmp.x * inv * len * 0.42, -tmp.y * inv * len * 0.42, -0.4);
      trailMat.current.opacity = Math.min(0.75, speed * 0.09);
    }
  });

  return (
    <group ref={outer} position={[side * 30, 0, 0]}>
      <group ref={parallax}>
      <sprite ref={trail}>
        <spriteMaterial
          ref={trailMat}
          map={glowTexture()}
          color={trailColor}
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
        <group ref={bob}>
          <Buddy kind={kind} seed={seed} />
        </group>
      </group>
    </group>
  );
}
