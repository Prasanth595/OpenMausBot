import { useCallback, useId, useMemo } from "react";
import type { ReactNode } from "react";
import { TabGroupContext, type TabGroupContextValue } from "./context";

export interface TabGroupProps<T extends string = string> {
  /** Controlled selection. The group learns the new value through `onChange`. */
  value: T;
  /** Fires when selection moves to a different tab. */
  onChange: (value: T) => void;
  /**
   * Fires on every tab press, before `onChange`. Pressing an inactive tab
   * fires `onInput` then `onChange`; re-pressing the already-active tab fires
   * only `onInput` (e.g. to scroll its panel back to top). Disabled tabs fire
   * neither.
   */
  onInput?: (value: T) => void;
  /**
   * Stable base for the generated tab and panel ids. Defaults to `useId()`.
   * Pass a stable value when a caller wires its own `tabpanel`.
   */
  id?: string;
  /** A `<TabList>`, its `Tab`s, and either `<TabPanels>` or the caller's own panel. */
  children?: ReactNode;
}

/**
 * Selection state for one tab bar. Renders no element of its own — the parts
 * below it keep the caller's layout — and ships no styles: every part is a
 * plain element carrying state as `data-*` attributes for the caller to style.
 */
export function TabGroup<T extends string>({ value, onChange, onInput, id, children }: TabGroupProps<T>) {
  // useId() runs unconditionally: the hook order must not depend on whether
  // the caller supplied an id.
  const generatedId = useId();
  const baseId = id ?? generatedId;
  /** Selects a tab value, firing input on every press and change only on moves. */
  const select = useCallback(
    (next: string) => {
      onInput?.(next as T);
      if (next === value) return;
      onChange(next as T);
    },
    [value, onChange, onInput],
  );
  const contextValue = useMemo<TabGroupContextValue>(
    () => ({ selected: value, select, baseId }),
    [value, select, baseId],
  );
  return <TabGroupContext.Provider value={contextValue}>{children}</TabGroupContext.Provider>;
}
