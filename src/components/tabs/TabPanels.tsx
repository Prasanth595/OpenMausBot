import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { mergePartProps, renderPart } from "./renderPart";
import type { DataAttributes } from "./types";

export interface TabPanelsProps
  extends Omit<ComponentPropsWithoutRef<"div">, "className" | "children">,
    DataAttributes {
  /** Element to render instead of `div`; `Fragment` merges into the child. */
  as?: ElementType;
  /** Extra classes for the wrapper. */
  className?: string;
  /** `<TabPanel>` children. */
  children?: ReactNode;
}

/**
 * Optional wrapper around a group's panels — the layout slot between the bar
 * and the panels. It adds nothing but `as`/`className` forwarding, so a caller
 * that needs no wrapper can render its `<TabPanel>`s directly.
 */
export function TabPanels({ as, className, children, ...rest }: TabPanelsProps) {
  return renderPart(as, "div", mergePartProps(rest, { className }), children);
}
