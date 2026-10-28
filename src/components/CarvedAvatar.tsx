import {
  forwardRef,
  memo,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { MAUS_COLORS, type MausColor, type MausMotion, type MausState } from "@/lib/mascot";
import { HALLOWEEN_BODIES, type HalloweenBody, type HalloweenBodyId } from "../../shared/halloween-bodies";
import type { CursorAvatarHandle } from "./CursorAvatar";
import { usePrefersReducedMotion } from "./mascot-clock";
import { GLANCES, carvedFace, carvedLean, moodFor, moodPose, nextGlanceDelay, stepPose, wantedPose, type CarvedFace, type CarvedPose } from "./carved-face";

const PIVOT = 150;

export type CarvedGeometry = Omit<CarvedFace, "centre"> & { body: string };

/** Every attribute the face needs for a pose. */
export function carvedGeometry(body: HalloweenBody, p: CarvedPose): CarvedGeometry {
  const { eyes, smile, open } = carvedFace(body.eyes, p);
  return {
    body: carvedLean(p, 120, PIVOT),
    eyes,
    smile,
    open,
  };
}

const STARTLE: ReadonlySet<MausMotion> = new Set(["arrive", "switch", "customize", "alert", "launch", "success", "celebrate", "surprise"]);

function mix(hex: string, toward: string, t: number): string {
  const a = Number.parseInt(hex.slice(1), 16);
  const b = Number.parseInt(toward.slice(1), 16);
  const ch = (s: number) => Math.round(((a >> s) & 0xff) + ((((b >> s) & 0xff) - ((a >> s) & 0xff)) * t));
  return `#${[ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** The flat style wants more punch than a gradient's mid tone: saturation lifted 15%. */
export function vivid(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return hex;
  const s = Math.min(1, (l > 0.5 ? d / (2 - max - min) : d / (max + min)) * 1.15);
  const h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (x: number) => {
    const t = (x + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return `#${[ch(h + 1 / 3), ch(h), ch(h - 1 / 3)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function carvedFills(body: HalloweenBody, color: MausColor): { body: string; accent: string } {
  const accent = vivid(MAUS_COLORS[color] ?? MAUS_COLORS.green);
  if (body.paint === "bone") return { body: body.bone ?? "#f1ede6", accent };
  if (body.paint === "pale") return { body: mix(MAUS_COLORS[color] ?? MAUS_COLORS.green, "#ffffff", 0.86), accent };
  return { body: accent, accent };
}

export type CarvedAvatarProps = {
  body: HalloweenBodyId;
  color: MausColor;
  size?: number;
  state?: MausState;
  motion?: MausMotion;
  motionKey?: number;
  gaze?: { x?: number; y?: number };
  trackPointer?: boolean;
  animated?: boolean;
  label?: string;
};

function CarvedAvatarComponent(
  { body: bodyId, color, size = 44, state = "idle", motion = "none", motionKey = 0, gaze, trackPointer = true, animated = true, label }: CarvedAvatarProps,
  ref: React.Ref<CursorAvatarHandle>,
) {
  const body = HALLOWEEN_BODIES[bodyId];
  const uid = useId().replace(/:/g, "");
  const reduced = usePrefersReducedMotion();
  const live = animated && !reduced;
  const group = useRef<SVGGElement>(null);
  const eyes = [useRef<SVGRectElement>(null), useRef<SVGRectElement>(null)] as const;
  const smile = useRef<SVGPathElement>(null);
  const open = useRef<SVGEllipseElement>(null);
  const pose = useRef<CarvedPose>(moodPose(state));
  const cue = useRef({ blinkAt: -1, startleUntil: 0, pointer: null as null | { x: number; y: number } });
  const props = useRef({ state, gaze });
  props.current = { state, gaze };
  const [initial] = useState(() => carvedGeometry(body, pose.current));

  const startle = () => {
    cue.current.startleUntil = performance.now() + 1100;
    cue.current.blinkAt = performance.now();
  };
  useImperativeHandle(ref, () => ({
    blink: () => { cue.current.blinkAt = performance.now(); },
    spin: () => startle(),
    setExpression: () => {},
  }));

  useEffect(() => {
    if (!live || motion === "none") return;
    if (motion === "blink") cue.current.blinkAt = performance.now();
    else if (STARTLE.has(motion)) startle();
  }, [motion, motionKey, live]);

  const paint = (p: CarvedPose) => {
    const g = carvedGeometry(body, p);
    group.current?.setAttribute("transform", g.body);
    g.eyes.forEach((rect, i) => {
      const el = eyes[i].current;
      if (!el) return;
      for (const [k, v] of Object.entries(rect)) el.setAttribute(k, String(v));
    });
    if (smile.current) {
      smile.current.setAttribute("d", g.smile.d);
      smile.current.setAttribute("transform", g.smile.transform);
      smile.current.setAttribute("opacity", String(g.smile.opacity));
    }
    if (open.current) for (const [k, v] of Object.entries(g.open)) open.current.setAttribute(k, String(v));
  };

  useEffect(() => {
    if (live) return;
    pose.current = moodPose(state);
    paint(pose.current);
  }, [state, live, body]);

  useEffect(() => {
    if (!live) return;
    let frame = 0;
    let last = performance.now();
    let glanceAt = last + 900 + Math.random() * 2600;
    let blinkAt = last + 1500 + Math.random() * 3500;
    let target: readonly [number, number] = [0, 0];
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const mood = moodFor(props.current.state);
      const rate = mood.glance ?? 1;
      if (rate > 0 && now > glanceAt) {
        target = GLANCES[Math.floor(Math.random() * GLANCES.length)];
        glanceAt = now + nextGlanceDelay(rate);
      }
      if (now > blinkAt) {
        cue.current.blinkAt = now;
        blinkAt = now + 2600 + Math.random() * 4200;
      }
      const pointer = cue.current.pointer;
      const startled = now < cue.current.startleUntil;
      const want = pointer
        ? { ...wantedPose(mood, target, undefined, startled), gx: pointer.x, gy: pointer.y }
        : wantedPose(mood, target, props.current.gaze, startled);
      const p = pose.current;
      const since = cue.current.blinkAt < 0 ? 1 : (now - cue.current.blinkAt) / 200;
      const blink = since >= 1 ? 0 : since < 0.45 ? since / 0.45 : 1 - (since - 0.45) / 0.55;
      stepPose(p, want, dt, blink);
      paint(p);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [body, live]);

  const onPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    cue.current.pointer = {
      x: Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1)),
      y: Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1)),
    };
  };
  const onPointerLeave = () => { cue.current.pointer = null; };

  const fills = carvedFills(body, color);
  const resolve = (fill: string) => (fill === "body" ? fills.body : fill === "accent" ? fills.accent : fill);
  return (
    <span
      className="inline-flex shrink-0"
      onPointerMove={trackPointer && live ? onPointerMove : undefined}
      onPointerLeave={trackPointer && live ? onPointerLeave : undefined}
    >
      <svg
        viewBox="-14 -14 268 268"
        width={size}
        height={size}
        role={label ? "img" : undefined}
        aria-label={label ?? undefined}
        aria-hidden={label ? undefined : true}
        data-carved-body={body.id}
        style={{ overflow: "visible" }}
      >
        <defs>
          <clipPath id={`carved-${uid}`}><path d={body.clip} /></clipPath>
        </defs>
        <g ref={group} transform={initial.body}>
          {body.parts.map((part, i) => <path key={i} d={part.d} fill={resolve(part.fill)} />)}
          <g clipPath={`url(#carved-${uid})`}>
            {initial.eyes.map((rect, i) => <rect key={i} ref={eyes[i]} {...rect} fill={body.eyes.ink} />)}
          </g>
          {body.eyes.mouth && (
            <g>
              <path ref={smile} d={initial.smile.d} transform={initial.smile.transform} opacity={initial.smile.opacity}
                fill="none" stroke={body.eyes.mouthInk} strokeWidth={body.eyes.w * 0.36} strokeLinecap="round" />
              <ellipse ref={open} {...initial.open} fill={body.eyes.mouthInk} />
            </g>
          )}
        </g>
      </svg>
    </span>
  );
}


export const CarvedAvatar = memo(forwardRef(CarvedAvatarComponent));
