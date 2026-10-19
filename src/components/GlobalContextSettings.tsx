import { useEffect, useRef, useState } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { Card } from "./SettingsPrimitives";
import { GlobalSkillsSettings } from "./GlobalSkillsSettings";

const MAX_BYTES = 24_000;
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

type ContextResponse = {
  instructions: { text: string; updatedAt: number } | null;
  memory: { text: string; updatedAt: number } | null;
  maxBytes: number;
};

export function GlobalContextSettings() {
  const [instructions, setInstructions] = useState("");
  const [memory, setMemory] = useState("");
  const [saved, setSaved] = useState({ instructions: "", memory: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef({ instructions: "", memory: "" });

  useEffect(() => {
    let cancelled = false;
    void api<ContextResponse>("/api/global-context")
      .then((data) => {
        if (cancelled) return;
        const next = { instructions: data.instructions?.text ?? "", memory: data.memory?.text ?? "" };
        setInstructions(next.instructions);
        setMemory(next.memory);
        setSaved(next);
        latest.current = next;
      })
      .catch(() => { if (!cancelled) setError(t("settings.globalContext.loadError")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const changed = instructions !== saved.instructions || memory !== saved.memory;
  const tooLarge = byteLength(instructions) > MAX_BYTES || byteLength(memory) > MAX_BYTES;
  const save = async () => {
    const sent = latest.current;
    if ((sent.instructions === saved.instructions && sent.memory === saved.memory) || tooLarge || saving) return;
    setSaving(true);
    setError("");
    try {
      const data = await api<ContextResponse>("/api/global-context", {
        method: "PUT", body: JSON.stringify(sent),
      });
      const next = { instructions: data.instructions?.text ?? "", memory: data.memory?.text ?? "" };
      setSaved(next);
      if (latest.current.instructions === sent.instructions && latest.current.memory === sent.memory) {
        setInstructions(next.instructions);
        setMemory(next.memory);
        latest.current = next;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.globalContext.saveError"));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (loading || !changed || tooLarge) return;
    const timer = setTimeout(() => void save(), 600);
    return () => clearTimeout(timer);
  }, [instructions, memory, loading, saving, saved, changed, tooLarge]);

  const fieldClass = "min-h-[150px] w-full resize-y rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none";
  return (
    <Card title={t("settings.globalContext.title")} subtitle={t("settings.globalContext.subtitle")}>
      <div className="flex flex-col gap-5">
        <div>
          <label htmlFor="global-instructions" className="text-[14px] font-medium text-ink">{t("settings.globalContext.instructions")}</label>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("settings.globalContext.instructionsHint")}</p>
          <textarea id="global-instructions" value={instructions} disabled={loading} maxLength={MAX_BYTES}
            onChange={(event) => { latest.current = { ...latest.current, instructions: event.target.value }; setInstructions(event.target.value); }} onBlur={() => void save()} className={`${fieldClass} mt-2`} />
        </div>
        <div>
          <label htmlFor="global-memory" className="text-[14px] font-medium text-ink">{t("settings.globalContext.memory")}</label>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("settings.globalContext.memoryHint")}</p>
          <textarea id="global-memory" value={memory} disabled={loading} maxLength={MAX_BYTES}
            onChange={(event) => { latest.current = { ...latest.current, memory: event.target.value }; setMemory(event.target.value); }} onBlur={() => void save()} className={`${fieldClass} mt-2`} />
        </div>
        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("settings.globalContext.securityNote")}</p>
        {error ? <p role="alert" className="text-[12px] text-danger">{error}</p> : null}
        {tooLarge ? <p role="alert" className="text-[12px] text-danger">{t("settings.globalContext.tooLarge")}</p> : null}
        <p className="min-h-4 text-[12px]" role="status">
          {saving && <span className="text-ink-secondary">{t("settings.profile.saving")}</span>}
          {!saving && !changed && !loading && <span className="text-success">{t("settings.profile.saved")}</span>}
        </p>
        <GlobalSkillsSettings />
      </div>
    </Card>
  );
}
