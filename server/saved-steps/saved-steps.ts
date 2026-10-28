import { botFolder } from "../bot-folder.ts";
import type { AppConfig } from "../config.ts";
import type { RuntimeEvent } from "../contracts.ts";
import { createComputerJournalRoutes } from "../routes/computer-journal.ts";
import type { RouteHandler } from "../routes/table.ts";
import { openComputerCaller } from "./computer-client.ts";
import { SavedStepsDispatch, type EngineSlots } from "./dispatch.ts";
import { ComputerJournal, hostScope, type JournalCapability } from "./journal.ts";
import { RecipeStore } from "./store.ts";

export { COMPUTER_JOURNAL_PATH } from "./journal-tap.ts";

export interface SavedStepsDeps {
  enabled(): boolean;
  publish(event: RuntimeEvent): void;
  engines: EngineSlots;
  stopped(threadId: string): boolean;
  generation(threadId: string): string | undefined;
  folder?: (botId: string) => string;
  now?: () => number;
}

export interface SavedSteps {
  journal: ComputerJournal;
  recipes: RecipeStore;
  dispatch: SavedStepsDispatch;
  gateChecked(capability: JournalCapability): void;
  journalRoutes(internal: { capability: JournalCapability; readBody(): Promise<unknown> }): RouteHandler;
}

export function savedStepsEnabled(cfg: Pick<AppConfig, "features">): boolean {
  return cfg.features?.savedSteps !== false;
}

export function createSavedSteps(deps: SavedStepsDeps): SavedSteps {
  const journal = new ComputerJournal();
  const recipes = new RecipeStore({ folder: deps.folder ?? botFolder, now: deps.now });
  const dispatch = new SavedStepsDispatch({
    recipes,
    enabled: deps.enabled,
    publish: deps.publish,
    engines: deps.engines,
    stopped: deps.stopped,
    openCaller: openComputerCaller,
    taint: (threadId) => {
      const generation = deps.generation(threadId);
      if (generation === undefined) return false;
      journal.taint({ threadId, generation });
      return true;
    },
  });
  return {
    journal,
    recipes,
    dispatch,
    gateChecked(capability) {
      const scope = hostScope(capability);
      if (scope) journal.gateChecked(scope);
    },
    journalRoutes: (internal) => createComputerJournalRoutes({ ...internal, record: (scope, entry) => journal.record(scope, entry) }),
  };
}
