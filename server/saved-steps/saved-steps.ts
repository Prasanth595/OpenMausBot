import { createComputerJournalRoutes } from "../routes/computer-journal.ts";
import type { RouteHandler } from "../routes/table.ts";
import { ComputerJournal, hostScope, type JournalCapability } from "./journal.ts";

export { COMPUTER_JOURNAL_PATH } from "./journal-tap.ts";

export interface SavedStepsDeps { now?: () => number }

export interface SavedSteps {
  journal: ComputerJournal;
  gateChecked(capability: JournalCapability): void;
  journalRoutes(internal: { capability: JournalCapability; readBody(): Promise<unknown> }): RouteHandler;
}

export function createSavedSteps(_deps: SavedStepsDeps = {}): SavedSteps {
  const journal = new ComputerJournal();
  return {
    journal,
    gateChecked(capability) {
      const scope = hostScope(capability);
      if (scope) journal.gateChecked(scope);
    },
    journalRoutes: (internal) => createComputerJournalRoutes({ ...internal, record: (scope, entry) => journal.record(scope, entry) }),
  };
}
