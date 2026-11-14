import type { CLIP_EFFECTS } from "../api/timeline";

type Effect = (typeof CLIP_EFFECTS)[number];

// What each look does to a picture in the browser. The film itself is made
// by FFmpeg, so these are close stand-ins for previews, not the same maths.
export const EFFECT_CSS: Record<Effect, string> = {
  none: "none",
  mono: "grayscale(1)",
  sepia: "sepia(0.9)",
  warm: "sepia(0.25) saturate(1.25) hue-rotate(-8deg)",
  cool: "saturate(1.1) hue-rotate(12deg) brightness(1.02)",
  vivid: "contrast(1.15) saturate(1.4)",
  vintage: "sepia(0.45) contrast(0.92) brightness(1.05) saturate(0.85)",
  blur: "blur(3px)",
  // The dark corners are drawn by an overlay; the picture itself is unchanged.
  vignette: "none",
};

// Longest fade a clip may have, and an audio piece (mirrors the server).
export const MAX_CLIP_FADE = 2;
export const MAX_AUDIO_FADE = 10;
