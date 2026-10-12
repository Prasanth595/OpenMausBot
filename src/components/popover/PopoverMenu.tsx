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
  type RefObject,
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
  SUBMENU_CONFIRM_MS,
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
  /** Marks an in-progress row (with `disabled`): the work is under way. */
  busy?: boolean;
  /** Draw the row in the danger tone (destructive actions). */
  danger?: boolean;
  /** Native tooltip: why a disabled row can't be picked, say. */
  title?: string;
  /** Row semantics: a plain action or one of a radio set. Default "menuitem". */
  role?: "menuitem" | "menuitemradio";
  /** Radio rows: whether this choice is the current one. */
  checked?: boolean;
  /** Unavailable, but still reachable: presses do nothing, yet the arrows
   * can land here and read its reason out. `disabled` instead takes the row
   * out of the arrow path (for rows with nothing to say). */
  ariaDisabled?: boolean;
  separatorBefore?: boolean;
  heading?: string;
  trailing?: ReactNode;
  value?: string;
  keepOpen?: boolean;
  /** Opens beside the menu instead of acting; onSelect is not called. */
  submenu?: PopoverMenuItem[];
  /** A raw block in place of the row chrome (an inline alert or status).
   * Not focusable and not part of the arrow order. */
  render?: ReactNode;
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
  /** Focus the first enabled row on every open, not only keyboard opens
   * (point/context menus). Default false. */
  focusFirstOnOpen?: boolean;
  /** Closing hands focus back to the opener the sheet captured. Default false. */
  restoreFocusOnClose?: boolean;
  /** The default trigger button is inert: disabled, no open. Default false. */
  triggerDisabled?: boolean;
  /** Extra nodes (the menu's own opener button, say) that count as "inside"
   * for dismissal, so pressing them toggles instead of reopening. */
  extraInsideRefs?: Array<RefObject<HTMLElement | null>>;
}

// Rows the arrow keys walk: under a MenuRows wrapper, plain items and radio
// choices alike — natively disabled rows are skipped, aria-disabled ones stay
// so the arrows can reach them and read their reason out.
const MENU_ROWS =
  ':scope > div > [role="menuitem"]:not(:disabled), :scope > div > [role="menuitemradio"]:not(:disabled)';
const menuEnabledRows = (menu: HTMLElement | null) => (menu ? [...menu.querySelectorAll<HTMLElement>(MENU_ROWS)] : []);

const SUBMENU_QUERY = MENU_ROWS;

const NO_OUTSIDE_REFS: Array<RefObject<HTMLElement | null>> = [];

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
      ? cn(
          styles.row,
          (item.active || (item.submenu && openSubmenu === item.key)) && styles.rowActive,
          item.danger && styles.rowDanger,
          item.ariaDisabled && styles.rowOff,
        )
      : "";
  if (renderItem) {
    return (
      <>{renderItem(item, { className: defaultClass, inSubmenu })}</>
    );
  }
  return (
    <button
      type="button"
      role={item.role ?? "menuitem"}
      aria-checked={item.role === "menuitemradio" ? item.checked === true : undefined}
      aria-disabled={item.ariaDisabled || undefined}
      data-tour={item.tourId}
      data-menu-key={item.key}
      disabled={item.disabled}
      aria-busy={item.busy || undefined}
      title={item.title}
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
            item.danger && styles.rowIconDanger,
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
          {item.render ?? (
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
          )}
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
  focusFirstOnOpen = false,
  restoreFocusOnClose = false,
  triggerDisabled = false,
  extraInsideRefs: outsideRefs = NO_OUTSIDE_REFS,
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
  const extraInsideRefs = useMemo(() => [subRef, ...outsideRefs], [outsideRefs]);
  // Two pending actions must not share one slot: the hover-open intent is
  // armed while the pointer rests on a parent row, the close grace while it
  // is away from an open sheet. Keeping them apart lets a row's own leave
  // abandon the intent without disturbing a close already in flight.
  const subTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the hover intent opened a submenu: a parent-row click this soon
  // after it is the open gesture itself (still mid-press), not a toggle.
  const subConfirmAt = useRef<number | null>(null);
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
    subConfirmAt.current = null;
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
    subConfirmAt.current = null;
    setSubmenu(null);
    if (focusRow) subRowRef.current?.focus();
  }, [cancelSubTimers]);

  const isPointAnchor = anchor?.kind === "point";

  const selectItem = useCallback(
    (item: PopoverMenuItem, row: HTMLElement, close: (refocus?: boolean) => void) => {
      // An unavailable-but-reachable row says its reason; it does not act.
      if (item.ariaDisabled) return;
      if (item.submenu) {
        if (submenu === item.key) {
          // A click right after the hover intent opened this row is that same
          // open gesture (possibly still mid-press), not a deliberate toggle:
          // keep the fresh submenu. The window expires, so a later click closes.
          const fresh =
            subConfirmAt.current !== null &&
            performance.now() - subConfirmAt.current < SUBMENU_CONFIRM_MS;
          subConfirmAt.current = null;
          if (!fresh) closeSub();
        } else {
          openSub(item, row, true);
        }
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
      focusFirstOnOpen={focusFirstOnOpen}
      restoreFocusOnClose={restoreFocusOnClose}
      triggerDisabled={triggerDisabled}
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
            onKeyDown={(event) => {
              // The submenu handles its own keys. Its events still bubble here
              // along the fiber tree (the sheet is portaled), and this list
              // would read the submenu row as a miss and re-claim focus for
              // its first/last item — the arrow-key jump back this guards.
              if (event.target instanceof Node && subRef.current?.contains(event.target)) return;
              onMenuKey(event, false, items, api.close);
            }}
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
                  subConfirmAt.current = performance.now();
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
