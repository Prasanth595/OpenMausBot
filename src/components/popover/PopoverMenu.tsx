// Generic menu composed on the Popover shell. Items arrive purely through
// props — no store, no i18n, no network here. Submenus nest to any depth; the
// levels in ./menu-level own their rows, hover and motion state.
import { useCallback, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Popover } from "./Popover";
import { MenuLevel, type MenuChrome } from "./menu-level";
import { POPOVER_WIDTH } from "./positioning";
import type { PopoverAlign, PopoverAnchor, PopoverDismissOptions, PopoverPlacement, PopoverVariant } from "./popover-types";

export interface PopoverMenuHeader {
  /** The band's primary line. */
  title: ReactNode;
  /** A second line under the title: plain text, a link or button, icons —
   * anything. Its own classes stay in charge of how it looks. */
  content?: ReactNode;
  /** The hairline under the band, drawn between it and the rows below.
   * Default true. */
  divider?: boolean;
}

export interface PopoverMenuItem {
  key: string;
  /** The row's primary line. */
  title?: ReactNode;
  /** A second line under the title, sharing its column. */
  content?: ReactNode;
  /** The top band's start slot: usually an icon, drawn in a 20px box with a
   * 16px size default for the icons inside it. */
  leading?: ReactNode;
  /** The top band's end slot: usually an icon, chip or shortcut. */
  trailing?: ReactNode;
  /** Right-aligned small text before the trailing slot. */
  value?: string;
  /** Line counts for the text slots: omitted = 1 line, a positive N clamps
   * to N lines, -1 wraps freely, 0 does not render the slot at all. */
  lines?: { title?: number; content?: number };
  /** Per-slot class names. A slot that is given one drops its default paint
   * (colours, fills, and the leading size default) so the caller's classes
   * take effect — the module's own rules are unlayered and would win the
   * tie. Geometry (box, spacing, alignment, type, clamp) stays. A replaced
   * row keeps what it still needs itself: a danger row carries its own fill,
   * e.g. `hover:bg-danger/10 disabled:hover:bg-transparent`, since a
   * disabled row must never light up. */
  overrideClassNames?: {
    row?: string;
    leading?: string;
    title?: string;
    content?: string;
    trailing?: string;
  };
  active?: boolean;
  attention?: boolean;
  attentionTone?: "danger" | "accent";
  disabled?: boolean;
  /** Marks an in-progress row (with `disabled`): the work is under way. */
  busy?: boolean;
  /** Native tooltip: why a disabled row can't be picked, say. */
  hint?: string;
  /** Row semantics: a plain action or one of a radio set. Default "menuitem". */
  role?: "menuitem" | "menuitemradio";
  /** Radio rows: whether this choice is the current one. */
  checked?: boolean;
  /** Unavailable, but still reachable: presses do nothing, yet the arrows
   * can land here and read its reason out. `disabled` instead takes the row
   * out of the arrow path (for rows with nothing to say). */
  ariaDisabled?: boolean;
  separatorBefore?: boolean;
  /** A small uppercase label over the row. For a group marker that names a
   * section (and may carry content of its own), use a `header` item. */
  heading?: string;
  /** A header band for the rows under it. On an item this replaces the row:
   * the item is the group marker, and the row fields (title, leading,
   * onSelect, …) are ignored. Bands are neither focusable nor part of the
   * arrow path; anything focusable the content brings takes part in the
   * sheet's Tab order instead. */
  header?: PopoverMenuHeader;
  keepOpen?: boolean;
  /** Opens beside the menu instead of acting; onSelect is not called. The
   * rows can nest their own submenus the same way. */
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
  /** The sheet's own accessible name when it differs from the trigger's.
   * Defaults to ariaLabel. */
  sheetAriaLabel?: string;
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
  /** The trigger button itself, for callers that must focus it later (a
   * dialog opened from a row returns focus here, say). */
  triggerRef?: RefObject<HTMLButtonElement | null>;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  onSelect?: (key: string) => void;
  /** Replaces the default row button. Heading/separator chrome stays default.
   * Custom rows must render `[role="menuitem"][data-menu-key]` for keyboard
   * navigation to find them. */
  renderItem?: (item: PopoverMenuItem, defaults: PopoverMenuRenderDefaults) => ReactNode;
  /** Replaces the default header band (separator chrome stays default).
   * Custom bands must render `[data-popover-header]` so a focusable inside
   * them joins the sheet's Tab order. */
  renderHeader?: (header: PopoverMenuHeader, defaults: PopoverMenuRenderDefaults) => ReactNode;
  portal?: boolean;
  zIndex?: number;
  /** Skip motion entirely (main sheet and submenus): no enter/exit and no
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

const NO_OUTSIDE_REFS: Array<RefObject<HTMLElement | null>> = [];

/** Generic menu composed on the Popover shell. Items arrive purely through
 * props — no store, no i18n, no network here. Submenus nest to any depth,
 * with roving focus and headless/styled surfaces. */
export function PopoverMenu({
  items,
  ariaLabel,
  sheetAriaLabel,
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
  triggerRef,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  onClose,
  onSelect,
  renderItem,
  renderHeader,
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
  const [sheetsEpoch, setSheetsEpoch] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const sheetElements = useRef(new Map<number, HTMLElement>());
  const apiRef = useRef<{ close: (refocus?: boolean) => void } | null>(null);
  const isPointAnchor = anchor?.kind === "point";

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      if (!next) onClose?.();
      onOpenChange?.(next);
    },
    [controlledOpen, onClose, onOpenChange],
  );

