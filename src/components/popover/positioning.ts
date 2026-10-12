// Pure geometry for the generic popover. No React, no DOM access here so the
// placement rules stay unit-testable without a browser.
export interface PopoverBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PopoverSize {
  width: number;
  height: number;
}

export interface PopoverPoint {
  x: number;
  y: number;
}

export type PopoverPlacement = "above" | "below" | "before" | "after" | "auto";
export type PopoverAlign = "start" | "end" | "center";

export const POPOVER_WIDTH = 280;
export const SUBMENU_MIN_WIDTH = 220;
export const EDGE_MARGIN = 8;
export const ANCHOR_GAP = 6;
const SUBMENU_GAP = 4;

/** Opening is quick enough to feel like a hover, closing is slow enough to
 * forgive a diagonal path from the trigger to the menu. */
export const OPEN_DELAY_MS = 80;
export const CLOSE_DELAY_MS = 250;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Horizontal origin for a sheet hung under/over a trigger. */
function alignedLeft(
  anchor: PopoverBox,
  menuWidth: number,
  viewportWidth: number,
  align: PopoverAlign,
  rtl: boolean,
): number {
  const maxLeft = Math.max(EDGE_MARGIN, viewportWidth - menuWidth - EDGE_MARGIN);
  let left: number;
  if (align === "center") {
    left = (anchor.left + anchor.right) / 2 - menuWidth / 2;
  } else if (align === "end") {
    left = rtl ? anchor.left : anchor.right - menuWidth;
  } else {
    left = rtl ? anchor.right - menuWidth : anchor.left;
  }
  return clamp(left, EDGE_MARGIN, maxLeft);
}

/** Vertical origin for a sheet beside a trigger. */
function alignedTop(
  anchor: PopoverBox,
  menuHeight: number,
  viewportHeight: number,
  align: PopoverAlign,
): number {
  const maxTop = Math.max(EDGE_MARGIN, viewportHeight - menuHeight - EDGE_MARGIN);
  let top: number;
  if (align === "center") {
    top = (anchor.top + anchor.bottom) / 2 - menuHeight / 2;
  } else if (align === "end") {
    top = anchor.bottom - menuHeight;
  } else {
    top = anchor.top;
  }
  return clamp(top, EDGE_MARGIN, maxTop);
}

export interface PlacedPopover {
  left: number;
  top: number;
  /** The placement actually used after "auto" resolution and fallbacks. */
  resolved: Exclude<PopoverPlacement, "auto">;
}

/** Where a trigger-anchored sheet goes. "auto" prefers above and drops below
 * when there is no room, mirroring the profile menu. Explicit placements fall
 * back to their opposite when they would run off the window. Always clamped
 * inside the viewport. */
export function triggerPopoverPosition(
  anchor: PopoverBox,
  menu: PopoverSize,
  viewport: PopoverSize,
  options: { placement?: PopoverPlacement; align?: PopoverAlign; offset?: number; rtl?: boolean } = {},
): PlacedPopover {
  const placement = options.placement ?? "auto";
  const align = options.align ?? "start";
  const offset = options.offset ?? ANCHOR_GAP;
  const rtl = options.rtl ?? false;
  const maxTop = Math.max(EDGE_MARGIN, viewport.height - menu.height - EDGE_MARGIN);

  const aboveTop = anchor.top - offset - menu.height;
  const belowTop = anchor.bottom + offset;
  const fitsAbove = aboveTop >= EDGE_MARGIN;
  const fitsBelow = belowTop <= maxTop;

  if (placement === "above" || (placement === "auto" && fitsAbove)) {
    const top = fitsAbove ? aboveTop : belowTop;
    return {
      left: alignedLeft(anchor, menu.width, viewport.width, align, rtl),
      top: clamp(top, EDGE_MARGIN, maxTop),
      resolved: fitsAbove ? "above" : "below",
    };
  }
  if (placement === "below" || placement === "auto") {
    // "auto" mirrors the profile menu: above when it fits, otherwise below
    // (clamped) so the sheet stays glued to the trigger.
    const fallback = placement === "below" ? aboveTop : belowTop;
    const top = fitsBelow ? belowTop : fallback;
    return {
      left: alignedLeft(anchor, menu.width, viewport.width, align, rtl),
      top: clamp(top, EDGE_MARGIN, maxTop),
      resolved: fitsBelow ? "below" : placement === "below" ? "above" : "below",
    };
  }

  // Side placements align on the requested edge and flip side when crowded.
  const afterLeft = rtl ? anchor.left - offset - menu.width : anchor.right + offset;
  const beforeLeft = rtl ? anchor.right + offset : anchor.left - offset - menu.width;
  const fits = (left: number) => left >= EDGE_MARGIN && left + menu.width <= viewport.width - EDGE_MARGIN;
  if (placement === "after") {
    const left = fits(afterLeft) ? afterLeft : beforeLeft;
    return {
      left: clamp(left, EDGE_MARGIN, Math.max(EDGE_MARGIN, viewport.width - menu.width - EDGE_MARGIN)),
      top: alignedTop(anchor, menu.height, viewport.height, align),
      resolved: fits(afterLeft) ? "after" : "before",
    };
  }
  const left = fits(beforeLeft) ? beforeLeft : afterLeft;
  return {
    left: clamp(left, EDGE_MARGIN, Math.max(EDGE_MARGIN, viewport.width - menu.width - EDGE_MARGIN)),
    top: alignedTop(anchor, menu.height, viewport.height, align),
    resolved: fits(beforeLeft) ? "before" : "after",
  };
}

