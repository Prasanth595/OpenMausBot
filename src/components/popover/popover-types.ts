// Shared props for the generic popover. No business concepts here — only
// geometry, dismissal and surface variant, so any feature can reuse the shell
// by passing data through props.
import type { CSSProperties, ReactNode, RefObject } from "react";
import type { PopoverAlign, PopoverPlacement } from "./positioning";

export type { PopoverAlign, PopoverPlacement };

/** Trigger-anchored (button) or point-anchored (context menu) floating UI. */
export type PopoverAnchor = { kind: "trigger" } | { kind: "point"; x: number; y: number };

export type PopoverVariant = "styled" | "headless";

export interface PopoverDismissOptions {
  /** Press outside the trigger + sheet closes. Default true. */
  outsidePress?: boolean;
  /** Escape closes. Default true. */
  escape?: boolean;
  /** Hover opens/closes with a delay (the header More button). Default false. */
  leave?: boolean | { openDelay?: number; closeDelay?: number };
  /** Tab closes and returns focus to the trigger. Default true. */
  tabCloses?: boolean;
}

export interface PopoverTriggerApi {
  open: boolean;
  toggle: () => void;
  close: (refocus?: boolean) => void;
}

export interface PopoverContentApi {
  open: boolean;
  close: (refocus?: boolean) => void;
}

export interface PopoverProps {
  ariaLabel: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  anchor?: PopoverAnchor;
  placement?: PopoverPlacement;
  align?: PopoverAlign;
  /** Gap between anchor and sheet. Default ANCHOR_GAP (6). */
  offset?: number;
  /** Sheet width. Default POPOVER_WIDTH (280). */
  width?: number;
  dismiss?: PopoverDismissOptions;
  trigger?: (api: PopoverTriggerApi) => ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
  variant?: PopoverVariant;
  className?: string;
  style?: CSSProperties;
  /** Portal to document.body with fixed coordinates. Default true. */
  portal?: boolean;
  zIndex?: number;
  /** ARIA role of the floating sheet. Default "dialog"; menus pass "menu". */
  contentRole?: string;
  /** Sheet motion: the generic pop, or the menu motion (container grows out
   * of its anchor edge, shrinks back on close). Default "pop". */
  motionKind?: "pop" | "menu";
  /** Skip motion entirely: no enter/exit and no held close — the sheet
   * unmounts on the render it closes. Default false. */
  quick?: boolean;
  /** Shared with a menu wrapper so a submenu can anchor to the same sheet. */
  contentRef?: RefObject<HTMLDivElement | null>;
  /** Extra nodes (a submenu sheet) that count as "inside" for dismissal. */
  extraInsideRefs?: Array<RefObject<HTMLElement | null>>;
  /** Key that re-runs placement (e.g. items length + submenu key). */
  repositionKey?: string | number;
  /** Notifies when the sheet is measured and placed. */
  onPlaced?: (rect: { left: number; top: number }) => void;
  children: ReactNode | ((api: PopoverContentApi) => ReactNode);
}
