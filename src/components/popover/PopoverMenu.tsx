// Generic menu composed on the Popover shell. Items arrive purely through
// props — no store, no i18n, no network here. Supports one submenu level,
// keyboard navigation and headless/styled surfaces.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type AnimationEvent as ReactAnimationEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import motionStyles from "./popover-motion.module.css";
import styles from "./popover-menu.module.css";
import {
  MENU_CLOSE_MS,
  MENU_OPEN_MS,
  MENU_ROW_IN_MS,
  MENU_ROW_OUT_LEAD_MS,
  MENU_ROW_OUT_MS,
  isReducedMotion,
  useHeldMenuMotion,
} from "../MenuMotion";
import { Popover, setMenuHeightVars } from "./Popover";
import {
  CLOSE_DELAY_MS,
  EDGE_MARGIN,
  OPEN_DELAY_MS,
  POPOVER_WIDTH,
  SUBMENU_MIN_WIDTH,
  SUBMENU_OPEN_DELAY_MS,
  isRtlElement,
  nextMenuIndex,
  submenuPosition,
} from "./positioning";
import type {
  PopoverAlign,
  PopoverAnchor,
  PopoverDismissOptions,
  PopoverPlacement,
  PopoverVariant,
} from "./popover-types";

export interface PopoverMenuItem {
  key: string;
  label: ReactNode;
  subtitle?: ReactNode;
  note?: ReactNode;
  icon?: ReactNode;
  active?: boolean;
  attention?: boolean;
  attentionTone?: "danger" | "accent";
  disabled?: boolean;
  separatorBefore?: boolean;
  heading?: string;
  trailing?: ReactNode;
  value?: string;
  keepOpen?: boolean;
  /** Opens beside the menu instead of acting; onSelect is not called. */
  submenu?: PopoverMenuItem[];
  onSelect?: () => void;
  tourId?: string;
}

export interface PopoverMenuRenderDefaults {
  className: string;
  inSubmenu: boolean;
}

export interface PopoverMenuProps {
  items: PopoverMenuItem[];
  ariaLabel: string;
  anchor?: PopoverAnchor;
  placement?: PopoverPlacement;
  align?: PopoverAlign;
  offset?: number;
  width?: number;
  dismiss?: PopoverDismissOptions;
  variant?: PopoverVariant;
  className?: string;
  submenuClassName?: string;
  trigger?: (api: { open: boolean; toggle: () => void; close: (refocus?: boolean) => void }) => ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  onSelect?: (key: string) => void;
  /** Replaces the default row button. Heading/separator chrome stays default.
   * Custom rows must render `[role="menuitem"][data-menu-key]` for keyboard
   * navigation to find them. */
  renderItem?: (item: PopoverMenuItem, defaults: PopoverMenuRenderDefaults) => ReactNode;
  portal?: boolean;
  zIndex?: number;
  /** Skip motion entirely (main sheet and submenu): no enter/exit and no
   * held close. Default false. */
  quick?: boolean;
}

const menuEnabledRows = (menu: HTMLElement | null) =>
  menu ? [...menu.querySelectorAll<HTMLElement>(':scope > div > [role="menuitem"]:not(:disabled)')] : [];

const SUBMENU_QUERY = ':scope > div > [role="menuitem"]:not(:disabled)';

