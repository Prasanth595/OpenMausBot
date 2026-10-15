import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { tabsPanelId, tabsTabId, useTabGroupContext } from "./context";
import { mergePartProps, renderPart } from "./renderPart";
import type { DataAttributes, TabPanelState } from "./types";

export interface TabPanelProps
  extends Omit<ComponentPropsWithoutRef<"div">, "className" | "children" | "hidden">,
    DataAttributes {
  /** Value of the tab this panel belongs to. */
  value: string;
  /**
   * Unmount the panel while its tab is not selected (default), or `false` to
   * keep it in the DOM with `hidden` — the mode a panel that must not lose its
   * state or re-run its effects uses.
   */
  unmount?: boolean;
  /** Element to render instead of `div`; `Fragment` merges into the child. */
  as?: ElementType;
  /** Extra classes for the panel. */
  className?: string;
  /** Content, or a function of `({ selected }) => ReactNode`. */
  children?: ReactNode | ((state: TabPanelState) => ReactNode);
}

/**
 * One panel of a group, wired to its tab: `role="tabpanel"`, the tab's id as
 * `aria-labelledby`, and the shared id the tab's `aria-controls` points at.
 * Renders only while its tab is selected unless `unmount={false}`. It does not
 * need a `<TabPanels>` around it, so a caller can place it wherever its own
 * layout wants the content.
 */
export function TabPanel({
  value,
  unmount = true,
  as,
  className,
  children,
  ...rest
}: TabPanelProps) {
  const group = useTabGroupContext();
  const selected = group?.selected === value;
  if (!selected && unmount) return null;
  const partProps = mergePartProps(rest, {
    className,
    id: group ? tabsPanelId(group.baseId, value) : undefined,
    role: "tabpanel",
    "aria-labelledby": group ? tabsTabId(group.baseId, value) : undefined,
    "data-selected": selected || undefined,
    hidden: selected ? undefined : true,
  });
  const state: TabPanelState = { selected };
  return renderPart(as, "div", partProps, typeof children === "function" ? children(state) : children);
}
