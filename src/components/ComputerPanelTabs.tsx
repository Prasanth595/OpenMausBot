import type { ReactNode } from "react";
import { CalendarClock, Database, FolderOpen, Globe, Monitor, Smartphone } from "lucide-react";
import { t } from "@/lib/i18n";
import { Tab, TabList } from "./tabs";

/** Pulsing live marker shown on the tab of the place a session is running in. */
function liveDot(testId: string): ReactNode {
  return (
    <span
      className="size-1.5 animate-pulse rounded-full bg-success"
      role="img"
      aria-label={t("place.live")}
      data-testid={testId}
    />
  );
}

/** The truncating label, with its full text kept as the hover tooltip. */
function label(text: string): ReactNode {
  return <span className="min-w-0 truncate" title={text}>{text}</span>;
}

/**
 * Width one header tab needs in its full form (icon + label), px. The bar
 * drops to text-only once the panel is narrower than tabs × this budget.
 * Sits just under the widest labels so the row collapses before it scrolls.
 */
export const PANEL_TAB_MIN_WIDTH = 100;

/** The bar: one row hugging its tabs, scrolling without ever drawing a bar. */
const BAR_CLASS = "mx-auto grid w-fit max-w-full min-w-0 grid-flow-col auto-cols-max overflow-x-auto rounded-2xl bg-inset p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** One header tab: the pill segment, its states, and the narrow form. */
const TAB_CLASS = "flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-1 text-[12px] whitespace-nowrap text-ink-secondary transition-colors hover:text-ink data-[selected]:bg-raised data-[selected]:text-ink data-[selected]:shadow-sm data-[display=text-only]:[&>svg]:hidden";

export interface ComputerPanelTabsInput {
  /** Advanced mode swaps Files for Routines and can add the Android tab. */
  advanced: boolean;
  /** Whether an Android device is connected (Advanced only). */
  androidConnected: boolean;
  /** A session is live on the Computer place. */
  computerLive: boolean;
  /** A session is live on the Browser place. */
  browserLive: boolean;
}

/**
 * Header tabs for the Computer panel, in display order. Data is in both modes;
 * Advanced swaps Files for Routines and adds Android when a device is
 * connected. Live dots mark the place a session is running in.
 */
export function computerPanelTabs(input: ComputerPanelTabsInput): ReactNode {
  return [
    <Tab key="computer" value="computer" className={TAB_CLASS}>
      <Monitor size={13} />
      {label(t("computer.tab.computer"))}
      {input.computerLive && liveDot("computer-tab-live")}
    </Tab>,
    ...(input.advanced
      ? [
          <Tab key="routines" value="routines" className={TAB_CLASS}>
            <CalendarClock size={13} />
            {label(t("computer.tab.routines"))}
          </Tab>,
        ]
      : []),
    ...(input.advanced && input.androidConnected
      ? [
          <Tab key="android" value="android" className={TAB_CLASS}>
            <Smartphone size={13} />
            {label(t("computer.tab.android"))}
          </Tab>,
        ]
      : []),
    <Tab key="browser" value="browser" className={TAB_CLASS} data-tour="computer-browser">
      <Globe size={13} />
      {label(t("computer.tab.browser"))}
      {input.browserLive && liveDot("browser-tab-live")}
    </Tab>,
    <Tab key="data" value="data" className={TAB_CLASS} data-tour="computer-data">
      <Database size={13} />
      {label(t("computer.tab.data"))}
    </Tab>,
    ...(!input.advanced
      ? [
          <Tab key="files" value="files" className={TAB_CLASS}>
            <FolderOpen size={13} />
            {label(t("computer.tab.files"))}
          </Tab>,
        ]
      : []),
  ];
}

export interface ComputerPanelTabListProps {
  /** The `<Tab>` triggers, from `computerPanelTabs`. */
  children?: ReactNode;
}

/** Ids stay stable across renders, so panels and tests can address the bar. */
export const PANEL_TABS_ID = "computer-panel-tabs";

/**
 * The panel's header bar: the generic headless `<TabList>` with this panel's
 * own look — one hugging row, text-only once the panel is narrow, and no
 * scrollbar drawn inside the pill. It must render inside the panel's
 * `<TabGroup>`, which is what wires it to the views below.
 */
export function ComputerPanelTabList({ children }: ComputerPanelTabListProps) {
  return (
    <TabList
      aria-label={t("computer.tabsAria")}
      data-testid="computer-tabs"
      data-tour="computer-tabs"
      minTabWidth={PANEL_TAB_MIN_WIDTH}
      collapse="text"
      scrollbar="hidden"
      className={BAR_CLASS}
    >
      {children}
    </TabList>
  );
}
