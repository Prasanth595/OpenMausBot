import { useEffect, useRef } from "react";
import type { MausState } from "@/lib/mascot";
import type { MascotBodyId } from "../../shared/mascot-bodies";
import { FACE_BOX } from "./cursor-face-data";
import { GLANCES, carvedFace, carvedLean, moodFor, moodPose, nextGlanceDelay, stepPose, wantedPose, type CarvedEyes, type CarvedPose } from "./carved-face";

/** The carved face in face-space units, before a body's fit sizes and places it. */
export const CARVED_EYES: CarvedEyes = { cx: 120, cy: 114, dx: 43, w: 34, h: 66, round: 56, mouthY: null };

/** A body's carved face: where it sits, and how far a sideways glance may carry it. */
export type BodyCarvedEyes = CarvedEyes & { reach: number };

type CarvedFit = { size: number; x: number; y: number; reach: number };

const CARVED_FIT: Record<MascotBodyId, CarvedFit> = {
  cursor: { size: 0.95, x: 4, y: 14, reach: 0.5 },
  blob: { size: 1.22, x: 0, y: 4, reach: 1 },
  circle: { size: 1.22, x: 0, y: 4, reach: 1 },
  squircle: { size: 1.22, x: 0, y: 4, reach: 1 },
  capsule: { size: 1.15, x: 0, y: 4, reach: 0.7 },
  drop: { size: 1.15, x: 0, y: 4, reach: 0.75 },
  shield: { size: 1.15, x: 0, y: 4, reach: 0.9 },
  hexagon: { size: 1.22, x: 0, y: 4, reach: 0.9 },
  diamond: { size: 1.15, x: 0, y: 12, reach: 1 },
  star: { size: 0.95, x: 0, y: 0, reach: 0.6 },
};

export function carvedEyesFor(body: MascotBodyId): BodyCarvedEyes {
  const { size, x, y, reach } = CARVED_FIT[body];
  const e = CARVED_EYES;
  return { cx: e.cx + x, cy: e.cy + y, dx: e.dx * size, w: e.w * size, h: e.h * size, round: e.round * size, mouthY: null, reach };
}

const EASE_PER_S = 9;

export type CarvedMotion = { pose: CarvedPose; glance: readonly [number, number]; left: number };

export const carvedMotion = (state: MausState): CarvedMotion => ({ pose: moodPose(state), glance: [0, 0], left: 0 });

/** Eases the face toward its mood; a still face jumps there. */
export function stepCarved(m: CarvedMotion, state: MausState, gaze: { x?: number; y?: number } | undefined, dt: number, blink: number, still: boolean, startled: boolean) {
  const want = wantedPose(moodFor(state), m.glance, gaze, startled);
  if (still) {
    Object.assign(m.pose, want);
    m.left = 0;
  } else {
    m.left = stepPose(m.pose, want, dt, blink);
  }
}

export const carvedUnitsPerMs = (m: CarvedMotion, eyes: CarvedEyes) => (m.left * eyes.h * EASE_PER_S) / 1000;

export function useCarvedGlances(active: boolean, state: MausState, onGlance: (glance: readonly [number, number]) => void) {
  const latest = useRef(onGlance);
  useEffect(() => {
    latest.current = onGlance;
  });
  useEffect(() => {
    const rate = moodFor(state).glance ?? 1;
    if (!active || rate <= 0) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(() => {
        latest.current(GLANCES[Math.floor(Math.random() * GLANCES.length)]);
        tick();
      }, nextGlanceDelay(rate));
    };
    tick();
    return () => clearTimeout(timer);
  }, [active, state]);
}

export type CarvedParts = { eyes: [SVGRectElement | null, SVGRectElement | null]; smile: SVGPathElement | null; open: SVGEllipseElement | null };

export const useCarvedParts = (): CarvedParts => useRef<CarvedParts>({ eyes: [null, null], smile: null, open: null }).current;

const GAZE_Y = 0.6;

/** Keeps a pose's gaze where the body has room: a narrower glance, and a startle that looks straight out. */
export const fitPose = (eyes: BodyCarvedEyes, pose: CarvedPose): CarvedPose => ({
  ...pose,
  gx: pose.gx * eyes.reach * (1 - pose.wide),
  gy: Math.max(-GAZE_Y, Math.min(GAZE_Y, pose.gy)) * (1 - pose.wide),
});

const LEAN_PIVOT = [FACE_BOX / 2, FACE_BOX * 0.625] as const;

/** Paints the face for a pose, and leans `body` with it the way a carved Halloween body leans. */
export function paintCarvedFace(parts: CarvedParts, eyes: BodyCarvedEyes, pose: CarvedPose, eyeScale: number, body: SVGGElement | null) {
  const spec = eyeScale === 1 ? eyes : { ...eyes, w: eyes.w * eyeScale, h: eyes.h * eyeScale, round: eyes.round * eyeScale };
  const reached = fitPose(eyes, pose);
  const face = carvedFace(spec, reached);
  face.eyes.forEach((rect, index) => {
    const el = parts.eyes[index];
    if (el) for (const [key, value] of Object.entries(rect)) el.setAttribute(key, String(value));
  });
  if (parts.smile) {
    parts.smile.setAttribute("d", face.smile.d);
    parts.smile.setAttribute("transform", face.smile.transform);
    parts.smile.setAttribute("opacity", String(face.smile.opacity));
  }
  if (parts.open) for (const [key, value] of Object.entries(face.open)) parts.open.setAttribute(key, String(value));
  body?.setAttribute("transform", carvedLean(reached, ...LEAN_PIVOT));
}

export function CarvedFaceParts({ parts, eyes, ink, showMouth }: { parts: CarvedParts; eyes: CarvedEyes; ink: string; showMouth: boolean }) {
  return (
    <>
      <rect ref={(el) => { parts.eyes[0] = el; }} fill={ink} />
      <rect ref={(el) => { parts.eyes[1] = el; }} fill={ink} />
      {showMouth && (
        <>
          <path ref={(el) => { parts.smile = el; }} fill="none" stroke={ink} strokeWidth={eyes.w * 0.36} strokeLinecap="round" />
          <ellipse ref={(el) => { parts.open = el; }} fill={ink} />
        </>
      )}
    </>
  );
}
