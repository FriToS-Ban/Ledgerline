import { Color } from "three";

/**
 * The 3D scene never hard-codes colours: it reads the Cosmic design tokens from
 * `globals.css` at runtime so the canvas always matches the rest of the UI.
 */
const TOKENS = {
  void: "--void",
  text: "--text",
  mute: "--text-mute",
  blue: "--neon-blue",
  violet: "--neon-violet",
  cyan: "--neon-cyan",
  blueText: "--blue-text",
  violetText: "--violet-text",
  gold: "--warning-text",
  amber: "--warning",
  green: "--success-text",
  red: "--danger-text",
  crimson: "--danger",
} as const;

export type PaletteKey = keyof typeof TOKENS;
export type Palette = Record<PaletteKey, Color>;

let cached: Palette | null = null;

export function readPalette(): Palette {
  if (cached) return cached;
  const style = typeof window === "undefined" ? null : getComputedStyle(document.documentElement);
  const out = {} as Palette;
  for (const [key, token] of Object.entries(TOKENS) as [PaletteKey, string][]) {
    const raw = style?.getPropertyValue(token).trim();
    // Colour("white") is only a last-resort if a token is missing; it keeps the scene visible.
    out[key] = new Color(raw || "white");
  }
  cached = out;
  return out;
}
