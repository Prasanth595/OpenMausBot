// The recursive half of the menu: a level draws its rows and can have one
// submenu open; that submenu is a sheet holding a level of its own. Hover,
// keyboard, focus and motion state stay local to the level they belong to.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEvent as ReactAnimationEvent,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import motionStyles from "./popover-motion.module.css";
import styles from "./popover-menu.module.css";
import { isReducedMotion, useHeldMenuMotion } from "../MenuMotion";
import { menuEnabledRows, MenuRows, menuTabStops } from "./menu-rows";
import { setMenuHeightVars } from "./Popover";
import {
  EDGE_MARGIN,
  OPEN_DELAY_MS,
  POPOVER_WIDTH,
  SUBMENU_CLOSE_DELAY_MS,
  SUBMENU_CONFIRM_MS,
  SUBMENU_MIN_WIDTH,
  SUBMENU_OPEN_DELAY_MS,
  isRtlElement,
  nextMenuIndex,
  submenuPosition,
} from "./positioning";
import type { PopoverMenuItem, PopoverMenuProps } from "./PopoverMenu";
import type { PopoverVariant } from "./popover-types";

/** One submenu of a level: open, or still shrinking out after a close. */
interface ChildSheet {
  id: number;
  itemKey: string;
  item: PopoverMenuItem;
  /** The row that opened it: what a child submenu is placed beside. */
  row: HTMLElement;
  /** False while the sheet plays its close. */
  open: boolean;
  /** Focus the sheet's first row once it opens (keyboard and click opens). */
  focus: boolean;
}

let nextSheetId = 1;

/** Config shared by every level of one menu. */
export interface MenuChrome {
  roomy: boolean;
  variant: PopoverVariant;
  renderItem?: PopoverMenuProps["renderItem"];
  renderHeader?: PopoverMenuProps["renderHeader"];
  quick: boolean;
  portal: boolean;
  submenuClassName?: string;
  tabCloses: boolean;
  zIndex: number;
  isPointAnchor: boolean;
  closeMenu: (refocus?: boolean) => void;
  onLeaf: (item: PopoverMenuItem) => void;
  /** Every submenu sheet registers here so presses inside any of them count
   * as presses inside the menu. */
  registerInside: (id: number, element: HTMLElement | null) => void;
  onSheetsChange?: () => void;
}

/** Attributes for a level's content box: the root list carries the menu
 * markers, a submenu only its own chrome. */
type LevelContainerProps = HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, unknown>;

interface MenuLevelProps {
  items: PopoverMenuItem[];
  /** 0 for the root list, one more per submenu. */
  depth: number;
  chrome: MenuChrome;
  /** The menu is up; false while it plays its close, which takes every
   * level's sheets down with it. */
  menuOpen: boolean;
  /** The box a child submenu is placed beside: the shell for the root level,
   * this level's own sheet below it. */
  parentRef: RefObject<HTMLElement | null>;
  containerProps?: LevelContainerProps;
  containerRef?: RefObject<HTMLDivElement | null>;
  /** Closes this level: its parent's sheet, or the whole menu for the root. */
  closeSelf: (refocus?: boolean) => void;
}

