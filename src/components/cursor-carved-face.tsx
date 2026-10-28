import { useEffect, useRef } from "react";
import type { MausState } from "@/lib/mascot";
import type { MascotBodyId } from "../../shared/mascot-bodies";
import type { SpherePoint } from "./mascot-motion";
import { GLANCES, carvedFace, moodFor, moodPose, nextGlanceDelay, stepPose, wantedPose, type CarvedEyes, type CarvedPose } from "./carved-face";

/** The carved face in face-space units: every body's anchor places and sizes the same face. */
export const CARVED_EYES: CarvedEyes = { cx: 120, cy: 114, dx: 43, w: 34, h: 66, round: 56, mouthY: null };

/** A body's carved face: where it sits, and how far a sideways glance may carry it. */
export type BodyCarvedEyes = CarvedEyes & { reach: number };

/** The cursor's top edge slopes across startled eyes and its left side is narrow, so its face sits lower and glances less far. */
const CARVED_NUDGE: Partial<Record<MascotBodyId, { x: number; y: number; reach: number }>> = { cursor: { x: 4, y: 13, reach: 0.4 } };

export function carvedEyesFor(body: MascotBodyId): BodyCarvedEyes {
  const nudge = CARVED_NUDGE[body];
  if (!nudge) return { ...CARVED_EYES, reach: 1 };
  return { ...CARVED_EYES, cx: CARVED_EYES.cx + nudge.x, cy: CARVED_EYES.cy + nudge.y, reach: nudge.reach };
}

const EASE_PER_S = 9;

export type CarvedMotion = { pose: CarvedPose; glance: readonly [number, number]; left: number };

export const carvedMotion = (state: MausState): CarvedMotion => ({ pose: moodPose(state), glance: [0, 0], left: 0 });

/** Eases the face toward its mood; a still face jumps there. */
export function stepCarved(m: CarvedMotion, state: MausState, gaze: { x?: number; y?: number } | undefined, dt: number, blink: number, still: boolean) {
  const want = wantedPose(moodFor(state), m.glance, gaze, false);
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

const fixed = (n: number) => n.toFixed(2);

export function paintCarvedFace(parts: CarvedParts, eyes: BodyCarvedEyes, pose: CarvedPose, eyeScale: number, onSphere: (x: number) => SpherePoint) {
  const spec = eyeScale === 1 ? eyes : { ...eyes, w: eyes.w * eyeScale, h: eyes.h * eyeScale, round: eyes.round * eyeScale };
  const face = carvedFace(spec, eyes.reach === 1 ? pose : { ...pose, gx: pose.gx * eyes.reach });
  const place = (x: number, y: number) => {
    const at = onSphere(x);
    const squeeze = Math.min(Math.max(at.perspective, 0.02), 2.4).toFixed(4);
    return { transform: `translate(${fixed(at.x)} ${fixed(y)}) scale(${squeeze} 1) translate(${fixed(-x)} ${fixed(-y)})`, shown: at.shown };
  };
  face.eyes.forEach(({ transform, ...box }, index) => {
    const el = parts.eyes[index];
    if (!el) return;
    for (const [key, value] of Object.entries(box)) el.setAttribute(key, String(value));
    const at = place(box.x + box.width / 2, box.y + box.height / 2);
    el.setAttribute("transform", `${at.transform} ${transform}`);
    el.style.opacity = at.shown ? "1" : "0";
  });
  const mouth = place(face.centre.x, face.centre.mouthY);
  if (parts.smile) {
    parts.smile.setAttribute("d", face.smile.d);
    parts.smile.setAttribute("transform", `${mouth.transform} ${face.smile.transform}`);
    parts.smile.setAttribute("opacity", String(mouth.shown ? face.smile.opacity : 0));
  }
  if (parts.open) {
    const { opacity, ...ellipse } = face.open;
    for (const [key, value] of Object.entries(ellipse)) parts.open.setAttribute(key, String(value));
    parts.open.setAttribute("transform", mouth.transform);
    parts.open.setAttribute("opacity", String(mouth.shown ? opacity : 0));
  }
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
