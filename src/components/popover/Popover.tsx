// Generic floating shell: trigger- or point-anchored, portal or inline,
// headless or styled. It knows nothing about menus — PopoverMenu composes on
// top of it. Business state never lives here; everything arrives via props.
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEvent as ReactAnimationEvent,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { popoverClosesOnKey, popoverClosesOnPointer } from "@/hooks/use-popover-dismiss";
import { isReducedMotion, useMenuMotion } from "../MenuMotion";
import motionStyles from "./popover-motion.module.css";
import styles from "./popover.module.css";
import {
  CLOSE_DELAY_MS,
  EDGE_MARGIN,
  OPEN_DELAY_MS,
  POPOVER_WIDTH,
  isRtlElement,
  pointPopoverPosition,
  triggerPopoverPosition,
  type PopoverPlacement,
} from "./positioning";
import type { PopoverDismissOptions, PopoverProps } from "./popover-types";

/** Height-animation variables for the menu motion, written imperatively in
 * the same pre-paint pass that positions the sheet so the first painted
 * frame already grows from the right size. `upward` pins the far edge while
 * opening above the anchor. */
export function setMenuHeightVars(sheet: HTMLElement, height: number, upward: boolean) {
  const full = `${Math.max(height, 0)}px`;
  sheet.style.setProperty("--menu-h", full);
  sheet.style.setProperty("--menu-ty-from", upward ? full : "0px");
  sheet.style.setProperty("--menu-ty-to", upward ? `${Math.max(height, 0) * 0.65}px` : "0px");
}

/** A row the keyboard can land on anywhere under a sheet: plain items and
 * radio choices, skipping natively disabled rows (an aria-disabled row stays
 * reachable, so it can still say why it is unavailable). */
export const MENU_ROW_SELECTOR = '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)';

/** A plain focusable a non-menu sheet can offer: a dialog's buttons, links
 * and tabbables. */
const SHEET_FOCUSABLE = "button:not(:disabled), [href], [tabindex]";

/** Where an open menu's focus lands: a radio menu on its current choice —
 * the arrows move from there, so its neighbours (and their reasons) are one
 * step away — any other menu on its first runnable row. */
function firstFocusTarget(sheet: HTMLElement): HTMLElement | null {
  return (
    sheet.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not(:disabled)') ??
    sheet.querySelector<HTMLElement>(MENU_ROW_SELECTOR) ??
    sheet.querySelector<HTMLElement>(SHEET_FOCUSABLE)
  );
}

/** The same order read from its far end, for an ArrowUp on the trigger: the
 * last runnable row, else the last plain focusable. */
function lastFocusTarget(sheet: HTMLElement): HTMLElement | null {
  const rows = sheet.querySelectorAll<HTMLElement>(MENU_ROW_SELECTOR);
  if (rows.length > 0) return rows[rows.length - 1]!;
  const focusables = sheet.querySelectorAll<HTMLElement>(SHEET_FOCUSABLE);
  return focusables[focusables.length - 1] ?? null;
}

/** Where a focus request lands, the sheet itself (tabIndex -1) as the last
 * resort. A menu button's keyboard conventions pick the edge: ArrowUp into
 * the last target, everything else into the first. */
function edgeFocusTarget(sheet: HTMLElement, edge: "first" | "last"): HTMLElement {
  return (edge === "first" ? firstFocusTarget(sheet) : lastFocusTarget(sheet)) ?? sheet;
}

/** Normalizes the hover `leave` dismissal option into an enabled flag plus
 * open/close delays. `true` opts into the default hover timings, a missing or
 * `false` value disables hover dismissal, and an object overrides either delay. */
function leaveDelays(leave: PopoverDismissOptions["leave"]): {  enabled: boolean;
  openDelay: number;
  closeDelay: number;
} {
  if (leave === true) return { enabled: true, openDelay: OPEN_DELAY_MS, closeDelay: CLOSE_DELAY_MS };
  if (!leave) return { enabled: false, openDelay: OPEN_DELAY_MS, closeDelay: CLOSE_DELAY_MS };
  return {
    enabled: true,
    openDelay: leave.openDelay ?? OPEN_DELAY_MS,
    closeDelay: leave.closeDelay ?? CLOSE_DELAY_MS,
  };
}

// Stable defaults: fresh object/array literals here would re-run the
// placement and dismissal effects on every render.
const DEFAULT_ANCHOR = { kind: "trigger" } as const;
const NO_EXTRA_REFS: Array<{ current: HTMLElement | null }> = [];

