import { Puzzle, X } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { dismissConnectAppsPill, useConnectAppsPillDismissed } from "@/lib/connect-apps-pill";
import { everyAppConnected, everyCatalogueAppConnected } from "@/lib/connector-status";
import { t } from "@/lib/i18n";
import { loadNativeAppConnections } from "@/lib/native-app-connections";
import { useStore } from "@/state/store";

import { loadAppCatalogue } from "./bot-settings/useBotApps";
import { preloadConnectedApps, type ToolkitCard } from "./PluginsPanel";
import { ELEVATED_CONTROL, ELEVATED_HOVER } from "./elevated";
import { SIMPLE_TOP_BUTTON } from "./SidebarSimpleTop";

export type AppFace = Pick<ToolkitCard, "slug" | "label" | "logo" | "domain">;

export const POPULAR_APPS: readonly AppFace[] = [
  { slug: "gmail", label: "Gmail", logo: null, domain: "gmail.com" },
  { slug: "slack", label: "Slack", logo: null, domain: "slack.com" },
  { slug: "notion", label: "Notion", logo: null, domain: "notion.so" },
];

export const APP_FACES = 3;

export function appFaces(connected: readonly string[], cards: ReadonlyMap<string, AppFace>): AppFace[] {
  const own = connected.map((slug) => cards.get(slug)).filter((card): card is AppFace => Boolean(card));
  return [...own, ...POPULAR_APPS.filter((app) => !own.some((card) => card.slug === app.slug))].slice(0, APP_FACES);
}

/** `null` until the first inventory and catalogue answer arrive: the pill starts hidden so a fully connected sidebar
 *  never paints it for a frame and then snatches it away. */
function useAppFaces(): { faces: AppFace[]; nothingToConnect: boolean } | null {
  const { state } = useStore();
  const [result, setResult] = useState<{ faces: AppFace[]; nothingToConnect: boolean } | null>(null);
  useEffect(() => {
    if (state.pluginsOpen) return;
    let alive = true;
    void Promise.all([preloadConnectedApps(true), loadAppCatalogue()])
      .then(async ([inventory, catalogue]) => {
        const connected = Object.entries(inventory.services).filter(([, status]) => status.connected).map(([slug]) => slug).sort();
        const cards = connected.length > 0 ? catalogue.cards : new Map<string, AppFace>();
        // An unread or empty catalogue must keep the pill: the other direction hides a real connection.
        const slugs = catalogue.complete ? catalogue.slugs : null;
        const catalogueDone = everyCatalogueAppConnected(inventory.services, inventory.authoritative, slugs);
        const native = catalogueDone ? await loadNativeAppConnections() : [];
        if (alive) {
          setResult({
            faces: appFaces(connected, cards),
            nothingToConnect: everyAppConnected(inventory.services, inventory.authoritative, slugs, native),
          });
        }
      })
      .catch(() => {
        if (alive) setResult({ faces: appFaces([], new Map()), nothingToConnect: false });
      });
    return () => { alive = false; };
  }, [state.pluginsOpen]);
  return result;
}

function AppFaceIcon({ face, className }: { face: AppFace; className?: string }) {
  const sources = [face.logo, face.domain ? `https://www.google.com/s2/favicons?domain=${face.domain}&sz=64` : null].filter((src): src is string => Boolean(src));
  const [failed, setFailed] = useState(0);
  const src = sources[failed];
  return (
    <span data-app-face={face.slug} className={cn("flex size-[18px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-white p-px ring-[1.5px] ring-composer", className)}>
      {src
        ? <img src={src} alt="" draggable={false} className="size-4 object-contain" onError={() => setFailed((count) => count + 1)} />
        : <span className="text-[10px] font-semibold leading-none text-neutral-700">{face.label.slice(0, 1).toUpperCase()}</span>}
    </span>
  );
}

/** The outer logos fan out while the pill is hovered. */
const FAN = ["motion-safe:group-hover/apps:-translate-x-[3px] motion-safe:group-hover/apps:-rotate-[8deg]", "", "motion-safe:group-hover/apps:translate-x-[3px] motion-safe:group-hover/apps:rotate-[8deg]"];

/** `circle` is the collapsed rail's round button. */
export function SidebarConnectAppsButton({ circle = false, faces, open, onOpen, onDismiss, settled = true }: {
  circle?: boolean;
  faces: readonly AppFace[];
  open: boolean;
  onOpen: () => void;
  onDismiss?: () => void;
  /** false before the first inventory answer: the button is in the tree for its footer slot but never painted. */
  settled?: boolean;
}) {
  const label = t("sidebar.connectApps");
  return (
    <span className={circle ? "flex shrink-0 flex-col items-center gap-1" : "flex min-w-0 flex-1 items-center gap-1"}>
      <button
        type="button"
        data-tour="nav-apps"
        data-sidebar-nav="apps"
        hidden={!settled}
        aria-pressed={open}
        aria-label={circle ? label : undefined}
        title={circle ? label : undefined}
        onClick={onOpen}
        className={circle ? SIMPLE_TOP_BUTTON : cn("group/apps flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full pl-4 pr-3 text-[14px] font-medium leading-5 text-ink", ELEVATED_CONTROL, ELEVATED_HOVER)}
      >
        {circle ? <Puzzle size={18} strokeWidth={1.5} aria-hidden="true" /> : <>
          <span className="min-w-0 truncate">{label}</span>
          <span aria-hidden="true" className="flex shrink-0 items-center">
            {faces.map((face, index) => <AppFaceIcon key={face.slug} face={face}
              className={cn(index > 0 && "-ms-1.5", faces.length > 1 && FAN[index === 0 ? 0 : index === faces.length - 1 ? 2 : 1], "motion-safe:transition-transform motion-safe:duration-150")} />)}
          </span>
        </>}
      </button>
      {onDismiss && (
        <button
          type="button"
          data-connect-apps-dismiss
          hidden={!settled}
          aria-label={t("sidebar.hideConnectApps")}
          title={t("sidebar.hideConnectApps")}
          onClick={onDismiss}
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-menu text-ink-tertiary ring-1 ring-hairline transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X size={11} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

export function SidebarConnectApps({ circle = false }: { circle?: boolean }) {
  const { state, dispatch } = useStore();
  const dismissed = useConnectAppsPillDismissed();
  const result = useAppFaces();
  if (dismissed || result?.nothingToConnect) return null;
  return <SidebarConnectAppsButton
    circle={circle}
    faces={result?.faces ?? appFaces([], new Map())}
    open={state.pluginsOpen}
    onOpen={() => dispatch({ type: "togglePlugins", open: true })}
    onDismiss={dismissConnectAppsPill}
    settled={result !== null || state.pluginsOpen}
  />;
}