  const closeMenu = useCallback((refocus?: boolean) => apiRef.current?.close(refocus), []);
  const selectLeaf = useCallback(
    (item: PopoverMenuItem) => {
      item.onSelect?.();
      onSelect?.(item.key);
      if (!item.keepOpen) closeMenu(!isPointAnchor);
    },
    [onSelect, closeMenu, isPointAnchor],
  );
  const registerInside = useCallback((id: number, element: HTMLElement | null) => {
    if (element) sheetElements.current.set(id, element);
    else sheetElements.current.delete(id);
  }, []);
  const sheetsChanged = useCallback(() => setSheetsEpoch((epoch) => epoch + 1), []);
  // A stand-in node whose `contains` answers for every submenu sheet of the
  // menu: a press inside a nested sheet must not count as an outside press.
  const insideRef = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      current: {
        contains: (target: unknown) =>
          [...sheetElements.current.values()].some((element) => element.contains(target as Node)),
      } as unknown as HTMLElement,
    }),
    [],
  );
  const extraInsideRefs = useMemo(() => [insideRef, ...outsideRefs], [insideRef, outsideRefs]);
  const chrome = useMemo<MenuChrome>(
    () => ({
      roomy: placement !== "below",
      variant,
      renderItem,
      renderHeader,
      quick,
      portal,
      submenuClassName,
      tabCloses: dismiss?.tabCloses !== false,
      zIndex,
      isPointAnchor,
      closeMenu,
      onLeaf: selectLeaf,
      registerInside,
      onSheetsChange: sheetsChanged,
    }),
    [
      placement,
      variant,
      renderItem,
      renderHeader,
      quick,
      portal,
      submenuClassName,
      dismiss,
      zIndex,
      isPointAnchor,
      closeMenu,
      selectLeaf,
      registerInside,
      sheetsChanged,
    ],
  );

  return (
    <Popover
      ariaLabel={ariaLabel}
      sheetAriaLabel={sheetAriaLabel}
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
      triggerRef={triggerRef}
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
      repositionKey={`${items.length}:${sheetsEpoch}`}
    >
      {(api) => {
        apiRef.current = api;
        return (
          <MenuLevel
            items={items}
            depth={0}
            chrome={chrome}
            menuOpen={open}
            parentRef={menuRef}
            containerProps={{ role: "group", "data-popover-menu": true, "data-popover-variant": variant, className }}
            closeSelf={api.close}
          />
        );
      }}
    </Popover>
  );
}
