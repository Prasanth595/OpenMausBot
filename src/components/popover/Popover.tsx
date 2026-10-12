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

/** Where an open menu's focus lands: a radio menu on its current choice —
 * the arrows move from there, so its neighbours (and their reasons) are one
 * step away — any other menu on its first runnable row. */
function firstFocusTarget(sheet: HTMLElement): HTMLElement | null {
  return (
    sheet.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not(:disabled)') ??
    sheet.querySelector<HTMLElement>(MENU_ROW_SELECTOR) ??
    sheet.querySelector<HTMLElement>("button:not(:disabled), [href], [tabindex]")
  );
}

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

export function Popover({
  ariaLabel,
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
  const internalContentRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const contentRef = externalContentRef ?? internalContentRef;
  // The inner surface keeps its natural height while the outer shell plays
  // the height animation, so all menu measuring reads here, never the
  // animated outer box.
  const focusFirst = useRef(false);
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
  // press that closes must still reach what the user aimed at.
  const insideRef = useRef({
    contains: (target: unknown) =>
      [rootRef.current, contentRef.current, ...extraInsideRefs.map((ref) => ref.current)].some((node) =>
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
    if (!open) return;
    if (focusFirstOnOpen) focusFirst.current = true;
    if (!focusFirst.current) return;
    if (portal && !position) return;
    if (isMenuMotion && !quick && !isReducedMotion()) return;
    focusFirst.current = false;
    const sheet = contentRef.current;
    if (!sheet) return;
    (firstFocusTarget(sheet) ?? sheet).focus();
  }, [open, focusFirstOnOpen, portal, position, contentRef, isMenuMotion, quick]);

  const focusFirstRow = useCallback(() => {
    if (!focusFirst.current) return;
    focusFirst.current = false;
    const sheet = contentRef.current;
    if (!sheet) return;
    (firstFocusTarget(sheet) ?? sheet).focus({ preventScroll: true });
  }, [contentRef]);

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
    focusFirstRow();
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
    if (!event.relatedTarget || !rootRef.current?.contains(event.relatedTarget as Node)) setOpen(false);
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
      aria-label={ariaLabel}
      data-popover
      data-popover-placement={resolved}
      data-popover-variant={variant}
      {...motion.exitProps}
      tabIndex={-1}
      onPointerEnter={sheetHoverEnter}
      onPointerLeave={hoverClose}
      onKeyDown={(event) => {
        if (event.key === "Tab" && tabCloses) {
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
        ref={triggerRef}
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
            focusFirst.current = event.detail === 0;
            setPinned(true);
            setOpen(true);
          }
        }}
        onKeyDown={(event) => {
          if (open || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
          event.preventDefault();
          focusFirst.current = true;
          setPinned(true);
          setOpen(true);
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
