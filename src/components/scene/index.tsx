"use client";

import { Component, type ReactNode, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { FlyersVariant } from "./flyer-director";

export type { FlyersVariant } from "./flyer-director";

// three.js / r3f only ever load in the browser, in their own chunk.
const SceneCanvas = dynamic(() => import("./scene-canvas"), { ssr: false });

/* ---------- environment checks as external stores (SSR snapshot = safe CSS-only) ---------- */

function subscribeMedia(query: string) {
  return (cb: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  };
}
const subscribeReduced = subscribeMedia("(prefers-reduced-motion: reduce)");
const getReduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let webglSupport: boolean | null = null;
function getWebGL() {
  if (webglSupport === null) {
    try {
      const c = document.createElement("canvas");
      webglSupport = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}
const noopSubscribe = () => () => {};

function subscribeVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}
const getHidden = () => document.visibilityState === "hidden";

const serverTrue = () => true;
const serverFalse = () => false;

/** If WebGL dies (context creation fails, driver issues), quietly keep the CSS starfield. */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {}
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * The cosmic backdrop with its flying cast.
 *
 * - `variant="app"`: a pair of buddies swoops in from the left and right edges on every route
 *   change, hovers in the gutters, then drifts away; a new pair returns after a pause.
 * - `variant="login"`: shield robot + stamp stand guard either side of the form for longer.
 *
 * Always `pointer-events: none` and `aria-hidden`. Under `prefers-reduced-motion` or without
 * WebGL only the static CSS starfield renders. By default the layer is `position: fixed`
 * behind the page (z-0); pass `fixed={false}` to fill a positioned parent instead.
 */
export function Flyers({
  variant = "app",
  fixed = true,
  stars = true,
  className,
}: {
  variant?: FlyersVariant;
  fixed?: boolean;
  /** render the 3D starfield + nebula too (turn off when another layer already draws the sky) */
  stars?: boolean;
  className?: string;
}) {
  const path = usePathname() ?? "/";
  const reduced = useSyncExternalStore(subscribeReduced, getReduced, serverTrue);
  const webgl = useSyncExternalStore(noopSubscribe, getWebGL, serverFalse);
  const hidden = useSyncExternalStore(subscribeVisibility, getHidden, serverFalse);
  const live = webgl && !reduced;

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none z-0 overflow-hidden", fixed ? "fixed inset-0" : "absolute inset-0", className)}
    >
      {stars && <div className="starfield" />}
      {live && (
        <SceneBoundary>
          <SceneCanvas routeKey={path} variant={variant} paused={hidden} stars={stars} />
        </SceneBoundary>
      )}
    </div>
  );
}
