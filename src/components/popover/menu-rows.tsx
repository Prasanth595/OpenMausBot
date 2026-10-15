// Menu rows, bands and the selectors every level walks them with: what a row
// is, how it looks, and where the keyboard can land. No level state here.
import type { CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import styles from "./popover-menu.module.css";
import {
  MENU_CLOSE_MS,
  MENU_OPEN_MS,
  MENU_ROW_IN_MS,
  MENU_ROW_OUT_LEAD_MS,
  MENU_ROW_OUT_MS,
} from "../MenuMotion";
import type { PopoverMenuHeader, PopoverMenuItem, PopoverMenuProps } from "./PopoverMenu";
import type { PopoverVariant } from "./popover-types";

// Rows the arrow keys walk: under a MenuRows wrapper, plain items and radio
// choices alike — natively disabled rows are skipped, aria-disabled ones stay
// so the arrows can reach them and read their reason out.
const MENU_ROWS =
  ':scope > div > [role="menuitem"]:not(:disabled), :scope > div > [role="menuitemradio"]:not(:disabled)';
/** Collects the rows arrow keys can land on inside a menu element. */
export const menuEnabledRows = (menu: HTMLElement | null) => (menu ? [...menu.querySelectorAll<HTMLElement>(MENU_ROWS)] : []);

// Focusable elements a header band brings (a Learn more link, say): no menu
// rows, so the arrows never land on them, but they share the sheet's Tab
// order with the rows.
const HEADER_FOCUSABLE =
  ':scope > div > [data-popover-header] :is(a[href], button, input, select, textarea, [tabindex]):not(:disabled):not([tabindex="-1"])';

/** The sheet's Tab stops: a band's focusables and the rows, in document
 * order. Null when no band brings one — there the rows are arrow territory
 * only and Tab closes the menu instead. */
export function menuTabStops(menu: HTMLElement): HTMLElement[] | null {
  if (!menu.querySelector(HEADER_FOCUSABLE)) return null;
  return [...menu.querySelectorAll<HTMLElement>(`${MENU_ROWS}, ${HEADER_FOCUSABLE}`)];
}

/** Default menu row: styled button with leading, title/content, and tail slots. */
function DefaultRow({
  item,
  roomy,
  submenuOpen,
  variant,
  renderItem,
  inSubmenu,
  onItem,
  onRowEnter,
  onRowLeave,
}: {
  item: PopoverMenuItem;
  roomy: boolean;
  submenuOpen: boolean;
  variant: PopoverVariant;
  renderItem?: PopoverMenuProps["renderItem"];
  inSubmenu: boolean;
  onItem: (item: PopoverMenuItem, element: HTMLElement) => void;
  onRowEnter: (item: PopoverMenuItem, element: HTMLElement) => void;
  onRowLeave: (item: PopoverMenuItem) => void;
}) {
  // Row chrome lives in the module; only the state picks stay here. A slot
  // carrying an override class drops its default paint, so the caller's
  // classes take effect: the module's rules are unlayered and would win any
  // tie with the utilities layer.
  const override = item.overrideClassNames;
  const defaultClass =
    variant === "styled"
      ? cn(
          styles.row,
          !override?.row && styles.rowFill,
          (item.active || (item.submenu && submenuOpen)) && styles.rowActive,
          item.ariaDisabled && styles.rowOff,
          override?.row,
        )
      : override?.row ?? "";
  if (renderItem) {
    return (
      <>{renderItem(item, { className: defaultClass, inSubmenu })}</>
    );
  }
  // -1 wraps freely; anything else clamps, with the default (one line) left
  // to the CSS fallback so the common case writes no variable.
  const clamp = (lines: number | undefined) =>
    lines === -1
      ? undefined
      : { className: styles.clamp, style: lines === undefined ? undefined : ({ "--row-lines": lines } as CSSProperties) };
  const titleClamp = clamp(item.lines?.title);
  const contentClamp = clamp(item.lines?.content);
  const showTitle = item.title != null && item.lines?.title !== 0;
  const showContent = item.content != null && item.lines?.content !== 0;
  const hasValue = Boolean(item.value);
  const hasTrailing = item.trailing != null;
  const hasTail = hasValue || hasTrailing || item.attention === true || item.submenu != null;
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
      title={item.hint}
      aria-haspopup={item.submenu ? "menu" : undefined}
      aria-expanded={item.submenu ? submenuOpen : undefined}
      onClick={(event) => onItem(item, event.currentTarget)}
      onPointerEnter={(event) => onRowEnter(item, event.currentTarget)}
      onPointerLeave={() => onRowLeave(item)}
      className={defaultClass}
    >
      {item.leading != null && (
        <span
          className={cn(
            styles.rowLeading,
            !override?.leading && styles.rowLeadingTone,
            !override?.leading && styles.rowLeadingMedia,
            !override?.leading && (item.active ? styles.rowLeadingActive : roomy ? styles.rowLeadingRoomy : undefined),
            override?.leading,
          )}
        >
          {item.leading}
        </span>
      )}
      <span className={styles.rowMain}>
        {showTitle && (
          <span className={cn(styles.rowTitle, titleClamp?.className, override?.title)} style={titleClamp?.style}>
            {item.title}
          </span>
        )}
        {showContent && (
          <span
            className={cn(styles.rowContent, !override?.content && styles.rowContentTone, override?.content, contentClamp?.className)}
            style={contentClamp?.style}
          >
            {item.content}
          </span>
        )}
      </span>
      {hasTail && (
        <span className={styles.rowTail}>
          {hasValue && <span className={styles.rowValue}>{item.value}</span>}
          {hasTrailing && <span className={cn(styles.rowTailSlot, override?.trailing)}>{item.trailing}</span>}
          {item.attention && (
            <span className={cn(styles.dot, item.attentionTone === "accent" ? styles.dotAccent : styles.dotDanger)} />
          )}
          {item.submenu && <ChevronRight size={16} aria-hidden className={styles.chev} />}
        </span>
      )}
    </button>
  );
}

