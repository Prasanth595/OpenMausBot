export declare const DEFAULT_FOLDERS: readonly string[];
export interface PageLending {
  available: boolean;
  on: boolean;
  /** "lent", "busy", "starting", or why it isn't working (computer-sharing.mjs's problem codes). */
  status: string | null;
  folders: Array<{ name: string; write: boolean }>;
  screen: boolean;
  /** Whether computer control is set up here, so Apps and screen can be lent. */
  screenAvailable: boolean;
  /** Its internet connection, for the bots' browsers on My Cloud. */
  internet: boolean;
  /** Its Chrome, for the bots on My Cloud. */
  chrome: boolean;
  /** The terminal: bots run any command here as the person. */
  terminal: boolean;
  /** Whether My Cloud's browsing goes through it yet. */
  link?: "on" | "connecting" | "unsupported";
}
export function pageLending(snapshot: unknown): PageLending;
export interface LentFolder { id: string; path: string; name: string; write: boolean }
export function defaultGrant(input: { kept?: { folders?: LentFolder[]; screen?: boolean; internet?: boolean; chrome?: boolean }; usual: LentFolder[]; projects: LentFolder[]; screenAvailable?: boolean; screenReady?: boolean }): { folders: LentFolder[]; screen: boolean; internet: boolean; chrome: boolean };
export function existingFolders<T>(folders: unknown[], validate: (folders: unknown[]) => Promise<T[]>): Promise<T[]>;
/** A refusal the page says plainly, never with Try again: `lending-refused:<code>` in the IPC error's message. */
export declare const LENDING_REFUSED: string;
export function usualFolderPaths(getPath: (name: string) => string, home: string): Array<{ path: string; named: string }>;
export function usualFolders<T extends { path: string }>(entries: Array<string | { path: string; named: string | null }>, validate: (folders: Array<{ id: string; path: string; write: boolean }>) => Promise<T[]>): Promise<T[]>;
export function createLendingTarget<E extends { origin: string; cloud?: { id: string } }>(deps: {
  account: () => { state(): { status: string; message?: string; account?: { id: string } | null; machine?: { origin?: string } | null }; isOwnCloud?(origin: string): boolean } | null | undefined;
  environments: () => E[];
}): {
  /** The sign-in as `env`'s lending checks it: another Cloud of the person's own at its own address, else My Cloud. */
  cloud(env?: E | null): { status: string; accountId: string | null; origin: string | null } | null;
  environment(): E | null;
  /** Every saved place lending can go to: My Cloud first, then each other Cloud of the person's own the session lists. */
  places(): E[];
};
/** Which Cloud of the person's own a page's lending card is for, by the session's ids only ("home": My Cloud). */
export function createLendingPlaces<E extends { name: string; color?: string; cloud?: { id: string } }>(deps: {
  target: { places(): E[]; environment(): E | null };
  ownPage: (event: unknown) => { id: string } | null;
  local: (event: unknown) => boolean;
  store: { read(): { cloud?: string | null } | null; write(value: { cloud: string | null }): void };
}): {
  /** The saved place the asking page lends to; without an event, My Cloud's. */
  place(event?: unknown): E | null;
  list(): Array<{ id: string; name: string; color?: string }>;
  all(): E[];
  chosen(event: unknown): string;
  /** This computer's Settings lends to that Cloud from now on; an id the session doesn't list is refused. */
  choose(id: string): void;
};
export interface LendingNow extends PageLending {
  /** Computer control works here for this computer's own bots. */
  screenReady: boolean;
  /** The person turned lending off themselves. */
  ownOff: boolean;
}
/** Each method lends to `target`, a saved place (My Cloud's by default). */
export function installCloudLending(deps: Record<string, unknown>): {
  state(target?: unknown): Promise<LendingNow>;
  /** The default grant on top of what is lent; null when the person's own Off keeps it off (`asked` undoes it). */
  lendByDefault(input?: { projects?: string[]; asked?: boolean; target?: unknown }): Promise<PageLending | null>;
  /** Apps and screen on top of what is lent; null while lending is off or computer control does not work yet. */
  lendScreen(target?: unknown): Promise<PageLending | null>;
  /** The terminal on or off on top of what is lent; turning it on asks in main's own dialog first (`asked`: already). */
  lendTerminal(on: boolean, target?: unknown, options?: { asked?: boolean }): Promise<PageLending>;
  /** The tray's Terminal: for every Cloud this computer is lent to, asking once. */
  lendTerminalEverywhere(on: boolean): Promise<PageLending | null>;
};
