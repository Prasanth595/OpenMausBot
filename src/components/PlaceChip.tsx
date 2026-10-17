import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { instanceSupportsLocalComputer, localComputerDisabledReason, localComputerSelectable } from "@/lib/local-computer";
import { effectivePlace, PLACES, placeLabelKey, placeOffered, type Place } from "@/lib/place";
import { placeBlocked, placeFacts, placeHasIssue, placeViewFor, usePlaceSeat } from "@/lib/place-view";
import { useStore, type Bot, type Task } from "@/state/store";
import type { PlaceView } from "../../shared/place-view";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { PlaceIcon } from "./PlaceIcon";
import { PopoverMenu, type PopoverMenuItem } from "./popover/PopoverMenu";

export type PlaceAvailability = Record<Place, boolean>;

/** Each place's view (shared/place-view.ts) for this bot, and whether a
 * conversation can be pinned there: the same view the Works on cards and
 * the Simple grid read, so the chip never offers a place the panel would
 * grey out, and names a problem in the same few words. */
export function usePlaceViews(bot: Bot): Record<Place, { view: PlaceView; reachable: boolean; policy: boolean }> {
  const { state } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const seat = usePlaceSeat(state.config, capabilities.host.platform);
  const backend = bot.cloudBackend === "vps" ? "vps" : "box";
  // Places the enrolled organisation disallows, or this server never
  // offers (an OMB Cloud home), are not reachable.
  const allowed = state.config?.managedPolicy?.computers ?? { thisComputer: true, localVm: true, box: true, vps: true };
  const providerSupportsLocal = instanceSupportsLocalComputer(state.instances, bot);
  const local = {
    ready: localComputerSelectable({ capabilities, providerSupportsLocal }),
    reason: localComputerDisabledReason({ capabilities, providerSupportsLocal }) ?? t("computer.unavailableLocal"),
  };
  const entry = (place: Place) => {
    const view = placeViewFor(placeFacts({ bot, place, seat, config: state.config, instances: state.instances, local }));
    const policy = (place === "cloud" ? allowed[backend] : place === "vm" ? allowed.localVm : place === "local" ? allowed.thisComputer : true)
      && placeOffered(place, state.config);
    return { view, policy, reachable: policy && !placeBlocked(view) };
  };
  return { cloud: entry("cloud"), vm: entry("vm"), local: entry("local"), browser: entry("browser") };
}

export function usePlaceAvailability(bot: Bot): PlaceAvailability {
  const views = usePlaceViews(bot);
  return { cloud: views.cloud.reachable, vm: views.vm.reachable, local: views.local.reachable, browser: views.browser.reachable };
}

const DESCRIPTION: Record<Place, "computer.dest.cloudDesc" | "computer.dest.vmDesc" | "computer.dest.localDesc" | "computer.dest.browserDesc"> = {
  cloud: "computer.dest.cloudDesc", vm: "computer.dest.vmDesc", local: "computer.dest.localDesc", browser: "computer.dest.browserDesc",
};

/** Where this conversation works, beside the send button in Advanced mode
 * (Simple leaves every conversation on its bot's Works on). Shows the
 * effective place (the conversation's pin, else the bot's Works on), pulses
 * while a turn is acting there, and pins another place for this
 * conversation only. No confirmation card: choosing is the whole gesture. */
export function PlaceChip({ bot, task, live, disabled = false, onPin }: {
  bot: Bot;
  task?: Pick<Task, "surface"> | null;
  live: boolean;
  disabled?: boolean;
  onPin: (surface: Place | null) => void;
}) {
  const { state } = useStore();
  const places = usePlaceViews(bot);
  const effective = effectivePlace(bot, task);
  const pinned = Boolean(task?.surface);
  const off = effective === "off";
  const label = t(placeLabelKey(effective));
  const showLive = live && effective !== "off" && effective !== "auto";
  const title = off ? t("place.offHint") : disabled ? t("place.busy") : pinned ? t("place.pinnedHere") : t("place.fromBot");
  const botDefault = bot.computer ?? "auto";
  // A bot on Auto offers Auto itself as the unpinned default, rather than
  // "follow this bot's setting" spelled out to end in the same word.
  const followsAuto = botDefault === "auto";
  const choose = (surface: Place | null) => { if (surface !== (task?.surface ?? null)) onPin(surface); };
  const check = <Check size={14} className="text-accent" aria-hidden="true" />;

  const items: PopoverMenuItem[] = [
    // The band groups the chip's own title with the places under it.
    { key: "where-works", header: { title: t("place.chipTitle") } },
    {
      key: "auto",
      role: "menuitemradio",
      checked: !pinned,
      active: !pinned,
      title: followsAuto ? t("place.auto") : t("place.followBot"),
      content: followsAuto ? t("place.autoDetail") : t("place.followBotDetail", { place: t(placeLabelKey(botDefault)) }),
      lines: { content: -1 },
      leading: <PlaceIcon place={botDefault} aria-hidden="true" />,
      trailing: !pinned ? check : undefined,
      onSelect: () => choose(null),
    },
    ...PLACES.filter((place) => placeOffered(place, state.config)).map((place): PopoverMenuItem => {
      const selected = task?.surface === place;
      const { view, reachable, policy } = places[place];
      // A problem is named in the panel's own few words; a place
      // the organisation or this server never offers stays plain.
      const detail = !policy ? t("place.unavailable") : placeHasIssue(view) ? view.short : t(DESCRIPTION[place]);
      return {
        key: place,
        role: "menuitemradio",
        checked: selected,
        active: selected,
        title: t(placeLabelKey(place)),
        content: detail,
        lines: { content: -1 },
        leading: <PlaceIcon place={place} aria-hidden="true" />,
        trailing: selected ? check : undefined,
        disabled: !reachable,
        hint: !policy ? t("place.unavailable") : placeHasIssue(view) ? view.line : undefined,
        onSelect: () => choose(place),
      };
    }),
  ];

  return (
    <PopoverMenu
      items={items}
      ariaLabel={t("place.chipAria", { place: label })}
      placement="above"
      width={300}
      zIndex={40}
      triggerDisabled={disabled || off}
      triggerClassName={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-control hover:text-ink",
        pinned && "text-accent hover:text-accent",
        (disabled || off) && "cursor-not-allowed opacity-45 hover:bg-transparent",
      )}
      triggerTitle={off || disabled ? title : `${label} — ${title}`}
      trigger={() => (
        <span data-testid="place-chip" className="contents">
          <PlaceIcon place={effective} size={16} className="shrink-0 opacity-80" aria-hidden="true" />
          {showLive && <span className="absolute right-1.5 top-1.5 size-1.5 animate-pulse rounded-full bg-success" aria-label={t("place.live")} />}
        </span>
      )}
    />
  );
}