/** Header band rendered above a group of rows. */
function HeaderBand({
  header,
  inSubmenu,
  renderHeader,
}: {
  header: PopoverMenuHeader;
  inSubmenu: boolean;
  renderHeader?: PopoverMenuProps["renderHeader"];
}) {
  const className = cn(styles.header, header.divider !== false && styles.headerDivider);
  if (renderHeader) return <>{renderHeader(header, { className, inSubmenu })}</>;
  return (
    <div data-popover-header className={className}>
      <div className={styles.headerTitle}>{header.title}</div>
      {header.content != null && <div className={styles.headerContent}>{header.content}</div>}
    </div>
  );
}

/** Renders menu items with per-row stagger slots for the open/close motion. */
export function MenuRows({
  items,
  roomy,
  variant,
  renderItem,
  renderHeader,
  inSubmenu,
  submenuKey,
  onItem,
  onRowEnter,
  onRowLeave,
}: {
  items: PopoverMenuItem[];
  roomy: boolean;
  variant: PopoverVariant;
  renderItem?: PopoverMenuProps["renderItem"];
  renderHeader?: PopoverMenuProps["renderHeader"];
  inSubmenu: boolean;
  /** The row whose submenu is open, if any. */
  submenuKey: string | null;
  onItem: (item: PopoverMenuItem, element: HTMLElement) => void;
  onRowEnter: (item: PopoverMenuItem, element: HTMLElement) => void;
  onRowLeave: (item: PopoverMenuItem) => void;
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
          {item.header ? (
            /* A band is the item: no row is rendered and the row fields are
               ignored. It rides the same reveal slot as the rows around it. */
            <HeaderBand header={item.header} inSubmenu={inSubmenu} renderHeader={renderHeader} />
          ) : (
            <>
              {item.heading && <div className={styles.heading}>{item.heading}</div>}
              {item.render ?? (
                <DefaultRow
                  item={item}
                  roomy={roomy}
                  submenuOpen={submenuKey === item.key}
                  variant={variant}
                  renderItem={renderItem}
                  inSubmenu={inSubmenu}
                  onItem={onItem}
                  onRowEnter={onRowEnter}
                  onRowLeave={onRowLeave}
                />
              )}
            </>
          )}
        </div>
      ))}
    </>
  );
}
