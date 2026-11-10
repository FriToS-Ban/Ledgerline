"use client";

import { useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { FlyerDirector, type FlyersVariant } from "./flyer-director";
import { readPalette } from "./palette";
import { trackScrollAndPointer, scrollState } from "./scroll";
import { Nebula, Starfield } from "./starfield";

function CameraRig() {
  useFrame(({ camera }, delta) => {
    const k = Math.min(1, delta * 2);
    camera.position.x += (scrollState.px * 0.35 - camera.position.x) * k;
    camera.position.y += (-scrollState.py * 0.25 - camera.position.y) * k;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

function Lights() {
  const p = readPalette();
  return (
    <>
      <ambientLight intensity={0.55} color={p.text} />
      <directionalLight position={[-4, 6, 8]} intensity={1.6} color={p.text} />
      <pointLight position={[-7, 1, 4]} intensity={30} distance={22} color={p.blue} />
      <pointLight position={[7, -1, 4]} intensity={30} distance={22} color={p.violet} />
    </>
  );
}

/** Client-only WebGL layer: loaded through next/dynamic with ssr:false from ./index. */
export default function SceneCanvas({
  routeKey,
  variant,
  paused,
  stars,
}: {
  routeKey: string;
  variant: FlyersVariant;
  paused: boolean;
  stars: boolean;
}) {
  useEffect(() => trackScrollAndPointer(), []);
  const small = typeof window !== "undefined" && window.innerWidth < 640;

  return (
    <Canvas
      dpr={[1, 1.5]}
      frameloop={paused ? "never" : "always"}
      camera={{ position: [0, 0, 10], fov: 45, near: 0.1, far: 120 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power", stencil: false }}
      style={{ pointerEvents: "none", position: "absolute", inset: 0 }}
      aria-hidden
    >
      <Lights />
      <CameraRig />
      {stars && (
        <>
          <Nebula />
          <Starfield count={small ? 500 : 1100} />
        </>
      )}
      <FlyerDirector routeKey={routeKey} variant={variant} />
    </Canvas>
  );
}