/** One menu level: a list of rows plus the submenu those rows can open. */
export function MenuLevel({
  items,
  depth,
  chrome,
  menuOpen,
  parentRef,
  containerProps,
  containerRef,
  closeSelf,
}: MenuLevelProps) {
  const localContainer = useRef<HTMLDivElement>(null);
  const box = containerRef ?? localContainer;
  const [sheets, setSheets] = useState<ChildSheet[]>([]);
  // Two pending gestures must not share one slot: the hover-open intent of a
  // trigger row, and the close a submenu owes once the pointer walks away.
  const intentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the hover intent opened a submenu: a row click this soon after it is
  // the open gesture itself (still mid-press), not a toggle.
  const confirmAt = useRef<number | null>(null);
  const openRow = useRef<HTMLElement | null>(null);
  const openSheet = sheets.find((sheet) => sheet.open) ?? null;
  const openKey = openSheet?.itemKey ?? null;

  const cancelIntent = useCallback(() => {
    if (intentTimer.current) clearTimeout(intentTimer.current);
    intentTimer.current = null;
  }, []);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const cancelTimers = useCallback(() => {
    cancelIntent();
    cancelClose();
  }, [cancelIntent, cancelClose]);
  useEffect(() => cancelTimers, [cancelTimers]);

  useLayoutEffect(() => {
    openRow.current = openSheet?.row ?? null;
  }, [openSheet]);

  /** Starts the close of the level's sheets; a shrinking sheet stays mounted
   * until its motion ends. */
  const markClosed = useCallback(() => {
    setSheets((prev) =>
      prev.some((sheet) => sheet.open)
        ? prev.map((sheet) => (sheet.open ? { ...sheet, open: false, focus: false } : sheet))
        : prev,
    );
  }, []);

  const closeChild = useCallback(
    (focus = false) => {
      cancelTimers();
      confirmAt.current = null;
      markClosed();
      if (focus) openRow.current?.focus();
    },
    [cancelTimers, markClosed],
  );

  const openChild = useCallback(
    (item: PopoverMenuItem, row: HTMLElement, focus = false) => {
      cancelTimers();
      confirmAt.current = null;
      setSheets((prev) => {
        const closing = prev.map((sheet) => (sheet.open ? { ...sheet, open: false, focus: false } : sheet));
        // A trigger re-entered while its sheet is still shrinking reopens
        // that sheet instead of stacking a second copy on top of it.
        const reopened = closing.find((sheet) => !sheet.open && sheet.itemKey === item.key);
        return reopened
          ? closing.map((sheet) => (sheet === reopened ? { ...sheet, open: true, focus, row, item } : sheet))
          : [...closing, { id: nextSheetId++, itemKey: item.key, item, row, open: true, focus }];
      });
      chrome.onSheetsChange?.();
    },
    [cancelTimers, chrome],
  );

  /** A submenu closes a moment after the pointer leaves its trigger row, so a
   * diagonal path into the sheet or onto another trigger is forgiven; nothing
   * keeps it open on its own. */
  const armClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      confirmAt.current = null;
      markClosed();
    }, SUBMENU_CLOSE_DELAY_MS);
  }, [cancelClose, markClosed]);

  const rowEnter = useCallback(
    (item: PopoverMenuItem, row: HTMLElement) => {
      cancelIntent();
      if (item.submenu) {
        cancelClose();
        if (openKey === item.key) return;
        // Hover intent only: keyboard and click opens stay immediate.
        intentTimer.current = setTimeout(() => {
          intentTimer.current = null;
          openChild(item, row);
          confirmAt.current = performance.now();
        }, SUBMENU_OPEN_DELAY_MS);
        return;
      }
      // A row without a submenu is not where one lives: close the open one.
      cancelClose();
      if (openKey !== null) {
        closeTimer.current = setTimeout(() => {
          closeTimer.current = null;
          markClosed();
        }, OPEN_DELAY_MS);
      }
    },
    [cancelIntent, cancelClose, openKey, openChild, markClosed],
  );

  const rowLeave = useCallback(
    (item: PopoverMenuItem) => {
      cancelIntent();
      if (item.submenu && openKey !== null) armClose();
    },
    [cancelIntent, openKey, armClose],
  );

  // The sheet's own enter keeps it alive for the path that left the row to
  // reach it; leaving the sheet (or the level's whole box) starts the close.
  const sheetEnter = useCallback(() => cancelClose(), [cancelClose]);
  const sheetLeave = useCallback(() => {
    if (openKey !== null) armClose();
  }, [openKey, armClose]);
  const containerLeave = useCallback(() => {
    cancelIntent();
    if (openKey !== null) armClose();
  }, [cancelIntent, openKey, armClose]);

  const selectRow = useCallback(
    (item: PopoverMenuItem, row: HTMLElement) => {
      // An unavailable-but-reachable row says its reason; it does not act.
      if (item.ariaDisabled) return;
      if (!item.submenu) {
        chrome.onLeaf(item);
        return;
      }
      if (openKey !== item.key) {
        openChild(item, row, true);
        return;
      }
      const fresh = confirmAt.current !== null && performance.now() - confirmAt.current < SUBMENU_CONFIRM_MS;
      confirmAt.current = null;
      cancelClose();
      if (!fresh) closeChild();
    },
    [openKey, openChild, closeChild, cancelClose, chrome],
  );

  const sheetClosed = useCallback(
    (id: number) => {
      setSheets((prev) => prev.filter((sheet) => sheet.id !== id));
      chrome.onSheetsChange?.();
    },
    [chrome],
  );

  // The whole menu going down takes every level with it: each sheet shrinks
  // alongside its parent instead of vanishing under it.
  useEffect(() => {
    if (menuOpen) return;
    cancelTimers();
    markClosed();
  }, [menuOpen, cancelTimers, markClosed]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const menu = event.currentTarget;
      const rows = menuEnabledRows(menu);
      const current = rows.indexOf(document.activeElement as HTMLElement);
      const next = nextMenuIndex(event.key, current, rows.length);
      if (next != null) {
        event.preventDefault();
        rows[next]?.focus();
        return;
      }
      const rtl = isRtlElement(menu);
      const forward = rtl ? "ArrowLeft" : "ArrowRight";
      const back = rtl ? "ArrowRight" : "ArrowLeft";
      const focused = current >= 0 ? rows[current] : undefined;
      const item = focused ? items.find((entry) => entry.key === focused.dataset.menuKey) : undefined;
      if (event.key === forward && item?.submenu && focused) {
        event.preventDefault();
        openChild(item, focused, true);
        return;
      }
      // A submenu closes before the level that holds it: the deepest open
      // sheet goes first, then this one, all the way back to the root.
      if (depth > 0 && (event.key === back || event.key === "Escape")) {
        event.preventDefault();
        event.stopPropagation();
        if (openKey !== null) closeChild(true);
        else closeSelf(true);
        return;
      }
      if (event.key !== "Tab") return;
      // Tab walks the level's own stops: a band's focusables and the rows, in
      // document order, closing at either end (never a trap). With no band
      // focusables the rows stay arrow-only and Tab closes as before.
      const stops = menuTabStops(menu);
      const at = stops ? stops.indexOf(document.activeElement as HTMLElement) : -1;
      const step = event.shiftKey ? at - 1 : at + 1;
      if (stops && at >= 0 && step >= 0 && step < stops.length) {
        event.preventDefault();
        stops[step]?.focus();
        return;
      }
      if (!chrome.tabCloses) return;
      event.preventDefault();
      chrome.closeMenu(!chrome.isPointAnchor);
    },
    [items, depth, openKey, openChild, closeChild, closeSelf, chrome],
  );

  const { className: containerClassName, style: containerStyle, ...containerAttrs } = containerProps ?? {};
  return (
    <>
      <div
        ref={box}
        {...containerAttrs}
        onKeyDown={onKeyDown}
        onPointerLeave={containerLeave}
        // Plain wrapper: the sheet above already carries the styled surface,
        // so adding another here would double borders and trap the shadow
        // inside the outer overflow gate. rowFlow hooks the per-row stagger.
        className={cn(motionStyles.rowFlow, containerClassName)}
        style={containerStyle}
      >
        <MenuRows
          items={items}
          roomy={chrome.roomy}
          variant={chrome.variant}
          renderItem={chrome.renderItem}
          renderHeader={chrome.renderHeader}
          inSubmenu={depth > 0}
          submenuKey={openKey}
          onItem={selectRow}
          onRowEnter={rowEnter}
          onRowLeave={rowLeave}
        />
      </div>
      {sheets.map((sheet) => (
        <MenuSheet
          key={sheet.id}
          sheet={sheet}
          chrome={chrome}
          depth={depth + 1}
          parentRef={parentRef}
          closeSelf={closeChild}
          onClosed={sheetClosed}
          onPointerEnter={sheetEnter}
          onPointerLeave={sheetLeave}
        />
      ))}
    </>
  );
}

