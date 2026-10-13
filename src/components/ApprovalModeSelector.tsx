import { Check, FilePen, Hand, ListChecks, Settings, ShieldAlert, ShieldCheck } from "lucide-react";

import { approvalModeFor, hasNativeAutoReview, supportsApprovalMode, type ApprovalMode } from "../../shared/approval-mode";
import { cn } from "@/lib/cn";
import { APPROVAL_LEVELS_URL, openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { PopoverMenu, type PopoverMenuItem } from "./popover/PopoverMenu";

/** Keys, not labels — these are the words the held notes quote back to the
 * reader ("… so Approve for me stopped to ask"), and a label resolved in this
 * module-scope array would freeze the language the app booted in. */
const APPROVAL_MODE_KEYS: ReadonlyArray<{
  mode: ApprovalMode;
  labelKey: LocaleKey;
  chipKey: LocaleKey;
  descriptionKey: LocaleKey;
  Icon: typeof Hand;
}> = [
  { mode: "ask", labelKey: "approvalMode.ask.label", chipKey: "approvalMode.ask.chip", descriptionKey: "approvalMode.ask.desc", Icon: Hand },
  { mode: "edits", labelKey: "approvalMode.edits.label", chipKey: "approvalMode.edits.chip", descriptionKey: "approvalMode.edits.desc", Icon: FilePen },
  { mode: "auto", labelKey: "approvalMode.auto.label", chipKey: "approvalMode.auto.chip", descriptionKey: "approvalMode.auto.desc", Icon: ShieldCheck },
  { mode: "full", labelKey: "approvalMode.full.label", chipKey: "approvalMode.full.chip", descriptionKey: "approvalMode.full.desc", Icon: ShieldAlert },
  { mode: "custom", labelKey: "approvalMode.custom.label", chipKey: "approvalMode.custom.chip", descriptionKey: "approvalMode.custom.desc", Icon: Settings },
];

export interface ApprovalModeOption {
  mode: ApprovalMode;
  label: string;
  chip: string;
  description: string;
  Icon: typeof Hand;
}

/** The levels, in the reader's language. A function rather than a
 * constant: it has to answer to the language in effect when it is called. */
export function approvalModeOptions(): ApprovalModeOption[] {
  return APPROVAL_MODE_KEYS.map(({ mode, labelKey, chipKey, descriptionKey, Icon }) => ({
    mode,
    label: t(labelKey),
    chip: t(chipKey),
    description: t(descriptionKey),
    Icon,
  }));
}

/** The levels this engine offers here. Full is offered wherever the engine
 * runs it (owner decision, Oct 12); only Custom waits for the packaged
 * desktop's private channel (`trustedModesAvailable`). */
export function approvalModeOptionsFor(driverKind: string, trustedModesAvailable = true) {
  return approvalModeOptions()
    .filter((option) => supportsApprovalMode(driverKind, option.mode)
      // Antigravity has no native reviewer. Offer its explicit full-access
      // grant as Auto instead of a second choice that actually behaves as Ask.
      && (driverKind !== "antigravityAgent" || option.mode !== "auto")
      && (trustedModesAvailable || option.mode !== "custom"))
    .map((option) => {
      if (driverKind === "antigravityAgent" && option.mode === "full") {
        return {
          ...option,
          label: t("approvalMode.antigravity.label"),
          chip: t("approvalMode.auto.chip"),
          description: t("approvalMode.antigravity.desc"),
        };
      }
      return option.mode === "auto" && !hasNativeAutoReview(driverKind)
        ? { ...option, description: t("approvalMode.noNativeReview") }
        : option;
    });
}

/** Reports whether the current mode needs a local desktop to leave through HTTP. */
export function approvalModeSelectionRequiresLocalDesktop(
  currentMode: ApprovalMode,
  trustedModesAvailable: boolean,
) {
  // A persisted bot can temporarily lose its provider instance. Custom still
  // cannot leave through HTTP in that state, so the lock follows the durable
  // mode rather than today's provider lookup.
  return currentMode === "custom" && !trustedModesAvailable;
}

/** How much this bot may do on its own, shown beside the composer with the
 * current mode as its icon. Opens a menu that lists every available mode with
 * its label and description and returns the chosen mode to the caller. Compact
 * (icon-only) by default; `wide` renders the labeled variant used on bot
 * settings. */
export function ApprovalModeSelector({
  approvalMode,
  autoApprove,
  providerName,
  driverKind,
  onSelect,
  align = "left",
  menuDirection = "up",
  wide = false,
  disabled = false,
  trustedModesAvailable = true,
  trustedModesNotice,
  onManageCommandAllowlist,
}: {
  approvalMode?: ApprovalMode;
  autoApprove?: boolean;
  providerName: string;
  driverKind: string;
  onSelect: (mode: ApprovalMode) => void;
  align?: "left" | "right";
  menuDirection?: "up" | "down";
  wide?: boolean;
  disabled?: boolean;
  trustedModesAvailable?: boolean;
  trustedModesNotice?: string;
  onManageCommandAllowlist?: () => void;
}) {
  const savedMode = approvalModeFor({ approvalMode, autoApprove });
  // Old Antigravity Auto settings still ask. Do not display or silently grant
  // the new Auto/full-access behavior until the user explicitly selects it.
  const mode = driverKind === "antigravityAgent" && savedMode === "auto" ? "ask" : savedMode;
  const allOptions = approvalModeOptions();
  const current = approvalModeOptionsFor(driverKind).find((option) => option.mode === mode)
    ?? allOptions.find((option) => option.mode === mode)
    ?? allOptions[0];
  const visibleOptions = approvalModeOptionsFor(driverKind, trustedModesAvailable);
  const requiresLocalDesktop = approvalModeSelectionRequiresLocalDesktop(
    mode,
    trustedModesAvailable,
  );

  const CurrentIcon = current.Icon;
  const triggerDisabled = disabled && !onManageCommandAllowlist;
  const modesDisabled = disabled || requiresLocalDesktop;
  const notice = !trustedModesAvailable && (trustedModesNotice || driverKind === "codex" || requiresLocalDesktop)
    ? trustedModesNotice ?? t("approvalMode.customLocalOnlyDot")
    : null;
  // The management action follows Full access, the level it edits; with no
  // Full offered it closes the list instead.
  const allowlistItem: PopoverMenuItem = {
    key: "command-allowlist",
    title: t("commandAllowlist.title"),
    leading: <ListChecks aria-hidden="true" />,
    separatorBefore: true,
    onSelect: () => onManageCommandAllowlist?.(),
  };
  const items: PopoverMenuItem[] = [
    {
      // The question and its link are a band, not rows: they name the menu
      // without being pickable, and the link keeps working while every mode
      // below is unavailable.
      key: "approval-question",
      header: {
        title: t("approvalMode.question", { provider: providerName }),
        content: (
          <button
            type="button"
            onClick={() => void openExternalLink(APPROVAL_LEVELS_URL)}
            className="text-[12px] text-ink-secondary underline underline-offset-2 hover:text-ink"
          >
            {t("approvalMode.learnMore")}
          </button>
        ),
      },
    },
    ...visibleOptions.flatMap((option): PopoverMenuItem[] => {
      const selected = option.mode === mode;
      const Icon = option.Icon;
      const row: PopoverMenuItem = {
        key: option.mode,
        role: "menuitemradio",
        checked: selected,
        active: selected,
        title: option.label,
        content: option.description,
        // The descriptions are full sentences: two lines in a 340px menu,
        // so they wrap instead of clamping to one.
        lines: { content: -1 },
        leading: <Icon aria-hidden="true" />,
        trailing: selected ? <Check size={15} className="shrink-0" aria-hidden="true" /> : undefined,
        disabled: modesDisabled,
        hint: disabled
          ? t("approvalMode.busy")
          : requiresLocalDesktop
            ? t("approvalMode.customLocalOnly")
            : undefined,
        onSelect: () => onSelect(option.mode),
      };
      return option.mode === "full" && onManageCommandAllowlist ? [row, allowlistItem] : [row];
    }),
    ...(!visibleOptions.some((option) => option.mode === "full") && onManageCommandAllowlist ? [allowlistItem] : []),
    ...(notice
      ? [{
          key: "trusted-modes-notice",
          render: (
            <div className="border-t border-hairline/20 px-3 py-2.5 text-[11.5px] leading-snug text-ink-secondary">{notice}</div>
          ),
        } satisfies PopoverMenuItem]
      : []),
  ];
  return (
    <PopoverMenu
      items={items}
      ariaLabel={t("approvalMode.triggerAria", { mode: current.label, provider: providerName })}
      sheetAriaLabel={t("approvalMode.menuAria", { provider: providerName })}
      placement={menuDirection === "up" ? "above" : "below"}
      align={align === "right" ? "end" : "start"}
      width={340}
      zIndex={40}
      triggerDisabled={triggerDisabled}
      triggerTitle={disabled ? t("approvalMode.busy") : wide ? undefined : current.chip}
      triggerClassName={cn(
        wide
          ? "flex h-10 w-full items-center justify-between rounded-lg border border-hairline/40 bg-inset px-3.5 text-[13px] text-ink hover:bg-raised"
          : "flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-control hover:text-ink",
        triggerDisabled && "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-ink-secondary",
      )}
      trigger={() => (
        <>
          {wide ? (
            <span className="flex min-w-0 items-center gap-2">
              <CurrentIcon size={14} className="shrink-0 opacity-70" />
              <span className="truncate">{current.label}</span>
            </span>
          ) : (
            <CurrentIcon size={16} className="shrink-0 opacity-80" />
          )}
          {wide && <span aria-hidden className="text-[11px] text-ink-secondary">⌄</span>}
        </>
      )}
    />
  );
}
