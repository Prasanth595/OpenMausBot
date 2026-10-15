import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ComponentPropsWithoutRef, ElementType, KeyboardEvent, ReactNode } from "react";
import { Tab } from "./Tab";
import { TabListContext, useTabGroupContext, type TabListContextValue } from "./context";
import { mergePartProps, renderPart } from "./renderPart";
import type { DataAttributes, TabCollapse, TabsScrollbar } from "./types";

export interface TabListProps extends Omit<ComponentPropsWithoutRef<"div">, "className" | "children">, DataAttributes {
  /** Element to render instead of `div`; `Fragment` merges into the child. */
  as?: ElementType;
  /** Extra classes for the tablist itself. */
  className?: string;
  /**
   * Classes for the measuring viewport the tablist is wrapped in, px-width
   * agnostic. The viewport is the full-width box the list measures its
   * available room from, so a flex host that wants it to grow passes
   * `flex-1 min-w-0` here.
   */
  viewportClassName?: string;
  /**
   * Space one tab needs in its full form, px. The list collapses once its
   * available room is under `count × minTabWidth`. Default 120.
   */
  minTabWidth?: number;
  /** The compact form tabs collapse to when the row no longer fits. */
  collapse?: TabCollapse;
  /** Which scrollbar state the list publishes (see `TabsScrollbar`). */
  scrollbar?: TabsScrollbar;
  /** `<Tab>` triggers. Their order and `disabled` flags come from these props. */
  children?: ReactNode;
}

const DEFAULT_MIN_TAB_WIDTH = 120;

/** How long the transient scrollbar state stays after the last scroll, ms. */
const SCROLLBAR_IDLE_MS = 700;

/** The viewport is a measuring box, not a styled part: it fills its host. */
const VIEWPORT_STYLE = { width: "100%", minWidth: 0 } as const;

/** Ordered tab values and disabled flags read off the `<Tab>` children. */
function readTabs(children: ReactNode): { value: string; disabled: boolean }[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return [];
    if (child.type === Fragment) {
      return readTabs((child.props as { children?: ReactNode }).children);
    }
    if (child.type !== Tab) return [];
    const props = child.props as { value?: unknown; disabled?: unknown };
    return typeof props.value === "string" ? [{ value: props.value, disabled: props.disabled === true }] : [];
  });
}

/**
 * The tab bar: `role="tablist"`, roving tabindex and arrow/Home/End keys, plus
 * the row's own behaviour — it measures the room it has, decides when its tabs
 * no longer fit, and publishes that as state. It renders no styles: the
 * tablist is a plain element and every bit of look is the caller's classes.
 */
export function TabList({
  as,
  className,
  viewportClassName,
  minTabWidth = DEFAULT_MIN_TAB_WIDTH,
  collapse = "text",
  scrollbar = "auto",
  children,
  ...rest
}: TabListProps) {
  const group = useTabGroupContext();
  const selected = group?.selected ?? "";

  const ordered = useMemo(() => readTabs(children), [children]);
  const enabled = useMemo(() => ordered.filter((tab) => !tab.disabled).map((tab) => tab.value), [ordered]);
  const disabledValues = useMemo(() => new Set(ordered.filter((tab) => tab.disabled).map((tab) => tab.value)), [ordered]);
  const count = ordered.length;

  /** Live triggers, so a keyboard move can focus the tab it selected. */
  const triggers = useRef(new Map<string, HTMLElement>());
  const register = useCallback((value: string, element: HTMLElement | null) => {
    if (element) triggers.current.set(value, element);
    else triggers.current.delete(value);
  }, []);

  /** Returns the roving tabindex for a trigger. */
  const tabIndexFor = useCallback(
    (value: string, disabled: boolean) => {
      if (disabled) return -1;
      if (value === selected && !disabledValues.has(selected)) return 0;
      // Roving tabindex: when nothing matches (or the selected tab is
      // disabled), the first enabled tab holds the stop so keyboard users can
      // still enter the tablist with Tab.
      if (!ordered.some((tab) => tab.value === selected) || disabledValues.has(selected)) {
        return enabled[0] === value ? 0 : -1;
      }
      return -1;
    },
    [selected, ordered, disabledValues, enabled],
  );

  /** Moves focus and selection by arrow/Home/End, skipping disabled tabs. */
  const move = useCallback(
    (current: string, delta: 1 | -1 | "first" | "last") => {
      if (enabled.length === 0) return;
      let next: string;
      if (delta === "first") next = enabled[0];
      else if (delta === "last") next = enabled[enabled.length - 1];
      else {
        const from = enabled.indexOf(current);
        const base = from === -1 ? (delta === 1 ? -1 : 0) : from;
        next = enabled[(base + delta + enabled.length) % enabled.length];
      }
      triggers.current.get(next)?.focus();
      group?.select(next);
    },
    [enabled, group],
  );

  /** Handles arrow/Home/End keys within the tablist. */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    const current = target?.closest?.("[data-value]")?.getAttribute("data-value") ?? selected;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        move(current, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        move(current, -1);
        break;
      case "Home":
        event.preventDefault();
        move(current, "first");
        break;
      case "End":
        event.preventDefault();
        move(current, "last");
        break;
    }
  };

  // The list decides when its tabs no longer fit: no caller breakpoints, no
  // media queries. It measures its viewport — a box that fills the host — so a
  // hugging bar still knows how much room it was given, and the collapsed
  // state can never feed back into the measurement.
  const viewport = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    // Layout effect: measure before paint, so the first frame already shows the
    // form the room allows instead of flickering from full to collapsed.
    if (collapse === "none" || count === 0) {
      setNarrow(false);
      return;
    }
    const element = viewport.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const read = () => {
      const room = element.clientWidth;
      // A hidden list has no room to measure; keep the last answer.
      if (room === 0) return;
      setNarrow(room < count * minTabWidth);
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [collapse, count, minTabWidth]);

  // Transient scrollbar: revealed by a scroll, put away once the row settles.
  const [scrolling, setScrolling] = useState(false);
  const scrollIdle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Keeps the scrolling state up for a moment after the row last moved. */
  const onScroll = () => {
    setScrolling(true);
    clearTimeout(scrollIdle.current);
    scrollIdle.current = setTimeout(() => setScrolling(false), SCROLLBAR_IDLE_MS);
  };
  useEffect(() => () => clearTimeout(scrollIdle.current), []);

  const listContext = useMemo<TabListContextValue>(
    () => ({ register, tabIndexFor, narrow, collapse }),
    [register, tabIndexFor, narrow, collapse],
  );

  const partProps = mergePartProps(rest, {
    className,
    role: "tablist",
    "data-narrow": narrow || undefined,
    "data-scrollbar": scrollbar,
    "data-scrolling": scrollbar === "scrolling" && scrolling ? true : undefined,
    onKeyDown,
    onScroll: scrollbar === "scrolling" ? onScroll : undefined,
  });

  return (
    <div ref={viewport} className={viewportClassName} style={VIEWPORT_STYLE}>
      <TabListContext.Provider value={listContext}>{renderPart(as, "div", partProps, children)}</TabListContext.Provider>
    </div>
  );
}
