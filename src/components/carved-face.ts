import type { MausState } from "@/lib/mascot";
import type { HalloweenEyes } from "../../shared/halloween-bodies";

/** Where the face looks and how it feels. */
export type CarvedPose = {
  /** Gaze, -1..1 each way. */
  gx: number;
  gy: number;
  /** Startle, 0..1: round eyes, open mouth, stretched body. */
  wide: number;
  /** Eyelids, 0 open .. 1 shut. */
  shut: number;
  /** Smile curvature: 1 is the resting smile, below 0 a frown. */
  smile: number;
};

export const REST_POSE: CarvedPose = { gx: 0, gy: 0, wide: 0, shut: 0, smile: 1 };

export const CARVED_INK = "#0d0a10";

export type CarvedEyes = Pick<HalloweenEyes, "cx" | "cy" | "dx" | "w" | "h" | "round" | "mouthY">;

export type CarvedRect = { x: number; y: number; width: number; height: number; rx: number; transform: string };
export type CarvedFace = {
  eyes: [CarvedRect, CarvedRect];
  smile: { d: string; transform: string; opacity: number };
  open: { cx: number; cy: number; rx: number; ry: number; opacity: number };
  /** Centre of the eye pair, and the mouth's height. */
  centre: { x: number; eyeY: number; mouthY: number };
};

export const r2 = (n: number) => Math.round(n * 100) / 100;

export function carvedFace(e: CarvedEyes, p: CarvedPose): CarvedFace {
  const ax = Math.abs(p.gx);
  const spread = e.dx * (1 - 0.1 * ax) * (1 + 0.14 * p.wide);
  const cx = e.cx + p.gx * e.dx * 1.05;
  const cy = e.cy + p.gy * 16 - p.wide * e.h * 0.42;
  let w = e.w * (1 + 0.05 * ax);
  let h = e.h * (1 - 0.3 * ax);
  w += (e.round - w) * p.wide;
  h += (e.round * 1.08 - h) * p.wide;
  h *= 1 - 0.9 * p.shut;
  const tilt = -p.gx * 18 * (1 - p.wide);
  const eye = (side: -1 | 1): CarvedRect => {
    const k = 1 - 0.1 * Math.max(0, side * -p.gx);
    const ew = w * k;
    const eh = Math.max(h * k, 0.5);
    const x = cx + side * spread;
    return {
      x: r2(x - ew / 2), y: r2(cy - eh / 2), width: r2(ew), height: r2(eh), rx: r2(Math.min(ew, eh) / 2),
      transform: `rotate(${r2(tilt)} ${r2(x)} ${r2(cy)})`,
    };
  };
  const mw = e.dx * 0.46;
  const half = mw * (1 - 0.25 * ax);
  const depth = mw * 0.5 * p.smile;
  const my = (e.mouthY ?? e.cy + e.h * 0.5 + e.dx * 0.42) + p.gy * 10;
  return {
    eyes: [eye(-1), eye(1)],
    smile: {
      d: `M${r2(cx - half)} ${r2(my - depth * 0.35)} Q${r2(cx)} ${r2(my + depth)} ${r2(cx + half)} ${r2(my - depth * 0.35)}`,
      transform: `rotate(${r2(tilt * 0.6)} ${r2(cx)} ${r2(my)})`,
      opacity: r2(1 - p.wide),
    },
    open: { cx: r2(cx), cy: r2(my + mw * 0.1), rx: r2(mw * 0.5 * p.wide), ry: r2(mw * 0.62 * p.wide), opacity: r2(p.wide) },
    centre: { x: cx, eyeY: cy, mouthY: my },
  };
}

/** Leans a carved body into its glance about (x, y) and stretches it when startled. */
export function carvedLean(p: CarvedPose, x: number, y: number): string {
  const sx = 1 - 0.06 * p.wide;
  const sy = 1 + 0.09 * p.wide;
  return `translate(${x} ${y}) rotate(${r2(-p.gx * 9)}) scale(${r2(sx * 1000) / 1000} ${r2(sy * 1000) / 1000}) translate(${-x} ${-y})`;
}

export type CarvedMood = Partial<CarvedPose> & { glance?: number };

export function moodFor(state: MausState): CarvedMood {
  switch (state) {
    case "surprised": case "alerting": case "scared": case "excited": case "celebrate": case "spawning": case "waking":
      return { wide: 1 };
    case "sleeping": case "powering-down":
      return { shut: 0.92, smile: 0.4, glance: 0 };
    case "drowsy": case "bored":
      return { shut: 0.55, smile: 0.6, glance: 0.3 };
    case "happy": case "laughing": case "proud": case "playful":
      return { smile: 1.5 };
    case "sad":
      return { smile: -0.8, gy: 0.6, glance: 0.3 };
    case "thinking":
      return { gx: 0.6, gy: -0.6, glance: 0 };
    case "searching": case "radar": case "orbit": case "curious":
      return { glance: 2.2 };
    case "working": case "writing": case "loading":
      return { gy: 0.5, glance: 0.6 };
    default:
      return {};
  }
}

export function moodPose(state: MausState): CarvedPose {
  const m = moodFor(state);
  return { gx: m.gx ?? 0, gy: m.gy ?? 0, wide: m.wide ?? 0, shut: m.shut ?? 0, smile: m.smile ?? 1 };
}

export const GLANCES: ReadonlyArray<[number, number]> = [[0, 0], [0, 0], [-1, 0.25], [1, 0.25], [-0.8, 0.55], [0.8, 0.55], [-0.7, -0.4], [0.7, -0.4], [0, 0.5]];

export function nextGlanceDelay(rate: number): number {
  return (1400 + Math.random() * 3200) / rate;
}

/** The pose a face wants: its mood, else the current glance, plus an outside gaze such as the pointer. */
export function wantedPose(
  mood: CarvedMood,
  glance: readonly [number, number],
  gaze: { x?: number; y?: number } | undefined,
  startled: boolean,
): CarvedPose {
  const glancing = (mood.glance ?? 1) > 0;
  return {
    gx: (mood.gx ?? (glancing ? glance[0] : 0)) + (gaze?.x ?? 0),
    gy: (mood.gy ?? (glancing ? glance[1] : 0)) + (gaze?.y ?? 0),
    wide: startled ? 1 : mood.wide ?? 0,
    shut: mood.shut ?? 0,
    smile: mood.smile ?? 1,
  };
}

const SETTLED = 0.002;

/**
 * Eases `p` toward `want` over `dt` seconds, with `blink` (0..1) closing the lids on top. Returns how far the pose
 * still has to travel, 0 once it has settled.
 */
export function stepPose(p: CarvedPose, want: CarvedPose, dt: number, blink: number): number {
  const k = (speed: number) => 1 - Math.exp(-dt * speed);
  const gx = Math.max(-1, Math.min(1, want.gx));
  const gy = Math.max(-1, Math.min(1, want.gy));
  const shut = Math.max(want.shut, blink);
  p.gx += (gx - p.gx) * k(9);
  p.gy += (gy - p.gy) * k(9);
  p.wide += (want.wide - p.wide) * k(want.wide > p.wide ? 18 : 7);
  p.smile += (want.smile - p.smile) * k(8);
  p.shut += (shut - p.shut) * (blink > 0 ? 1 : k(10));
  const left = Math.max(Math.abs(gx - p.gx), Math.abs(gy - p.gy), Math.abs(want.wide - p.wide), Math.abs(want.smile - p.smile), Math.abs(shut - p.shut));
  if (left >= SETTLED) return left;
  Object.assign(p, { gx, gy, wide: want.wide, smile: want.smile, shut });
  return 0;
}