interface MenuSheetProps {
  sheet: ChildSheet;
  chrome: MenuChrome;
  /** The depth of the level this sheet renders. */
  depth: number;
  /** The box of the sheet this one is placed beside. */
  parentRef: RefObject<HTMLElement | null>;
  closeSelf: (refocus?: boolean) => void;
  onClosed: (id: number) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

/** A submenu: one animated sheet holding a level's rows. */
function MenuSheet({ sheet, chrome, depth, parentRef, closeSelf, onClosed, onPointerEnter, onPointerLeave }: MenuSheetProps) {
  // The sheet stays mounted through its own shrink so closing it mirrors
  // opening: whole-container expand in, whole-container shrink out.
  const motion = useHeldMenuMotion(sheet.open ? sheet.item : null, "menu", chrome.quick);
  const item = motion.value;
  const selfRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // Same measure-first gating as the main sheet: reading the height while
  // the grow runs returns the mid-animation height.
  const [measured, setMeasured] = useState(false);
  // Overflow gate for the sheet's grow, mirroring the main sheet's.
  const [animating, setAnimating] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  // Keyboard/click opens that arrive mid-grow park here until the grow's
  // animationend, instead of focusing (and scroll-jumping) mid-motion.
  const focusQueued = useRef(false);

  useLayoutEffect(() => {
    chrome.registerInside(sheet.id, selfRef.current);
    return () => chrome.registerInside(sheet.id, null);
  }, [chrome, sheet.id]);

  // Keep the sheet inside the window beside its parent and the row that
  // opened it, re-measuring when the window moves under it. The sheet's own
  // height feeds the menu motion in the same pass; submenus always reveal
  // downward like the reference.
  useLayoutEffect(() => {
    if (!motion.shown) return;
    const place = () => {
      const shell = selfRef.current;
      if (!shell) return;
      // Same rule as the main sheet: pre-animation the outer box reads at its
      // natural height (border included, like `height` animates it), so the
      // grow lands without a last-frame snap; mid-animation, read the inner
      // surface, which the height animation never resizes.
      const naturalHeight = !measured
        ? shell.offsetHeight || 0
        : innerRef.current?.offsetHeight || shell.offsetHeight || 0;
      if (!measured) {
        setMenuHeightVars(shell, naturalHeight, false);
        setMeasured(true);
        if (!chrome.quick && !isReducedMotion()) setAnimating(true);
      }
      const parent = chrome.portal ? parentRef.current : null;
      if (!parent) return;
      const placed = submenuPosition(
        parent.getBoundingClientRect(),
        sheet.row.getBoundingClientRect(),
        { width: shell.offsetWidth || SUBMENU_MIN_WIDTH, height: naturalHeight },
        { width: window.innerWidth, height: window.innerHeight },
        isRtlElement(parent),
      );
      setPosition((prev) => (prev && prev.left === placed.left && prev.top === placed.top ? prev : { ...placed }));
    };
    place();
    if (!chrome.portal) return;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [motion.shown, measured, chrome.portal, chrome.quick, parentRef, sheet.row]);

  useEffect(() => {
    if (motion.shown) return;
    setMeasured(false);
    setAnimating(false);
    focusQueued.current = false;
    onClosed(sheet.id);
  }, [motion.shown, onClosed, sheet.id]);

  useLayoutEffect(() => {
    if (!sheet.open || !sheet.focus) return;
    // With no motion, focus at once on the next frame; otherwise park it until
    // the grow finishes so the clip never scroll-jumps.
    if (chrome.quick || isReducedMotion()) {
      requestAnimationFrame(() => {
        if (innerRef.current) menuEnabledRows(innerRef.current)[0]?.focus();
      });
      return;
    }
    focusQueued.current = true;
  }, [sheet.open, sheet.focus, chrome.quick]);

  // Row animations bubble past via the target check. A starting animation
  // raises the gate, covering reopens that never re-run the measuring pass.
  const onAnimationEnd = (event: ReactAnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (motion.closing) {
      motion.finishClosing();
      return;
    }
    setAnimating(false);
    if (!focusQueued.current) return;
    focusQueued.current = false;
    menuEnabledRows(innerRef.current)[0]?.focus({ preventScroll: true });
  };
  const onAnimationStart = (event: ReactAnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    setAnimating(true);
  };

  if (!motion.shown || !item?.submenu) return null;
  const subShellClass = chrome.variant === "styled" ? styles.subShell : styles.subShellBare;
  const innerClass = chrome.variant === "styled" ? styles.subInner : "";
  const motionClass = chrome.quick || !measured ? "" : motion.closing ? motionStyles.menuOut : motionStyles.menuIn;
  const gateOverflow = motion.closing || animating;
  // A portaled sheet escapes its parent's overflow and any transform the
  // parent's own motion is running: it is a child of body, placed in viewport
  // coordinates. Inline (portal={false}) sheets stay in the trigger's subtree.
  const sheetNode = (
    <div
      ref={selfRef}
      role="menu"
      aria-label={typeof item.title === "string" ? item.title : item.key}
      data-popover-submenu
      data-popover-variant={chrome.variant}
      {...motion.exitProps}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onAnimationEnd={onAnimationEnd}
      onAnimationStart={onAnimationStart}
      style={
        chrome.portal
          ? {
              position: "fixed",
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              minWidth: SUBMENU_MIN_WIDTH,
              width: "max-content",
              maxWidth: `min(${POPOVER_WIDTH + 40}px, calc(100vw - ${EDGE_MARGIN * 2}px))`,
              visibility: position ? undefined : "hidden",
              zIndex: chrome.zIndex + depth,
            }
          : undefined
      }
      className={cn(subShellClass, !chrome.portal && styles.subInline, motionClass, chrome.submenuClassName)}
    >
      <MenuLevel
        items={item.submenu}
        depth={depth}
        chrome={chrome}
        menuOpen={sheet.open}
        parentRef={selfRef}
        containerRef={innerRef}
        // Same scroll caps as the main sheet: a submenu taller than the window
        // scrolls inside its own box instead of running off-screen with no way
        // to reach the cut-off rows.
        containerProps={{
          className: cn(innerClass, gateOverflow ? motionStyles.menuAnimating : ""),
          style: {
            maxHeight: `calc(100dvh - ${EDGE_MARGIN * 2}px)`,
            overflowY: gateOverflow ? ("hidden" as const) : ("auto" as const),
            overscrollBehavior: "contain" as const,
          },
        }}
        closeSelf={closeSelf}
      />
    </div>
  );
  if (!chrome.portal || typeof document === "undefined") return sheetNode;
  return createPortal(sheetNode, document.body);
}
