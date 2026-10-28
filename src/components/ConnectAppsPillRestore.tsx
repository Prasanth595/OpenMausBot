import { Puzzle } from "lucide-react";

import { cn } from "@/lib/cn";
import { restoreConnectAppsPill, useConnectAppsPillDismissed } from "@/lib/connect-apps-pill";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";

/** The way back from a dismissed sidebar pill: clears the saved flag and the sidebar listens for the change. Simple
 *  mode only: Advanced has no sidebar pill, so the control would restore a preference with nothing to show. */
export function ConnectAppsPillRestore({ className }: { className?: string }) {
  const dismissed = useConnectAppsPillDismissed();
  const advanced = useAdvancedMode();
  if (advanced || !dismissed) return null;
  return (
    <button
      type="button"
      data-show-connect-apps
      onClick={restoreConnectAppsPill}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium leading-5 text-ink-secondary transition-colors hover:bg-raised hover:text-ink", className)}
    >
      <Puzzle size={14} strokeWidth={1.5} aria-hidden="true" />
      {t("apps.showConnectApps")}
    </button>
  );
}