/** Where a point-anchored (context-menu) sheet goes: below-end of the point
 * by default, flipped up/over when the window has no room, always clamped so
 * negative or edge anchors still land inside. */
export function pointPopoverPosition(
  point: PopoverPoint,
  menu: PopoverSize,
  viewport: PopoverSize,
  options: { offset?: number; rtl?: boolean } = {},
): PlacedPopover {
  const offset = options.offset ?? ANCHOR_GAP;
  const rtl = options.rtl ?? false;
  const maxLeft = Math.max(EDGE_MARGIN, viewport.width - menu.width - EDGE_MARGIN);
  const maxTop = Math.max(EDGE_MARGIN, viewport.height - menu.height - EDGE_MARGIN);
  const end = rtl ? point.x - offset - menu.width : point.x + offset;
  const start = rtl ? point.x + offset : point.x - offset - menu.width;
  const fits = (left: number) => left >= EDGE_MARGIN && left + menu.width <= viewport.width - EDGE_MARGIN;
  const left = clamp(fits(end) ? end : start, EDGE_MARGIN, maxLeft);
  const below = point.y + offset;
  const above = point.y - offset - menu.height;
  const fitsBelow = below <= maxTop;
  const top = clamp(fitsBelow ? below : above, EDGE_MARGIN, maxTop);
  return { left, top, resolved: fitsBelow ? "below" : "above" };
}

/** Where a submenu goes: beside its parent menu on the inline end side, lined
 * up with the row that opened it, flipped when the window has no room. */
export function submenuPosition(
  menu: PopoverBox,
  row: PopoverBox,
  submenu: PopoverSize,
  viewport: PopoverSize,
  rtl = false,
): { left: number; top: number } {
  const after = rtl ? menu.left - SUBMENU_GAP - submenu.width : menu.right + SUBMENU_GAP;
  const before = rtl ? menu.right + SUBMENU_GAP : menu.left - SUBMENU_GAP - submenu.width;
  const fits = (left: number) => left >= EDGE_MARGIN && left + submenu.width <= viewport.width - EDGE_MARGIN;
  const preferred = fits(after) ? after : fits(before) ? before : after;
  const maxLeft = Math.max(EDGE_MARGIN, viewport.width - submenu.width - EDGE_MARGIN);
  const maxTop = Math.max(EDGE_MARGIN, viewport.height - submenu.height - EDGE_MARGIN);
  return {
    left: clamp(preferred, EDGE_MARGIN, maxLeft),
    top: clamp(row.top - 6, EDGE_MARGIN, maxTop),
  };
}

/** Arrow keys, Home and End move focus among a menu's items, wrapping. */
export function nextMenuIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export function isRtlElement(element: Element | null): boolean {
  return (
    typeof getComputedStyle === "function" && element != null && getComputedStyle(element).direction === "rtl"
  );
}

/** Material-Web-style transform origin so the scale part of pop-in grows out
 * of the anchor edge instead of the sheet center. */
export function transformOriginForPlacement(
  resolved: Exclude<PopoverPlacement, "auto">,
  rtl = false,
): string {
  switch (resolved) {
    case "above":
      return rtl ? "bottom right" : "bottom left";
    case "below":
      return rtl ? "top right" : "top left";
    case "before":
      return rtl ? "left center" : "right center";
    case "after":
      return rtl ? "right center" : "left center";
  }
}
