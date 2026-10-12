import { useLayoutEffect, useRef, useState } from "react";

/** Same length as `--animate-pop-in` in styles.css. */
export const MENU_MOTION_MS = 200;

/** Exit length of the popover menu motion (its own CSS module). The sheet
 * must stay mounted this long so the shrink can finish playing. */
export const MENU_CLOSE_MS = 250;

function reducedMotion(): boolean {
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
}

/** Keep a menu mounted through the same 200ms pop it uses to open, so close
 * is the open motion played backwards. `kind: "menu"` only stretches the
 * unmount timer to the popover menu's own exit length; its open/close
 * classes live in the popover CSS module, so this returns none. */
export function useMenuMotion(open: boolean, kind: "pop" | "menu" = "pop"): MenuMotion {
  // True from the menu's first open until its close has finished playing.
  const [mounted, setMounted] = useState(open);
  const closeMs = kind === "menu" ? MENU_CLOSE_MS : MENU_MOTION_MS;

  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    if (reducedMotion()) {
      setMounted(false);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), closeMs);
    return () => window.clearTimeout(timer);
  }, [open, mounted, closeMs]);

  // Read `open` itself, not only the state that trails it, so the menu shows
  // on the render its trigger flips and goes inert on the render it closes.
  const closing = !open && mounted;
  return {
    shown: open || mounted,
    closing,
    className: kind === "menu" ? "" : closing ? "animate-pop-out pointer-events-none" : "animate-pop-in",
    exitProps: closing ? { inert: true, "aria-hidden": true } : {},
  };
}

/** Remember the last open payload so a menu can finish closing after its
 * owner has already cleared the state that positioned it. */
export function useHeldMenuMotion<T>(value: T | null, kind: "pop" | "menu" = "pop"): MenuMotion & { value: T | null } {
  const motion = useMenuMotion(value != null, kind);
  const held = useRef<T | null>(value);
  if (value != null) held.current = value;
  return { ...motion, value: value ?? held.current };
}
