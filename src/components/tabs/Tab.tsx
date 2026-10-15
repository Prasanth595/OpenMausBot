import { useCallback, useState } from "react";
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { tabsPanelId, tabsTabId, useTabGroupContext, useTabListContext } from "./context";
import { mergePartProps, renderPart } from "./renderPart";
import type { DataAttributes, TabDisplay, TabState } from "./types";

export interface TabProps
  extends Omit<ComponentPropsWithoutRef<"button">, "className" | "children" | "value">,
    DataAttributes {
  /** Value this trigger selects in its `<TabGroup>`. */
  value: string;
  /** Element to render instead of `button`; `Fragment` merges into the child. */
  as?: ElementType;
  /** Extra classes for the trigger. */
  className?: string;
  /**
   * Label, or a function of this tab's state — `({ selected, hover, focus,
   * disabled, narrow, display }) => ReactNode`. Use it (or `as={Fragment}`)
   * when the default `button` plus `className` is not enough.
   */
  children?: ReactNode | ((state: TabState) => ReactNode);
}

/**
 * One tab trigger: `role="tab"`, `aria-selected`, and the roving tabindex its
 * list hands out. Renders a plain `button` with no classes of its own; the
 * state it exposes as `data-*` (plus a function child) is the whole styling
 * contract. Outside a `<TabGroup>` it stays an inert button.
 */
export function Tab({
  value,
  disabled = false,
  autoFocus = false,
  as,
  className,
  children,
  ...rest
}: TabProps) {
  const group = useTabGroupContext();
  const list = useTabListContext();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const selected = group?.selected === value;
  const narrow = list?.narrow ?? false;
  const collapse = list?.collapse ?? "none";
  // The list owns the decision; the caller only paints the form it resolved.
  const display: TabDisplay =
    narrow && collapse !== "none" ? (collapse === "icon" ? "icon-only" : "text-only") : "icon-text";

  /** Keeps the trigger reachable by the list's keyboard moves. */
  const setRef = useCallback(
    (element: HTMLElement | null) => {
      list?.register(value, element);
    },
    [list, value],
  );

  const state: TabState = { selected, hover, focus, disabled, narrow, display };
  const partProps = mergePartProps(rest, {
    className,
    ref: setRef,
    type: "button",
    role: "tab",
    id: group ? tabsTabId(group.baseId, value) : undefined,
    "aria-selected": selected,
    "aria-controls": group ? tabsPanelId(group.baseId, value) : undefined,
    "aria-disabled": disabled || undefined,
    disabled,
    autoFocus,
    tabIndex: list ? list.tabIndexFor(value, disabled) : selected ? 0 : -1,
    "data-value": value,
    "data-display": display,
    "data-selected": selected || undefined,
    "data-hover": hover || undefined,
    "data-focus": focus || undefined,
    "data-disabled": disabled || undefined,
    onClick: () => {
      if (!disabled) group?.select(value);
    },
    onPointerEnter: () => setHover(true),
    onPointerLeave: () => setHover(false),
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
  });

  return renderPart(as, "button", partProps, typeof children === "function" ? children(state) : children);
}
