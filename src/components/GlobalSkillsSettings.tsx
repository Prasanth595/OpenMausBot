import { BookOpen, SquareSlash, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { writtenSkillMd, writtenSkillProblem } from "../../shared/written-skill";
import { api } from "@/state/store";
import { inputCls } from "./bot-settings/field";
import { Switch } from "./SettingsPrimitives";

type Skill = { name: string; description: string; enabled: boolean; sha256: string; warnings: string[] };

export function GlobalSkillsSettings() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [source, setSource] = useState("");
  const [skillName, setSkillName] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillInstructions, setSkillInstructions] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");
  const [review, setReview] = useState<{ name: string; text: string } | null>(null);
  const refresh = async () => {
    const result = await api<{ skills: Skill[] }>("/api/global-skills");
    setSkills(result.skills);
  };
  useEffect(() => { void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load global skills.")); }, []);
  const addSource = async () => {
    if (!source.trim()) return;
    setWorking("import"); setError("");
    try { await api("/api/global-skills", { method: "POST", body: JSON.stringify({ source: source.trim() }) }); setSource(""); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not import the skill."); }
    finally { setWorking(""); }
  };
  const addCommand = async () => {
    const draft = { name: name.trim(), description, instructions };
    const problem = writtenSkillProblem(draft, skills.map((skill) => skill.name));
    if (problem) return;
    setWorking("command"); setError("");
    try { await api("/api/global-skills", { method: "POST", body: JSON.stringify({ text: writtenSkillMd(draft), enabled: true }) }); setName(""); setDescription(""); setInstructions(""); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the command."); }
    finally { setWorking(""); }
  };
  const addWrittenSkill = async () => {
    const draft = { name: skillName.trim(), description: skillDescription, instructions: skillInstructions };
    if (writtenSkillProblem(draft, skills.map((skill) => skill.name))) return;
    setWorking("skill"); setError("");
    try {
      await api("/api/global-skills", { method: "POST", body: JSON.stringify({ text: writtenSkillMd(draft), enabled: true }) });
      setSkillName(""); setSkillDescription(""); setSkillInstructions(""); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the skill."); }
    finally { setWorking(""); }
  };
  const problem = writtenSkillProblem({ name: name.trim(), description, instructions }, skills.map((skill) => skill.name));
  const skillProblem = writtenSkillProblem({ name: skillName.trim(), description: skillDescription, instructions: skillInstructions }, skills.map((skill) => skill.name));
  return <div className="flex flex-col gap-4 border-t border-hairline/40 pt-5">
    <div className="flex items-center gap-2"><BookOpen size={16} className="text-ink-secondary" /><div className="text-[15px] font-medium text-ink">Global skills</div></div>
    <p className="-mt-3 text-[12px] text-ink-secondary">Available to every bot, including new bots. Imported skills start disabled so you can review them first.</p>
    <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void addSource(); }}>
      <input className={inputCls} aria-label="Import global skill" placeholder="owner/repo or https://github.com/.../SKILL.md" value={source} onChange={(event) => setSource(event.target.value)} />
      <button type="submit" disabled={working === "import" || !source.trim()} className="ui-button disabled:opacity-50">Import</button>
    </form>
    <details>
      <summary className="cursor-pointer text-sm text-ink">Write a global skill</summary>
      <div className="mt-3 flex flex-col gap-2">
        <div className="flex gap-2"><input className={inputCls} aria-label="Global skill name" placeholder="Skill name" value={skillName} onChange={(event) => setSkillName(event.target.value.toLowerCase().replace(/\s+/g, "-"))} /><input className={inputCls} aria-label="Global skill description" placeholder="What the skill does" value={skillDescription} onChange={(event) => setSkillDescription(event.target.value)} /></div>
        <textarea className={`${inputCls} min-h-24 resize-y`} aria-label="Global skill instructions" placeholder="Write or paste the skill instructions here" value={skillInstructions} onChange={(event) => setSkillInstructions(event.target.value)} />
        <button type="button" disabled={Boolean(skillProblem) || Boolean(working)} onClick={() => void addWrittenSkill()} className="ui-button self-end disabled:opacity-50">Save global skill</button>
      </div>
    </details>
    {skills.length ? <div className="divide-y divide-hairline/40 overflow-hidden rounded-lg border border-hairline/40">{skills.map((skill) => <div key={skill.name} className="flex items-center gap-3 px-3 py-2.5"><div className="min-w-0 flex-1"><div className="font-mono text-[12.5px] text-ink">{skill.name}</div><div className="truncate text-[11.5px] text-ink-secondary">{skill.description}</div></div><button type="button" className="ui-button" onClick={() => { void api<{ text: string }>(`/api/global-skills/${skill.name}`).then(({ text }) => setReview({ name: skill.name, text })).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load the skill.")); }}>Review</button><Switch checked={skill.enabled} aria-label={`${skill.enabled ? "Disable" : "Enable"} ${skill.name}`} disabled={Boolean(working)} onClick={() => { setWorking(skill.name); void api(`/api/global-skills/${skill.name}`, { method: "PATCH", body: JSON.stringify({ enabled: !skill.enabled }) }).then(refresh).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not update the skill.")).finally(() => setWorking("")); }} /><button type="button" aria-label={`Remove ${skill.name}`} className="text-ink-secondary hover:text-danger" onClick={() => { if (!window.confirm(`Remove global skill “${skill.name}”?`)) return; setWorking(skill.name); void api(`/api/global-skills/${skill.name}`, { method: "DELETE", body: JSON.stringify({ sha256: skill.sha256 }) }).then(refresh).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not remove the skill.")).finally(() => setWorking("")); }}><Trash2 size={15} /></button></div>)}</div> : null}
    {review && <div className="rounded-lg border border-hairline/40 p-3"><div className="flex justify-between gap-2"><strong>Review {review.name}</strong><button type="button" onClick={() => setReview(null)}>Close</button></div>{skills.find((skill) => skill.name === review.name)?.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-danger">{warning}</p>)}<pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{review.text}</pre></div>}
    <div className="flex items-center gap-2 pt-1"><SquareSlash size={16} className="text-ink-secondary" /><div className="text-[15px] font-medium text-ink">Global command</div></div>
    <p className="-mt-3 text-[12px] text-ink-secondary">Create a slash command once and use it in any bot chat.</p>
    <div className="flex gap-2"><input className={inputCls} aria-label="Global command name" placeholder="/ name" value={name} onChange={(event) => setName(event.target.value.toLowerCase().replace(/\s+/g, "-"))} /><input className={inputCls} aria-label="Global command description" placeholder="What it does, in one line" value={description} onChange={(event) => setDescription(event.target.value)} /></div>
    <textarea className={`${inputCls} min-h-24 resize-y`} aria-label="Global command instructions" placeholder="What every bot should do. Use {input} for text after the command." value={instructions} onChange={(event) => setInstructions(event.target.value)} />
    <button type="button" disabled={Boolean(problem) || working === "command"} onClick={() => void addCommand()} className="ui-button self-end disabled:opacity-50">Save global command</button>
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
  </div>;
}
