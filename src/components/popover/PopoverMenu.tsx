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
import { Popover } from "./Popover";
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
  const defaultClass =
    variant === "styled"
      ? cn(
          "flex items-center gap-2 disabled:opacity-60 outline-none",
          "w-full min-h-8 rounded-md px-3 py-2 text-sm leading-5 text-start",
          "hover:bg-raised-hover focus-within:bg-raised-hover",
          (item.active || (item.submenu && openSubmenu === item.key)) && "bg-raised-hover",
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
            "flex size-5 shrink-0 items-center justify-center",
            item.active ? "text-accent" : roomy ? "text-ink" : "text-ink-secondary",
          )}
        >
          {item.icon}
        </span>
      )}
      {item.subtitle || item.note ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{item.label}</span>
          {item.subtitle && (
            <span className="truncate text-[12px] font-normal leading-4 text-ink-secondary">{item.subtitle}</span>
          )}
          {item.note && (
            <span className="text-[11.5px] font-normal leading-snug text-ink-tertiary">{item.note}</span>
          )}
        </span>
      ) : (
        <span className="flex-1 truncate">{item.label}</span>
      )}
      {item.value && (
        <span className="shrink-0 text-[14px] font-normal leading-5 tabular-nums text-ink-secondary">{item.value}</span>
      )}
      {item.trailing}
      {item.attention && (
        <span className={cn("size-2 shrink-0 rounded-full", item.attentionTone === "accent" ? "bg-accent" : "bg-danger")} />
      )}
      {item.submenu && <ChevronRight size={16} aria-hidden className="shrink-0 text-ink-secondary rtl:-scale-x-100" />}
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
            <div role="separator" className={cn("h-px bg-hairline/50", roomy ? "mx-3 my-1.5" : "my-1.5")} />
          )}
          {item.heading && (
            <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
              {item.heading}
            </div>
          )}
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
  const menuRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
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
  // moves under it.
  useLayoutEffect(() => {
    if (!open || !submenu || !portal) return;
    const place = () => {
      const menu = menuRef.current;
      const row = subRowRef.current;
      const sub = subRef.current;
      if (!menu || !row || !sub) return;
      setSubPosition(
        submenuPosition(
          menu.getBoundingClientRect(),
          row.getBoundingClientRect(),
          { width: sub.offsetWidth || SUBMENU_MIN_WIDTH, height: sub.offsetHeight || 0 },
          { width: window.innerWidth, height: window.innerHeight },
          isRtlElement(menu),
        ),
      );
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, submenu, portal, items.length]);

  const openSub = useCallback((item: PopoverMenuItem, row: HTMLElement, focus = false) => {
    if (subTimer.current) clearTimeout(subTimer.current);
    subRowRef.current = row;
    setSubPosition(null);
    setSubmenu(item.key);
    if (focus) requestAnimationFrame(() => menuEnabledRows(subRef.current)[0]?.focus());
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
      if (!item.keepOpen) close(!isPointAnchor);
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
  const roomy = placement !== "below";
  const submenuSurface =
    variant === "styled" ? "overflow-hidden border border-hairline/50 bg-menu shadow-xl rounded-md p-1" : "";

  const renderSubSheet = (close: (refocus?: boolean) => void) =>
    open &&
    openItem?.submenu && (
      <div
        ref={subRef}
        role="menu"
        aria-label={typeof openItem.label === "string" ? openItem.label : openItem.key}
        data-popover-submenu
        data-popover-variant={variant}
        onKeyDown={(event) => onMenuKey(event, true, openItem.submenu ?? [], close)}
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
        className={cn(submenuSurface, !portal && "absolute start-full top-0 z-50 ms-1", "animate-pop-in", submenuClassName)}
      >
        <MenuRows
          items={openItem.submenu}
          roomy={roomy}
          variant={variant}
          renderItem={renderItem}
          inSubmenu
          onItem={(item) => {
            item.onSelect?.();
            onSelect?.(item.key);
            if (!item.keepOpen) close(!isPointAnchor);
          }}
        />
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
      variant="headless"
      contentRole="menu"
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
            className={cn(
              variant === "styled" ? "overflow-hidden border border-hairline/50 bg-menu shadow-xl rounded-md p-1" : "",
              className,
            )}
          >
            <MenuRows
              items={items}
              roomy={roomy}
              variant={variant}
              renderItem={renderItem}
              inSubmenu={false}
              openSubmenu={submenu}
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
