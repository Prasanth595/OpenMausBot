import { randomUUID } from "node:crypto";
import { botFolder } from "../bot-folder.ts";
import type { AppConfig } from "../config.ts";
import type { RuntimeEvent } from "../contracts.ts";
import { createComputerJournalRoutes } from "../routes/computer-journal.ts";
import { createSavedStepsRoutes } from "../routes/saved-steps.ts";
import type { RouteHandler } from "../routes/table.ts";
import type { Message } from "../store.ts";
import { openComputerCaller } from "./computer-client.ts";
import { SavedStepsDispatch, type EngineSlots } from "./dispatch.ts";
import { ComputerJournal, hostScope, type JournalCapability, type RequestJournal } from "./journal.ts";
import { buildRecipe, otherToolsHarmless, personTextRequest } from "./rules.ts";
import { RecipeStore } from "./store.ts";

export { COMPUTER_JOURNAL_PATH } from "./journal-tap.ts";

export interface SavedStepsDeps {
  enabled(): boolean;
  bot(id: string): unknown;
  publish(event: RuntimeEvent): void;
  engines: EngineSlots;
  stopped(threadId: string): boolean;
  generation(threadId: string): string | undefined;
  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): void;
  folder?: (botId: string) => string;
  now?: () => number;
}

export interface SettledRequest {
  botId: string;
  threadId: string;
  request: Message;
  reply: Message;
  after: readonly Message[];
  generations: ReadonlySet<string>;
  automated: boolean;
}

export interface SavedSteps {
  journal: ComputerJournal;
  recipes: RecipeStore;
  dispatch: SavedStepsDispatch;
  gateChecked(capability: JournalCapability): void;
  routes: RouteHandler;
  journalRoutes(internal: { capability: JournalCapability; readBody(): Promise<unknown> }): RouteHandler;
  requestSettled(settled: SettledRequest): void;
  requestEnded(threadId: string, generations: ReadonlySet<string>): void;
  observe(event: RuntimeEvent): void;
}

export function savedStepsEnabled(cfg: Pick<AppConfig, "features">): boolean {
  return cfg.features?.savedSteps !== false;
}

const keepsFromSaving = (event: RuntimeEvent): boolean =>
  (event.type === "request.resolved" && event.behavior !== "allow") || (event.type === "turn.completed" && (event.denials?.length ?? 0) > 0);

export function createSavedSteps(deps: SavedStepsDeps): SavedSteps {
  const journal = new ComputerJournal();
  const now = deps.now ?? Date.now;
  const recipes = new RecipeStore({ folder: deps.folder ?? botFolder, now: deps.now });
  const taint = (threadId: string): boolean => {
    const generation = deps.generation(threadId);
    if (generation === undefined) return false;
    journal.taint({ threadId, generation });
    return true;
  };
  const dispatch = new SavedStepsDispatch({
    recipes,
    enabled: deps.enabled,
    publish: deps.publish,
    engines: deps.engines,
    stopped: deps.stopped,
    openCaller: openComputerCaller,
    taint,
  });

  const markOrSave = ({ botId, threadId, request, reply, after, automated }: SettledRequest, taken: RequestJournal | null): void => {
    const replayed = reply.turnId === undefined ? undefined : dispatch.replayed(threadId, reply.turnId);
    if (replayed !== undefined) {
      recipes.touch(botId, replayed);
      if (request.quickModel !== undefined) deps.patchMessage(threadId, request.id, { quickModel: undefined });
      deps.patchMessage(threadId, reply.id, { savedSteps: { recipeId: replayed, replayed: true } });
      return;
    }
    if (!deps.enabled() || automated || !taken?.calls.length || !personTextRequest(request) || after.some((line) => line.role === "user") || !otherToolsHarmless(after)) return;
    const built = buildRecipe({ request: request.text ?? "", journal: taken, id: randomUUID(), now: now() });
    if (!built.ok) return;
    recipes.save(botId, built.recipe);
    deps.patchMessage(threadId, reply.id, { savedSteps: { recipeId: built.recipe.id, learned: true } });
  };

  return {
    journal,
    recipes,
    dispatch,
    routes: createSavedStepsRoutes({ bot: deps.bot, forget: (botId, id) => recipes.forget(botId, id) }),
    gateChecked(capability) {
      const scope = hostScope(capability);
      if (scope) journal.gateChecked(scope);
      else if (capability.kind === "computer") journal.taint({ threadId: capability.threadId, generation: capability.generation });
    },
    journalRoutes: (internal) => createComputerJournalRoutes({ ...internal, record: (scope, entry) => journal.record(scope, entry) }),
    requestSettled(settled) {
      const taken = journal.take(settled.threadId, settled.generations);
      const unmarked = dispatch.takeUnmarked(settled.threadId);
      try {
        markOrSave(settled, unmarked ? null : taken);
      } catch (error) {
        console.warn(`saved steps for ${settled.botId} on ${settled.threadId} not saved: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    requestEnded(threadId, generations) {
      journal.take(threadId, generations);
      dispatch.takeUnmarked(threadId);
    },
    observe(event) {
      if (keepsFromSaving(event)) taint(event.threadId);
    },
  };
}
