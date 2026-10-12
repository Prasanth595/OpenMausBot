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
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import motionStyles from "./popover-motion.module.css";
import styles from "./popover-menu.module.css";
import { useHeldMenuMotion } from "../MenuMotion";
import { Popover, setMenuHeightVars } from "./Popover";
import {
  CLOSE_DELAY_MS,
  EDGE_MARGIN,
  OPEN_DELAY_MS,
  POPOVER_WIDTH,
  SUBMENU_MIN_WIDTH,
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
  onSubmenuLeave?: () => void;
}) {
  return (
    <>
      {items.map((item) => (
        <div key={item.key}>
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
}: PopoverMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const [submenu, setSubmenu] = useState<string | null>(null);
  const [subPosition, setSubPosition] = useState<{ left: number; top: number } | null>(null);
  // Same measure-first gating as the main sheet: reading the height while
  // the grow runs returns the mid-animation height.
  const [subMeasured, setSubMeasured] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const subInnerRef = useRef<HTMLDivElement>(null);
  const subRowRef = useRef<HTMLElement | null>(null);
  const subTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extraInsideRefs = useMemo(() => [subRef], []);

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      if (!next) {
        if (subTimer.current) clearTimeout(subTimer.current);
        setSubmenu(null);
        onClose?.();
      }
      onOpenChange?.(next);
    },
    [controlledOpen, onClose, onOpenChange],
  );

  useEffect(
    () => () => {
      if (subTimer.current) clearTimeout(subTimer.current);
    },
    [],
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
      // Same rule as the main sheet: the outer box is the running animation,
      // so the natural height comes from the inner surface.
      const subHeight = subInnerRef.current?.offsetHeight || sub.offsetHeight || 0;
      if (!subMeasured) {
        setMenuHeightVars(sub, subHeight, false);
        setSubMeasured(true);
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
    if (subTimer.current) clearTimeout(subTimer.current);
    subRowRef.current = row;
    setSubPosition(null);
    setSubmenu(item.key);
    if (focus) requestAnimationFrame(() => menuEnabledRows(subInnerRef.current)[0]?.focus());
  }, []);

  const closeSub = useCallback((focusRow = false) => {
    if (subTimer.current) clearTimeout(subTimer.current);
    setSubmenu(null);
    if (focusRow) subRowRef.current?.focus();
  }, []);

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
  const subMotion = useHeldMenuMotion(openItem ?? null, "menu");
  const heldSubItem = subMotion.value;
  useEffect(() => {
    if (!subMotion.shown) setSubMeasured(false);
  }, [subMotion.shown]);
  const roomy = placement !== "below";
  // The look lives on the animated outer shell (see Popover): the inner
  // layer is just padding plus the overflow gate the grow reveals.
  const subShellClass = variant === "styled" ? styles.subShell : styles.subShellBare;
  const submenuInnerClass = variant === "styled" ? styles.subInner : "";
  const subMotionClass = !subMeasured ? "" : subMotion.closing ? motionStyles.menuOut : motionStyles.menuIn;
  const subClipClass = subMeasured ? (subMotion.closing ? motionStyles.menuClipOut : motionStyles.menuClipIn) : "";

  const renderSubSheet = (close: (refocus?: boolean) => void) =>
    open &&
    subMotion.shown &&
    heldSubItem?.submenu && (
      <div
        ref={subRef}
        role="menu"
        aria-label={typeof heldSubItem.label === "string" ? heldSubItem.label : heldSubItem.key}
        data-popover-submenu
        data-popover-variant={variant}
        {...subMotion.exitProps}
        onPointerEnter={() => subTimer.current && clearTimeout(subTimer.current)}
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
            overflowY: "auto",
            overscrollBehavior: "contain",
          }}
          className={cn(submenuInnerClass, subClipClass)}
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
              if (!openItem) return;
              if (subTimer.current) clearTimeout(subTimer.current);
              subTimer.current = setTimeout(
                () => setSubmenu((key) => (subRef.current?.matches(":hover") ? key : null)),
                CLOSE_DELAY_MS,
              );
            }}
            // Plain wrapper: the Popover shell above already carries the
            // styled surface (background, border, shadow, padding), so adding
            // another here would double borders and trap the shadow inside
            // the outer overflow gate.
            className={cn(className)}
          >
            <MenuRows
              items={items}
              roomy={roomy}
              variant={variant}
              renderItem={renderItem}
              inSubmenu={false}
              openSubmenu={heldSubItem?.key}
              onItem={(item, row) => selectItem(item, row, api.close)}
              onSubmenuHover={(item, row) => {
                if (subTimer.current) clearTimeout(subTimer.current);
                subTimer.current = setTimeout(() => openSub(item, row), OPEN_DELAY_MS);
              }}
              onSubmenuLeave={() => {
                if (!openItem) return;
                if (subTimer.current) clearTimeout(subTimer.current);
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
