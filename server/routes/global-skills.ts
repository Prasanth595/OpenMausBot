import { z } from "zod";
import { createHash } from "node:crypto";

import { SKILL_FILE_MAX_BYTES } from "../../shared/skill-md.ts";
import { fetchSkillFromSource } from "../skill-fetch.ts";
import { installLibrarySkill, listLibrarySkills, readLibrarySkillFile, setLibrarySkillGlobal, setLibrarySkillReviewState } from "../skill-library.ts";
import { listSkills, parseSkillMd, scanSkillText } from "../skills.ts";
import type { Store } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createGlobalSkillsRoutes({ store }: { store: Store }): RouteHandler {
  const conflict = (name: string) => store.bots.find((bot) => listSkills(bot.id).some((skill) => skill.name === name));
  return async ({ req, res, path, method, json, readBody }) => {
    if (path === "/api/global-skills" && method === "GET") {
      return json(res, 200, { skills: listLibrarySkills().filter((skill) => skill.global) });
    }
    if (path === "/api/global-skills" && method === "POST") {
      const body = z.object({ source: z.string().min(1).max(2000).optional(), text: z.string().min(1).max(262_144).optional(), enabled: z.boolean().optional() })
        .refine((value) => Boolean(value.source) !== Boolean(value.text), "provide one skill source or SKILL.md").safeParse(await readBody(req));
      if (!body.success) return json(res, 400, { error: body.error.message });
      const fetched = body.data.text
        ? { skills: [{ source: "global settings", files: [{ path: "SKILL.md", content: body.data.text }] }] }
        : await fetchSkillFromSource(body.data.source!);
      if ("error" in fetched) return json(res, 422, { error: fetched.error });
      const candidates = fetched.skills;
      const prepared = [];
      const names = new Map(listLibrarySkills().map((skill) => [skill.name, skill.sha256]));
      for (const candidate of candidates) {
        const file = candidate.files.find((entry) => entry.path === "SKILL.md" || entry.path.endsWith("/SKILL.md"));
        if (!file) return json(res, 422, { error: "no SKILL.md found at that location" });
        if (candidate.files.length > 1) return json(res, 422, { error: "This skill includes supporting files; global skills currently support only a standalone SKILL.md." });
        const parsed = parseSkillMd(file.content);
        if ("error" in parsed) return json(res, 422, { error: parsed.error });
        const existing = conflict(parsed.name);
        if (existing) return json(res, 409, { error: `/${parsed.name} is already private to ${existing.name}; choose another name first` });
        if (Buffer.byteLength(file.content, "utf8") > SKILL_FILE_MAX_BYTES) return json(res, 422, { error: `SKILL.md is larger than ${SKILL_FILE_MAX_BYTES / 1024}KB` });
        const hash = createHash("sha256").update(file.content).digest("hex");
        if (names.has(parsed.name) && names.get(parsed.name) !== hash) return json(res, 422, { error: `a skill named "${parsed.name}" is already in the library — choose a different name` });
        names.set(parsed.name, hash);
        prepared.push({ candidate, file, parsed });
      }
      const installed = [];
      const importError = (message: string) => installed.length ? `${message} Some skills were already imported; check the list.` : message;
      for (const { candidate, file, parsed } of prepared) {
        try {
          const result = installLibrarySkill({ name: parsed.name, instructions: file.content, source: candidate.source, warnings: scanSkillText(file.content), reviewState: body.data.text && body.data.enabled ? "approved" : "disabled" });
          if ("error" in result) return json(res, 422, { error: importError(result.error) });
          const shared = setLibrarySkillGlobal(parsed.name, true);
          if ("error" in shared) return json(res, 422, { error: importError(shared.error) });
          installed.push(shared);
        } catch {
          return json(res, 500, { error: "Could not finish importing skills. Some skills may have been imported; check the list." });
        }
      }
      return json(res, 201, { skills: installed });
    }
    const match = path.match(/^\/api\/global-skills\/([a-z0-9-]+)$/);
    if (!match) return PASS;
    const name = match[1]!;
    const skill = listLibrarySkills().find((entry) => entry.name === name && entry.global);
    if (!skill) return json(res, 404, { error: "no such global skill" });
    if (method === "GET") {
      const text = readLibrarySkillFile(name);
      return text === null ? json(res, 404, { error: "no such global skill" }) : json(res, 200, { text });
    }
    if (method === "PATCH") {
      const body = z.object({ enabled: z.boolean() }).safeParse(await readBody(req));
      if (!body.success) return json(res, 400, { error: body.error.message });
      const result = setLibrarySkillReviewState(name, body.data.enabled ? "approved" : "disabled");
      if ("error" in result) return json(res, 422, { error: result.error });
      return json(res, 200, { skill: listLibrarySkills().find((skill) => skill.name === name) });
    }
    if (method === "DELETE") {
      const body = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(await readBody(req));
      if (!body.success) return json(res, 400, { error: body.error.message });
      if (skill.sha256 !== body.data.sha256) return json(res, 409, { error: "skill changed; refresh and try again" });
      const result = setLibrarySkillGlobal(name, false);
      if ("error" in result) return json(res, 404, { error: result.error });
      return json(res, 200, { ok: true });
    }
    return PASS;
  };
}
