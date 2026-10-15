import { createContext, useContext } from "react";
import type { TabCollapse } from "./types";

/** Selection and id plumbing shared by every part of one `<TabGroup>`. */
export interface TabGroupContextValue {
  /** Currently selected tab value. */
  selected: string;
  /** Selects a value: fires the group's `onInput`, then `onChange` on a move. */
  select: (value: string) => void;
  /** Stable base id for the generated tab and panel ids. */
  baseId: string;
}

/** Row plumbing that only a `<TabList>` can provide. */
export interface TabListContextValue {
  /** Registers a trigger so arrow keys can move focus to it. */
  register: (value: string, element: HTMLElement | null) => void;
  /** Returns the roving tabindex for a trigger. */
  tabIndexFor: (value: string, disabled: boolean) => number;
  /** The list is narrower than its tabs need in their full form. */
  narrow: boolean;
  /** The compact form the list collapses to when narrow. */
  collapse: TabCollapse;
}

/** Tab trigger `id` for a group base id and tab value. */
export const tabsTabId = (baseId: string, value: string): string => `${baseId}-tab-${value}`;

/** Panel `id` for a group base id and tab value. */
export const tabsPanelId = (baseId: string, value: string): string => `${baseId}-panel-${value}`;

/** Ambient tab group selection, or null outside one. */
export const TabGroupContext = createContext<TabGroupContextValue | null>(null);

/** Ambient tab list row plumbing, or null outside one. */
export const TabListContext = createContext<TabListContextValue | null>(null);

/** Returns the ambient tab group, or null outside one. */
export function useTabGroupContext(): TabGroupContextValue | null {
  return useContext(TabGroupContext);
}

/** Returns the ambient tab list, or null outside one. */
export function useTabListContext(): TabListContextValue | null {
  return useContext(TabListContext);
}