function DefaultRow({
  item,
  roomy,
  openSubmenu,
  variant,
  renderItem,
  inSubmenu,
  onItem,
  onSubmenuHover,
  onSubmenuExit,
  onSubmenuLeave,
}: {
  item: PopoverMenuItem;
  roomy: boolean;
  openSubmenu?: string | null;
  variant: PopoverVariant;
  renderItem?: PopoverMenuProps["renderItem"];
  inSubmenu: boolean;
  onItem: (item: PopoverMenuItem, element: HTMLElement) => void;
  onSubmenuHover?: (item: PopoverMenuItem, element: HTMLElement) => void;
  /** The pointer left this row: a hover-open that has not fired yet dies
   * here, so resting on the row is what opens, not passing over it. */
  onSubmenuExit?: () => void;
  onSubmenuLeave?: () => void;
}) {
  // Row chrome lives in the module; only the state picks stay here.
  const defaultClass =
    variant === "styled"
      ? cn(styles.row, (item.active || (item.submenu && openSubmenu === item.key)) && styles.rowActive)
      : "";
  if (renderItem) {
    return (
      <>{renderItem(item, { className: defaultClass, inSubmenu })}</>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      data-tour={item.tourId}
      data-menu-key={item.key}
      disabled={item.disabled}
      aria-haspopup={item.submenu ? "menu" : undefined}
      aria-expanded={item.submenu ? openSubmenu === item.key : undefined}
      onClick={(event) => onItem(item, event.currentTarget)}
      onPointerEnter={(event) => {
        if (item.submenu) onSubmenuHover?.(item, event.currentTarget);
        else onSubmenuLeave?.();
      }}
      onPointerLeave={() => {
        if (item.submenu) onSubmenuExit?.();
      }}
      className={defaultClass}
    >
      {item.icon && (
        <span
          className={cn(
            styles.rowIcon,
            item.active ? styles.rowIconActive : roomy ? styles.rowIconRoomy : undefined,
          )}
        >
          {item.icon}
        </span>
      )}
      {item.subtitle || item.note ? (
        <span className={styles.rowMain}>
          <span className={styles.rowTitle}>{item.label}</span>
          {item.subtitle && <span className={styles.rowSubtitle}>{item.subtitle}</span>}
          {item.note && <span className={styles.rowNote}>{item.note}</span>}
        </span>
      ) : (
        <span className={styles.rowLabel}>{item.label}</span>
      )}
      {item.value && <span className={styles.rowValue}>{item.value}</span>}
      {item.trailing}
      {item.attention && (
        <span className={cn(styles.dot, item.attentionTone === "accent" ? styles.dotAccent : styles.dotDanger)} />
      )}
      {item.submenu && <ChevronRight size={16} aria-hidden className={styles.chev} />}
    </button>
  );
}

function MenuRows({
  items,
  roomy,
  variant,
  renderItem,
  inSubmenu,
  openSubmenu,
  onItem,
  onSubmenuHover,
  onSubmenuExit,
  onSubmenuLeave,
}: {
  items: PopoverMenuItem[];
  roomy: boolean;
  variant: PopoverVariant;
  renderItem?: PopoverMenuProps["renderItem"];
  inSubmenu: boolean;
  openSubmenu?: string | null;
  onItem: (item: PopoverMenuItem, element: HTMLElement) => void;
  onSubmenuHover?: (item: PopoverMenuItem, element: HTMLElement) => void;
  onSubmenuExit?: () => void;
  onSubmenuLeave?: () => void;
}) {
  // Row stagger slots, mirroring the reference: the open shares its second
  // half across rows, the close shares what remains after the shrink's lead.
  // The reveal order is direction-independent — the content rides the moving
  // clip edge, so the first row is the one the open shows first and the last
  // row the one the close retracts first, whichever way the menu opened.
  const count = Math.max(items.length, 1);
  const openStep = (MENU_OPEN_MS - MENU_ROW_IN_MS) / count;
  const closeStep = (MENU_CLOSE_MS - MENU_ROW_OUT_LEAD_MS - MENU_ROW_OUT_MS) / count;
  return (
    <>
      {items.map((item, index) => (
        <div
          key={item.key}
          // Slots inherit into the row (custom renderItem rows included); the
          // motion module turns them into delays. Values stay in JS so CSS
          // never hardcodes timing.
          style={
            {
              "--row-open-d": index * openStep,
              "--row-close-d": MENU_ROW_OUT_LEAD_MS + (count - 1 - index) * closeStep,
            } as CSSProperties
          }
        >
          {item.separatorBefore && (
            <div role="separator" className={cn(styles.separator, roomy && styles.separatorRoomy)} />
          )}
          {item.heading && <div className={styles.heading}>{item.heading}</div>}
          <DefaultRow
            item={item}
            roomy={roomy}
            openSubmenu={openSubmenu}
            variant={variant}
            renderItem={renderItem}
            inSubmenu={inSubmenu}
            onItem={onItem}
            onSubmenuHover={onSubmenuHover}
            onSubmenuExit={onSubmenuExit}
            onSubmenuLeave={onSubmenuLeave}
          />
        </div>
      ))}
    </>
  );
}

export function PopoverMenu({
  items,
  ariaLabel,
  anchor,
  placement = "auto",
  align = "start",
  offset,
  width = POPOVER_WIDTH,
  dismiss,
  variant = "styled",
  className,
  submenuClassName,
  trigger,
  triggerClassName,
  triggerTitle,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  onClose,
  onSelect,
  renderItem,
  portal = true,
  zIndex = 60,
  quick = false,
}: PopoverMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const [submenu, setSubmenu] = useState<string | null>(null);
  const [subPosition, setSubPosition] = useState<{ left: number; top: number } | null>(null);
  // Same measure-first gating as the main sheet: reading the height while
  // the grow runs returns the mid-animation height.
  const [subMeasured, setSubMeasured] = useState(false);
  // Overflow gate for the submenu grow, mirroring the main sheet's.
  const [subAnimating, setSubAnimating] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const subInnerRef = useRef<HTMLDivElement>(null);
  const subRowRef = useRef<HTMLElement | null>(null);
  // Keyboard/click submenu opens that arrive mid-grow park here until the
  // grow's animationend, instead of focusing (and scroll-jumping) mid-motion.
  const subFocusQueued = useRef(false);
  const extraInsideRefs = useMemo(() => [subRef], []);
  // Two pending actions must not share one slot: the hover-open intent is
  // armed while the pointer rests on a parent row, the close grace while it
  // is away from an open sheet. Keeping them apart lets a row's own leave
  // abandon the intent without disturbing a close already in flight.
  const subTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelSubTimers = useCallback(() => {
    if (subTimer.current) clearTimeout(subTimer.current);
    if (subOpenTimer.current) clearTimeout(subOpenTimer.current);
    subTimer.current = null;
    subOpenTimer.current = null;
  }, []);

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      if (!next) {
        cancelSubTimers();
        setSubmenu(null);
        onClose?.();
      }
      onOpenChange?.(next);
    },
    [controlledOpen, cancelSubTimers, onClose, onOpenChange],
  );

  useEffect(
    () => () => cancelSubTimers(),
    [cancelSubTimers],
  );

  // Keep the submenu sheet inside the window, re-measuring when the window
  // moves under it. The sheet's own height feeds the menu motion in the same
  // pass; submenus always reveal downward like the reference.
  useLayoutEffect(() => {
    if (!open || !submenu) return;
    const place = () => {
      const menu = menuRef.current;
      const row = subRowRef.current;
      const sub = subRef.current;
      if (!menu || !row || !sub) return;
      // Same rule as the main sheet: pre-animation the outer box reads at its
      // natural height (border included, like `height` animates it), so the
      // grow lands without a last-frame snap; mid-animation, read the inner
      // surface, which the height animation never resizes.
      const subHeight = !subMeasured
        ? sub.offsetHeight || 0
        : subInnerRef.current?.offsetHeight || sub.offsetHeight || 0;
      if (!subMeasured) {
        setMenuHeightVars(sub, subHeight, false);
        setSubMeasured(true);
        if (!quick && !isReducedMotion()) setSubAnimating(true);
      }
      if (!portal) return;
      const menuBox = menu.getBoundingClientRect();
      const placed = submenuPosition(
        menuBox,
        row.getBoundingClientRect(),
        { width: sub.offsetWidth || SUBMENU_MIN_WIDTH, height: subHeight },
        { width: window.innerWidth, height: window.innerHeight },
        isRtlElement(menu),
      );
      setSubPosition((prev) =>
        prev && prev.left === placed.left && prev.top === placed.top ? prev : { ...placed },
      );
    };
    place();
    if (!portal) return;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, submenu, portal, items.length, subMeasured]);

  const openSub = useCallback((item: PopoverMenuItem, row: HTMLElement, focus = false) => {
    cancelSubTimers();
    subRowRef.current = row;
    setSubPosition(null);
    setSubmenu(item.key);
    if (!focus) return;
    // With no motion, focus at once on the next frame as before; otherwise
    // park it until the grow finishes so the clip never scroll-jumps.
    if (quick || isReducedMotion()) {
      requestAnimationFrame(() => menuEnabledRows(subInnerRef.current)[0]?.focus());
    } else {
      subFocusQueued.current = true;
    }
  }, [quick, cancelSubTimers]);

  const closeSub = useCallback((focusRow = false) => {
    cancelSubTimers();
    setSubmenu(null);
    if (focusRow) subRowRef.current?.focus();
  }, [cancelSubTimers]);

  const isPointAnchor = anchor?.kind === "point";

  const selectItem = useCallback(
    (item: PopoverMenuItem, row: HTMLElement, close: (refocus?: boolean) => void) => {
      if (item.submenu) {
        if (submenu === item.key) closeSub();
        else openSub(item, row, true);
        return;
      }
      item.onSelect?.();
      onSelect?.(item.key);
      if (!item.keepOpen) {
        close(!isPointAnchor);
      }
    },
    [submenu, closeSub, openSub, onSelect, isPointAnchor],
  );

  const onMenuKey = useCallback(
    (
      event: ReactKeyboardEvent<HTMLDivElement>,
      inSubmenu: boolean,
      scope: PopoverMenuItem[],
      close: (refocus?: boolean) => void,
    ) => {
      const menu = event.currentTarget;
      const list = [...menu.querySelectorAll<HTMLElement>(SUBMENU_QUERY)];
      const current = list.indexOf(document.activeElement as HTMLElement);
      const next = nextMenuIndex(event.key, current, list.length);
      if (next != null) {
        event.preventDefault();
        list[next]?.focus();
        return;
      }
      const rtl = isRtlElement(menu);
      const forward = rtl ? "ArrowLeft" : "ArrowRight";
      const back = rtl ? "ArrowRight" : "ArrowLeft";
      const focused = list[current];
      const item = focused ? scope.find((entry) => entry.key === focused.dataset.menuKey) : undefined;
      if (!inSubmenu && event.key === forward && item?.submenu && focused) {
        event.preventDefault();
        openSub(item, focused, true);
      } else if (inSubmenu && (event.key === back || event.key === "Escape")) {
        event.preventDefault();
        event.stopPropagation();
        closeSub(true);
      } else if (event.key === "Tab") {
        event.preventDefault();
        close(!isPointAnchor);
      }
    },
    [openSub, closeSub, isPointAnchor],
  );

  const openItem = submenu ? items.find((item) => item.key === submenu) : undefined;
  // The submenu stays mounted through its own shrink so closing it mirrors
  // opening: whole-container expand in, whole-container shrink out.
  const subMotion = useHeldMenuMotion(openItem ?? null, "menu", quick);
  const heldSubItem = subMotion.value;
  useEffect(() => {
    if (!subMotion.shown) {
      setSubMeasured(false);
      setSubAnimating(false);
      subFocusQueued.current = false;
    }
  }, [subMotion.shown]);
  const roomy = placement !== "below";
  // The look lives on the animated outer shell (see Popover): the inner
  // layer is just padding plus the overflow gate the grow reveals.
  const subShellClass = variant === "styled" ? styles.subShell : styles.subShellBare;
  const submenuInnerClass = variant === "styled" ? styles.subInner : "";
  const subMotionClass = quick || !subMeasured ? "" : subMotion.closing ? motionStyles.menuOut : motionStyles.menuIn;
  const subGateOverflow = subMotion.closing || subAnimating;
  const subAnimatingClass = subGateOverflow ? motionStyles.menuAnimating : "";

  // Submenu mirror of the shell handlers in Popover: row animations bubble
  // past via the target check. A starting animation raises the gate,
  // covering submenu reopens that never re-run the measuring pass.
  const onSubAnimationEnd = (event: ReactAnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (subMotion.closing) {
      subMotion.finishClosing();
      return;
    }
    setSubAnimating(false);
    if (!subFocusQueued.current) return;
    subFocusQueued.current = false;
    menuEnabledRows(subInnerRef.current)[0]?.focus({ preventScroll: true });
  };
  const onSubAnimationStart = (event: ReactAnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    setSubAnimating(true);
  };
  // No `open` guard here: a submenu the user left open keeps its own held
  // close when the whole menu goes down, so it shrinks alongside the main
  // sheet instead of vanishing with it.
  const renderSubSheet = (close: (refocus?: boolean) => void) =>
    subMotion.shown &&
    heldSubItem?.submenu && (
      <div
        ref={subRef}
        role="menu"
        aria-label={typeof heldSubItem.label === "string" ? heldSubItem.label : heldSubItem.key}
        data-popover-submenu
        data-popover-variant={variant}
        {...subMotion.exitProps}
        onPointerEnter={() => cancelSubTimers()}
        onAnimationEnd={onSubAnimationEnd}
        onAnimationStart={onSubAnimationStart}
        style={
          portal
            ? {
                position: "fixed",
                left: subPosition?.left ?? 0,
                top: subPosition?.top ?? 0,
                minWidth: SUBMENU_MIN_WIDTH,
                width: "max-content",
                maxWidth: `min(${POPOVER_WIDTH + 40}px, calc(100vw - ${EDGE_MARGIN * 2}px))`,
                visibility: subPosition ? undefined : "hidden",
                zIndex: zIndex + 1,
              }
            : undefined
        }
        className={cn(subShellClass, !portal && styles.subInline, subMotionClass, submenuClassName)}
      >
        <div
          ref={subInnerRef}
          onKeyDown={(event) => onMenuKey(event, true, heldSubItem.submenu ?? [], close)}
          // Same scroll caps as the main sheet: a submenu taller than the
          // window scrolls inside its own box instead of running off-screen
          // with no way to reach the cut-off rows.
          style={{
            maxHeight: `calc(100dvh - ${EDGE_MARGIN * 2}px)`,
            overflowY: subGateOverflow ? ("hidden" as const) : ("auto" as const),
            overscrollBehavior: "contain" as const,
          }}
          className={cn(submenuInnerClass, subAnimatingClass, motionStyles.rowFlow)}
        >
          <MenuRows
            items={heldSubItem.submenu}
            roomy={roomy}
            variant={variant}
            renderItem={renderItem}
            inSubmenu
            onItem={(item) => {
              item.onSelect?.();
              onSelect?.(item.key);
              if (!item.keepOpen) {
                close(!isPointAnchor);
              }
            }}
          />
        </div>
      </div>
    );

  return (
    <Popover
      ariaLabel={ariaLabel}
      open={open}
      onOpenChange={setOpen}
      anchor={anchor}
      placement={placement}
      align={align}
      offset={offset}
      width={width}
      dismiss={dismiss}
      trigger={trigger}
      triggerClassName={triggerClassName}
      triggerTitle={triggerTitle}
      variant={variant}
      contentRole="menu"
      motionKind="menu"
      quick={quick}
      portal={portal}
      zIndex={zIndex}
      contentRef={menuRef}
      extraInsideRefs={extraInsideRefs}
      repositionKey={`${items.length}:${submenu ?? ""}`}
    >
      {(api) => {
        const sub = renderSubSheet(api.close);
        return (
          <div
            role="group"
            data-popover-menu
            data-popover-variant={variant}
            onKeyDown={(event) => onMenuKey(event, false, items, api.close)}
            onPointerLeave={() => {
              // Cancel whatever the pointer left pending first: a hover-open
              // for a row the pointer only brushed past must die with the
              // leave, or it fires behind the pointer with the menu gone.
              cancelSubTimers();
              if (!openItem) return;
              subTimer.current = setTimeout(
                () => setSubmenu((key) => (subRef.current?.matches(":hover") ? key : null)),
                CLOSE_DELAY_MS,
              );
            }}
            // Plain wrapper: the Popover shell above already carries the
            // styled surface (background, border, shadow, padding), so adding
            // another here would double borders and trap the shadow inside
            // the outer overflow gate. rowFlow hooks the per-row stagger.
            className={cn(motionStyles.rowFlow, className)}
          >
            <MenuRows
              items={items}
              roomy={roomy}
              variant={variant}
              renderItem={renderItem}
              inSubmenu={false}
              openSubmenu={openItem?.key}
              onItem={(item, row) => selectItem(item, row, api.close)}
              onSubmenuHover={(item, row) => {
                cancelSubTimers();
                // Hover intent only: keyboard and click opens stay immediate.
                subOpenTimer.current = setTimeout(() => {
                  subOpenTimer.current = null;
                  openSub(item, row);
                }, SUBMENU_OPEN_DELAY_MS);
              }}
              onSubmenuExit={() => {
                // The pointer left the parent row (onto a sibling, a gap, or
                // out of the menu): abandon the pending open unless it fired
                // while the pointer rested. Cancelling only the intent keeps
                // a close grace already in flight untouched.
                if (subOpenTimer.current) {
                  clearTimeout(subOpenTimer.current);
                  subOpenTimer.current = null;
                }
              }}
              onSubmenuLeave={() => {
                // Landing on a row without a submenu also cancels the pending
                // hover-open of the row just left, then closes any open one.
                cancelSubTimers();
                if (!openItem) return;
                subTimer.current = setTimeout(() => setSubmenu(null), OPEN_DELAY_MS);
              }}
            />
            {!portal && sub}
            {portal && typeof document !== "undefined" && sub ? createPortal(sub, document.body) : null}
          </div>
        );
      }}
    </Popover>
  );
}
