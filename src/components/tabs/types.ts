import type { ElementType, ReactNode } from "react";

/**
 * The form a tab trigger is showing, published as `data-display` on the
 * trigger so the caller can style the compact forms. `"icon-text"` is the full
 * form; `"icon-only"` means the label is the caller's to hide (keeping it for
 * assistive tech); `"text-only"` means the icon is the caller's to hide.
 */
export type TabDisplay = "icon-text" | "icon-only" | "text-only";

/**
 * Which compact form the list collapses its tabs to once they no longer fit:
 * `"text"` (default) keeps every label and drops the icons, `"icon"` keeps the
 * icons and drops the labels, `"none"` never collapses — the row scrolls.
 */
export type TabCollapse = "text" | "icon" | "none";

/**
 * Scrollbar state the list publishes. The package paints nothing: the list
 * carries `data-scrollbar` with this value, and — in the `"scrolling"` mode
 * only — `data-scrolling="true"` for 700ms after the row last moved, so a
 * caller can draw a transient bar without it ever appearing at rest.
 */
export type TabsScrollbar = "auto" | "hidden" | "scrolling";

/** State a `<Tab>` hands to a function child and to `as={Fragment}` renders. */
export interface TabState {
  /** This tab holds the group's selected value. */
  selected: boolean;
  /** The pointer is over this tab. */
  hover: boolean;
  /** This tab has keyboard focus. */
  focus: boolean;
  /** This tab is disabled: no pointer, no keyboard, no selection. */
  disabled: boolean;
  /** The list is narrower than its tabs need in their full form. */
  narrow: boolean;
  /** The form the list resolved for this tab. */
  display: TabDisplay;
}

/** State a `<TabPanel>` hands to a function child. */
export interface TabPanelState {
  /** This panel's tab holds the group's selected value. */
  selected: boolean;
}

/** Arbitrary `data-*` attributes, forwarded to the rendered element. */
export interface DataAttributes {
  [key: `data-${string}`]: unknown;
}

/** Props every part accepts on top of its own. */
export interface PartBase {
  /** Element to render instead of the part's default tag. `Fragment` merges
   *  the part's props into the single element child instead of adding one. */
  as?: ElementType;
  /** Extra classes for the rendered element; the package adds none of its own. */
  className?: string;
  /** Content. Parts that support a function child document its arguments. */
  children?: ReactNode;
}
