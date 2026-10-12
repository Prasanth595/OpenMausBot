import { useLayoutEffect, useRef, useState } from "react";

/** Same length as `--animate-pop-in` in styles.css. */
export const MENU_MOTION_MS = 200;

/** Popover menu container open length (its own CSS module). */
export const MENU_OPEN_MS = 500;

/** Exit length of the popover menu motion (its own CSS module). The sheet
 * must stay mounted this long so the shrink can finish playing. */
export const MENU_CLOSE_MS = 250;

/** Per-row fade inside the menu open: rows share the second half of the
 * open, staggered from the anchor edge. Pure opacity, so it never disturbs
 * the shadow or the height motion. */
export const MENU_ROW_IN_MS = 250;

/** Per-row fade inside the menu close: the shrink leads, rows follow after a
 * short lead and all land with the container. */
export const MENU_ROW_OUT_MS = 50;
export const MENU_ROW_OUT_LEAD_MS = 50;

export function isReducedMotion(): boolean {
  if (typeof document === "undefined") return false;
  if (document.documentElement.dataset.reducedMotion === "true") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface MenuMotion {
  /** Render the menu: it is open, or still playing its close. */
  shown: boolean;
  /** Closed, and playing the open pop backwards. */
  closing: boolean;
  className: string;
  /** Spread on the menu element. A closing menu is only a picture of one:
   * inert and aria-hidden keep it out of the tab order, hit-testing and the
   * accessibility tree, so nothing (a person, a screen reader, a test
   * driver) can reach a menu that is already closed. */
  exitProps: { inert?: boolean; "aria-hidden"?: boolean };
  /** End the close the moment its animation finishes (animationend) instead
   * of waiting out the unmount timer. Idempotent; the timer stays as the
   * fallback for cancelled or never-started animations. */
  finishClosing: () => void;
}

/** Keep a menu mounted through the same 200ms pop it uses to open, so close
 * is the open motion played backwards. `kind: "menu"` only stretches the
 * unmount timer to the popover menu's own exit length; its open/close
 * classes live in the popover CSS module, so this returns none. `quick`
 * skips motion entirely: no enter/exit classes and no held close — the menu
 * unmounts on the render it closes. */
export function useMenuMotion(open: boolean, kind: "pop" | "menu" = "pop", quick = false): MenuMotion {
  // True from the menu's first open until its close has finished playing.
  const [mounted, setMounted] = useState(open);
  const closeMs = kind === "menu" ? MENU_CLOSE_MS : MENU_MOTION_MS;

  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    // Explicit opt-out (or OS reduced motion): unmount at once, no exit.
    if (quick || isReducedMotion()) {
      setMounted(false);
      return;
    }    const timer = window.setTimeout(() => setMounted(false), closeMs);
    return () => window.clearTimeout(timer);
  }, [open, mounted, closeMs, quick]);

  // Read `open` itself, not only the state that trails it, so the menu shows
  // on the render its trigger flips and goes inert on the render it closes.
  const closing = !open && mounted;
  // Plain closure (not a hook): the unit harness stands in for React state
  // without a real dispatcher, so hook calls would not survive it.
  const finishClosing = () => setMounted(false);
  return {
    shown: open || mounted,
    closing,
    className: quick || kind === "menu" ? "" : closing ? "animate-pop-out pointer-events-none" : "animate-pop-in",
    exitProps: closing ? { inert: true, "aria-hidden": true } : {},
    finishClosing,
  };
}

/** Remember the last open payload so a menu can finish closing after its
 * owner has already cleared the state that positioned it. */
export function useHeldMenuMotion<T>(value: T | null, kind: "pop" | "menu" = "pop", quick = false): MenuMotion & { value: T | null } {
  const motion = useMenuMotion(value != null, kind, quick);
  const held = useRef<T | null>(value);
  if (value != null) held.current = value;
  return { ...motion, value: value ?? held.current };
}
