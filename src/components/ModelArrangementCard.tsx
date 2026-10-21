import type { InstanceInfo, ModelSelection } from "@/state/store";
import { modelArrangement } from "@/lib/model-arrangement";
import { t } from "@/lib/i18n";

export function ModelArrangementCard({ instance, selection, endpointUrl, changing = false }: {
  instance?: InstanceInfo;
  selection: ModelSelection;
  endpointUrl?: string;
  changing?: boolean;
}) {
  const arrangement = modelArrangement(instance, selection, endpointUrl);
  const location = t(`model.arrangement.${arrangement.location}`);
  const supported = [
    instance?.capabilities?.agentsMcp || instance?.capabilities?.composioMcp ? t("model.arrangement.mcp") : null,
    instance?.capabilities?.browserMcp ? t("model.arrangement.browser") : null,
    instance?.capabilities?.computerMcp || instance?.capabilities?.localComputerMcp ? t("model.arrangement.computer") : null,
  ].filter((item): item is string => item !== null);
  return (
    <div data-model-arrangement className="rounded-xl border border-hairline/50 bg-inset/50 px-3 py-2.5 text-[12px] text-ink-secondary">
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <span>{t("model.arrangement.agent")}</span><strong className="min-w-0 truncate font-medium text-ink">{arrangement.agent}</strong>
        <span>{t("model.arrangement.model")}</span><strong className="min-w-0 truncate font-medium text-ink">{arrangement.model ?? t("model.arrangement.unknownModel")}</strong>
        <span>{t("model.arrangement.via")}</span><span className="min-w-0 truncate text-ink" title={arrangement.route ?? undefined}>{arrangement.route ?? t("model.arrangement.unknownRoute")}</span>
        <span>{t("model.arrangement.inference")}</span><span className="text-ink">{location}</span>
      </div>
      {!arrangement.model && <p className="mt-2">{t("model.arrangement.modelSetIn", { place: arrangement.modelControlledBy })}</p>}
      <details className="mt-2 border-t border-hairline/40 pt-2">
        <summary className="cursor-pointer font-medium text-ink">{t("model.arrangement.details")}</summary>
        <div className="mt-2 space-y-1.5 leading-relaxed">
          <p>{t(arrangement.direct ? "model.arrangement.directBehavior" : "model.arrangement.runtimeBehavior", { agent: arrangement.agent })}</p>
          <p>{t(arrangement.direct ? "model.arrangement.directConfig" : "model.arrangement.runtimeConfig", { agent: arrangement.agent })}</p>
          {supported.length > 0 && <p>{t("model.arrangement.supported", { features: supported.join(", ") })}</p>}
          <p>{t(arrangement.direct ? "model.arrangement.directPermission" : "model.arrangement.runtimePermission", { agent: arrangement.agent })}</p>
        </div>
      </details>
      {changing && <p data-model-switch-note className="mt-2 border-t border-hairline/40 pt-2 leading-relaxed">
        {t("model.arrangement.switchNote")}
      </p>}
    </div>
  );
}