/** Generic floating shell: trigger- or point-anchored, portal or inline,
 * headless or styled. It knows nothing about menus — PopoverMenu composes on
 * top of it. Business state never lives here; everything arrives via props. */
export function Popover({
  ariaLabel,
  sheetAriaLabel,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  anchor = DEFAULT_ANCHOR,
  placement = "auto",
  align = "start",
  offset,
  width = POPOVER_WIDTH,
  dismiss,
  trigger,
  triggerClassName = "w-full",
  triggerTitle,
  triggerRef: externalTriggerRef,
  variant = "styled",
  className,
  style,
  portal = true,
  zIndex = 60,
  contentRole = "dialog",
  motionKind = "pop",
  quick = false,
  focusFirstOnOpen = false,
  restoreFocusOnClose = false,
  triggerDisabled = false,
  contentRef: externalContentRef,
  extraInsideRefs = NO_EXTRA_REFS,
  repositionKey,
  onPlaced,
  children,
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  const outsidePress = dismiss?.outsidePress ?? true;
  const escape = dismiss?.escape ?? true;
  const tabCloses = dismiss?.tabCloses ?? true;
  const leave = leaveDelays(dismiss?.leave);
  const isPoint = anchor.kind === "point";
  const isMenuMotion = motionKind === "menu";

  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; resolved: Exclude<PopoverPlacement, "auto"> } | null>(null);
  // The height animation must measure the natural height first: reading it
  // while the grow is running returns the mid-animation height and corrupts
  // both the motion and the placement. So the motion classes only apply once
  // measured, and vars freeze for the session.
  const [measured, setMeasured] = useState(false);
  // Overflow gate for the open grow: on from the measuring pass until the
  // grow's animationend. The close shrink needs no state, it derives from
  // `closing`. Never keyframed: overflow is not interpolable, so flipping it
  // in a keyframe lands the scrollbar flip exactly on the last frame.
  const [animating, setAnimating] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The caller's own handle on the trigger button, if it keeps one: merged
  // here so a dialog opened from a row can focus the button it came from.
  const attachTriggerRef = useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node;
      if (externalTriggerRef) externalTriggerRef.current = node;
    },
    [externalTriggerRef],
  );
  const internalContentRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const contentRef = externalContentRef ?? internalContentRef;
  // The inner surface keeps its natural height while the outer shell plays
  // the height animation, so all menu measuring reads here, never the
  // animated outer box.

  // Which end of the sheet a pending focus request lands on: armed by a
  // keyboard open, by `focusFirstOnOpen`, and by Tab or the arrows pressed
  // while focus is still on the trigger. Null while nothing is pending.
  const pendingFocus = useRef<null | "first" | "last">(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuId = useId();
  const motion = useMenuMotion(open, motionKind, quick);
  const onPlacedRef = useRef(onPlaced);
  onPlacedRef.current = onPlaced;

  // A fresh mount measures before animating; reset when fully unmounted.
  useEffect(() => {
    if (!motion.shown) {
      setMeasured(false);
      setAnimating(false);
    }
  }, [motion.shown]);

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  // A context menu has no trigger to hand focus back to: remember who held
  // it when the sheet opened and return it when the sheet closes. Declared
  // before the focus effect below, so the opener is captured before focus
  // moves onto the first row.
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!restoreFocusOnClose) return;
    if (open) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, [open, restoreFocusOnClose]);

  const close = useCallback(
    (refocus = false) => {
      clearTimers();
      setPinned(false);
      setOpen(false);
      if (refocus) triggerRef.current?.focus();
    },
    [clearTimers, setOpen],
  );

  const toggle = useCallback(() => {
    clearTimers();
    if (open) close();
    else {
      setPinned(true);
      setOpen(true);
    }
  }, [clearTimers, close, open, setOpen]);

  // Dismissal honors each flag independently. Deliberately no backdrop: the
  // press that closes must still reach what the user aimed at. The extra
  // inside refs are read through a live slot: a consumer may swap them after
  // mount, and a stale first-render list would misjudge the press.
  const extraInsideRefsLive = useRef(extraInsideRefs);
  extraInsideRefsLive.current = extraInsideRefs;
  const insideRef = useRef({
    contains: (target: unknown) =>
      [rootRef.current, contentRef.current, ...extraInsideRefsLive.current.map((ref) => ref.current)].some((node) =>
        node?.contains(target as Node),
      ),
  });

  useEffect(() => {
    if (!open || (!outsidePress && !escape)) return;
    const onKey = (event: KeyboardEvent) => {
      if (!escape || !popoverClosesOnKey(event)) return;
      event.preventDefault();
      close(!isPoint);
    };
    const onDown = (event: PointerEvent) => {
      if (!outsidePress) return;
      if (popoverClosesOnPointer(event.target, insideRef.current)) close(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open, outsidePress, escape, close, isPoint, contentRef, extraInsideRefs]);

  // Measure the sheet against its anchor and keep it inside the window.
  useLayoutEffect(() => {
    if (!motion.shown || !portal) return;
    const place = () => {
      const sheet = contentRef.current;
      if (!sheet) return;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      // Before the first paint there is no animation yet, so the outer box
      // reads at its natural height — and with border-box sizing that is
      // exactly what `height` animates, border included, so the grow lands
      // without a snap on its last frame. Once measured the outer box may be
      // mid-animation, so positioning keeps reading the inner surface, which
      // the height animation never resizes.
      const naturalHeight = measured
        ? innerRef.current?.offsetHeight || sheet.offsetHeight || 0
        : sheet.offsetHeight || 0;
      const size = { width: sheet.offsetWidth || width, height: naturalHeight };
      if (isPoint) {
        const next = pointPopoverPosition(
          { x: anchor.x, y: anchor.y },
          size,
          viewport,
          { offset, rtl: isRtlElement(sheet) },
        );
        if (isMenuMotion && !measured) {
          setMenuHeightVars(sheet, naturalHeight, next.resolved === "above");
          setMeasured(true);
          if (!quick && !isReducedMotion()) setAnimating(true);
        }
        setPosition((prev) =>
          prev && prev.left === next.left && prev.top === next.top && prev.resolved === next.resolved ? prev : next,
        );
        onPlacedRef.current?.({ left: next.left, top: next.top });
        return;
      }
      const triggerEl = triggerRef.current;
      if (!triggerEl) return;
      const next = triggerPopoverPosition(triggerEl.getBoundingClientRect(), size, viewport, {
        placement,
        align,
        offset,
        rtl: isRtlElement(triggerEl),
      });
      if (isMenuMotion && !measured) {
        setMenuHeightVars(sheet, naturalHeight, next.resolved === "above");
        setMeasured(true);
        if (!quick && !isReducedMotion()) setAnimating(true);
      }
      setPosition((prev) =>
        prev && prev.left === next.left && prev.top === next.top && prev.resolved === next.resolved ? prev : next,
      );
      onPlacedRef.current?.({ left: next.left, top: next.top });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [motion.shown, portal, isPoint, anchor, placement, align, offset, width, repositionKey, contentRef, isMenuMotion, measured]);

  // Inline sheets skip positioning but still need their measured height for
  // the menu motion, in the same pre-paint pass.
  useLayoutEffect(() => {
    if (!motion.shown || portal || !isMenuMotion) return;
    const sheet = contentRef.current;
    if (!sheet) return;
    if (!measured) {
      // Same outer-box rule as the portal path above: pre-animation the shell
      // reads at its natural height, border included.
      const naturalHeight = sheet.offsetHeight || 0;
      setMenuHeightVars(sheet, naturalHeight, placement === "above");
      setMeasured(true);
      if (!quick && !isReducedMotion()) setAnimating(true);
    }
  }, [motion.shown, portal, isMenuMotion, placement, repositionKey, contentRef, measured]);

  // A keyboard open lands on the first runnable row; `focusFirstOnOpen`
  // extends that to pointer opens (context menus have no keyboard path in).
  // When the grow plays, only after it finishes: focusing mid-grow scrolls
  // the clipping shell and it snaps back on the last frame (the reference
  // focuses post-animation for the same reason). With no motion, at once
  // once placed.
  useEffect(() => {
    if (!open) {
      // A request that never landed dies with the sheet it was aimed at.
      pendingFocus.current = null;
      return;
    }
    if (focusFirstOnOpen && !pendingFocus.current) pendingFocus.current = "first";
    const edge = pendingFocus.current;
    if (!edge) return;
    if (portal && !position) return;
    if (isMenuMotion && !quick && !isReducedMotion()) return;
    pendingFocus.current = null;
    const sheet = contentRef.current;
    if (!sheet) return;
    edgeFocusTarget(sheet, edge).focus();
  }, [open, focusFirstOnOpen, portal, position, contentRef, isMenuMotion, quick]);

  const focusPending = useCallback(() => {
    const edge = pendingFocus.current;
    if (!edge) return;
    pendingFocus.current = null;
    const sheet = contentRef.current;
    if (!sheet) return;
    edgeFocusTarget(sheet, edge).focus({ preventScroll: true });
  }, [contentRef]);

  // Tab and the arrows on the trigger put focus inside a sheet that is already
  // up (a pointer open leaves it on the trigger). A sheet mid-grow parks the
  // request instead: focusing while it clips scrolls the shell and snaps back
  // when the grow lands.
  const focusIntoSheet = useCallback(
    (edge: "first" | "last") => {
      pendingFocus.current = edge;
      if (portal && !position) return;
      if (isMenuMotion && animating) return;
      focusPending();
    },
    [portal, position, isMenuMotion, animating, focusPending],
  );

  // The shell's own animations report back (row animations bubble past via
  // the target check): a finished close unmounts at once instead of waiting
  // out the timer, a finished open drops the overflow gate and lands focus.
  // A starting animation raises the gate, covering restarts (a reopen
  // mid-close never re-runs the measuring pass that raised it first).
  const onShellAnimationEnd = (event: ReactAnimationEvent<HTMLDivElement>) => {
    if (!isMenuMotion || event.target !== event.currentTarget) return;
    if (motion.closing) {
      motion.finishClosing();
      return;
    }
    setAnimating(false);
    focusPending();
  };
  const onShellAnimationStart = (event: ReactAnimationEvent<HTMLDivElement>) => {
    if (!isMenuMotion || event.target !== event.currentTarget) return;
    setAnimating(true);
  };

  const hoverOpen = () => {
    if (!leave.enabled || triggerDisabled || pinned || isPoint) return;
    clearTimers();
    openTimer.current = setTimeout(() => setOpen(true), leave.openDelay);
  };
  const hoverClose = () => {
    if (!leave.enabled || pinned || isPoint) return;
    clearTimers();
    closeTimer.current = setTimeout(() => setOpen(false), leave.closeDelay);
  };
  // The pointer resting on the sheet keeps a hover-open up: the close grace
  // armed when it left the trigger must die here, or the menu closes under
  // the pointer on its way from the trigger into the sheet.
  const sheetHoverEnter = () => {
    if (!leave.enabled || pinned || isPoint) return;
    clearTimers();
  };

  const onRootBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (!leave.enabled || pinned || isPoint) return;
    // The sheet sits outside the root (a portal), so focus walking from the
    // trigger into it is a move between the two halves of one popover, not
    // focus leaving: judge it with the same inside test dismissal uses.
    if (!event.relatedTarget || !insideRef.current.contains(event.relatedTarget)) setOpen(false);
  };

  const resolved = position?.resolved ?? (placement === "auto" ? "below" : placement);
  // Menu motion splits in two layers so the shadow never jumps: the outer
  // shell animates height (its shadow grows with the box) while the inner
  // surface only hides overflow during the grow/shrink. `quick` skips both.
  // The gate is state, not a keyframe: closing derives it, the open grow
  // holds it from measuring until its animationend.
  const motionClass =
    quick || !measured
      ? ""
      : isMenuMotion
        ? motion.closing
          ? motionStyles.menuOut
          : motionStyles.menuIn
        : motion.className;
  const gateOverflow = isMenuMotion && (motion.closing || animating);
  const animatingClass = gateOverflow ? motionStyles.menuAnimating : "";
  // Static chrome lives in the module; the class strings below only pick
  // which module class applies. (The pop surface keeps its own name so the
  // headless/pop distinction still reads at the call site.)
  const surfaceClass = variant === "styled" ? styles.shell : "";
  // Menu motion puts the look on the animated outer shell so its shadow is
  // the box's own (an element's own shadow is never clipped by its own
  // overflow); the inner layer is just padding plus the scroll container the
  // grow reveals. A shadow left on the inner surface would be cut off by the
  // outer overflow gate, at rest as well as mid-motion.
  const menuShellClass = variant === "styled" ? styles.menuShell : styles.menuShellBare;
  const menuInnerClass = variant === "styled" ? styles.menuInner : "";

  const contentStyle: CSSProperties | undefined = portal
    ? {
        position: "fixed",
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        width,
        maxWidth: `calc(100vw - ${EDGE_MARGIN * 2}px)`,
        // Menu motion scrolls its inner surface instead, so the outer shell
        // (and its shadow) tracks the animated height exactly.
        ...(isMenuMotion
          ? null
          : {
              maxHeight: `calc(100dvh - ${EDGE_MARGIN * 2}px)`,
              overflowY: "auto" as const,
              overscrollBehavior: "contain" as const,
            }),
        visibility: position ? undefined : "hidden",
        zIndex,
        ...style,
      }
    : style;
  const menuInnerStyle: CSSProperties | undefined = !isMenuMotion
    ? undefined
    : portal
      ? {
          maxHeight: `calc(100dvh - ${EDGE_MARGIN * 2}px)`,
          overflowY: gateOverflow ? ("hidden" as const) : ("auto" as const),
          overscrollBehavior: "contain" as const,
        }
      : gateOverflow
        ? { overflowY: "hidden" as const }
        : undefined;

  const inlinePlacementClass =
    placement === "above"
      ? styles.placeAbove
      : placement === "before"
        ? styles.placeBefore
        : placement === "after"
          ? styles.placeAfter
          : styles.placeBelow;

  const sheet = motion.shown && (
    <div
      ref={contentRef}
      id={menuId}
      role={contentRole}
      aria-label={sheetAriaLabel ?? ariaLabel}
      data-popover
      data-popover-placement={resolved}
      data-popover-variant={variant}
      {...motion.exitProps}
      tabIndex={-1}
      onPointerEnter={sheetHoverEnter}
      onPointerLeave={hoverClose}
      onKeyDown={(event) => {
        // A descendant that moved focus itself (a menu's header keeps Tab
        // inside the sheet) has already prevented the default.
        if (event.key === "Tab" && tabCloses && !event.defaultPrevented) {
          event.preventDefault();
          close(!isPoint);
        }
      }}
      onAnimationEnd={onShellAnimationEnd}
      onAnimationStart={onShellAnimationStart}
      style={contentStyle}
      className={cn(
        isMenuMotion ? menuShellClass : surfaceClass,
        !portal && inlinePlacementClass,
        motionClass,
        !isMenuMotion && className,
      )}
    >
      {isMenuMotion ? (
        <div ref={innerRef} style={menuInnerStyle} className={cn(menuInnerClass, animatingClass, className)}>
          {typeof children === "function" ? children({ open, close }) : children}
        </div>
      ) : typeof children === "function" ? (
        children({ open, close })
      ) : (
        children
      )}
    </div>
  );

  if (isPoint || !trigger) {
    if (!portal) return <>{sheet}</>;
    return typeof document !== "undefined" && sheet ? createPortal(sheet, document.body) : null;
  }

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onPointerEnter={hoverOpen}
      onPointerLeave={hoverClose}
      onFocus={() => {
        if (leave.enabled && !triggerDisabled) setOpen(true);
      }}
      onBlur={onRootBlur}
    >
      <button
        ref={attachTriggerRef}
        type="button"
        disabled={triggerDisabled}
        aria-disabled={triggerDisabled || undefined}
        aria-haspopup={contentRole === "menu" ? "menu" : "dialog"}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        title={triggerTitle}
        onClick={(event) => {
          if (triggerDisabled) return;
          clearTimers();
          if (open && (pinned || !leave.enabled)) close();
          else {
            pendingFocus.current = event.detail === 0 ? "first" : null;
            setPinned(true);
            setOpen(true);
          }
        }}
        onKeyDown={(event) => {
          const arrow = event.key === "ArrowUp" || event.key === "ArrowDown";
          // A menu button's own convention: ArrowUp lands on the far end of
          // the list, ArrowDown and Tab on its first target.
          const edge = event.key === "ArrowUp" ? "last" : "first";
          if (!open) {
            if (!arrow) return;
            event.preventDefault();
            pendingFocus.current = edge;
            setPinned(true);
            setOpen(true);
            return;
          }
          // Open with focus still on the trigger (a pointer open leaves it
          // there): Tab and the arrows move into the sheet instead of moving
          // on to the next page element past the portal. Shift+Tab stays with
          // the browser, walking back out of the trigger.
          if (!arrow && (event.key !== "Tab" || event.shiftKey)) return;
          event.preventDefault();
          setPinned(true);
          focusIntoSheet(edge);
        }}
        className={triggerClassName}
      >
        {trigger({ open, toggle, close })}
      </button>

      {!portal ? (
        sheet
      ) : typeof document !== "undefined" && sheet ? (
        createPortal(sheet, document.body)
      ) : null}
    </div>
  );
}
