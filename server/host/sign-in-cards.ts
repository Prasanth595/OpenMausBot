// A bot's sign-in cards as the person answers them: Done or Cancel on the card, or their own line in the conversation.
import { savedLoginResumePrompt } from "../../shared/logins.ts";
import { signInOutcome, signInResumePrompt, signInWaits } from "../../shared/sign-in-request.ts";
import type { Surface } from "../../shared/wire.ts";
import type { Audience } from "../audience.ts";
import type { ComputerControl } from "../computer-control.ts";
import type { Coordinator } from "../coordinator.ts";
import type { BotRecord, Message, Store } from "../store.ts";

export interface SignInCardDeps {
  store: Pick<Store, "activePath" | "bot" | "patchMessage">;
  computerControl: Pick<ComputerControl, "release" | "settleHelp">;
  browserLive: { handBack(session: string): void };
  coordinator: Pick<Coordinator, "parkedDirect">;
  teamHost: { browserAudience(threadId: string): Audience };
  currentBrowserSession(botId: string, profile: string | undefined, audience?: Audience): string;
  botComputerControlKey(bot: BotRecord): string;
  /** The card, in a room only the asking bot's own. */
  signInMessage(botId: string, threadId: string, messageId: string): Message | null;
  answerCardNode(threadId: string, messageId: string, text: string): boolean;
  resumableCards(threadId: string, since: number): Array<{ id: string; waits: string }>;
  releaseCardNode(threadId: string, messageId: string, reason: string): void;
}

export function createSignInCards(deps: SignInCardDeps) {
  const { store, computerControl, browserLive, coordinator, teamHost, currentBrowserSession, botComputerControlKey, signInMessage, answerCardNode,
    resumableCards, releaseCardNode } = deps;

  function settleSignIn(botId: string, threadId: string, messageId: string, outcome: "done" | "cancelled", saved?: { site: string }):
    { status: number; body: Record<string, unknown> } {
    const bot = store.bot(botId);
    const message = signInMessage(botId, threadId, messageId);
    if (!bot || !message?.signIn) return { status: 404, body: { error: "no such sign-in request" } };
    const card = message.signIn;
    if (card.superseded) return { status: 409, body: { error: "this sign-in request was superseded by a newer one" } };
    if (card.answeredInChat) return { status: 409, body: { error: "this sign-in request was already answered in the chat" } };
    const settled = signInOutcome(card);
    if (settled && settled !== outcome) {
      return { status: 409, body: { error: `this sign-in request was already ${settled === "done" ? "marked done" : "cancelled"}` } };
    }
    if (settled && card.resumed) return { status: 200, body: { [outcome]: true, resumed: true } };
    if (!settled) handSignInPlaceBack(bot, threadId, message.id, card.place);
    const savedLogin = saved?.site ?? card.savedLogin;
    const resumed = answerCardNode(threadId, message.id, savedLogin ? savedLoginResumePrompt(savedLogin) : signInResumePrompt(card.site, outcome));
    store.patchMessage(threadId, message.id, {
      signIn: { ...card, ...(outcome === "done" ? { done: true } : { cancelled: true }), ...(savedLogin ? { savedLogin } : {}), ...(resumed ? { resumed: true, error: undefined } : {}) },
    });
    return { status: 200, body: { [outcome]: true, resumed, ...(savedLogin ? { saved: true, site: savedLogin } : {}) } };
  }

  /** The person is through with the place the card lent them: its plea goes, and the browser or computer goes back to the bot. */
  function handSignInPlaceBack(bot: BotRecord, threadId: string, messageId: string, place: Surface): void {
    const pleaded = computerControl.settleHelp(messageId);
    if (place === "browser") browserLive.handBack(currentBrowserSession(bot.id, bot.browserProfile, teamHost.browserAudience(threadId)));
    else for (const key of pleaded.length ? pleaded : [botComputerControlKey(bot)]) computerControl.release(key);
  }

  /** The person's own line answers every sign-in request still open in their conversation, as Done would, and ends the
   * work parked on those cards: the turn the line starts goes on with the conversation, so nothing resumes it twice. */
  function answerSignInsInChat(botId: string, threadId: string): void {
    const bot = store.bot(botId);
    if (!bot) return;
    const answered: string[] = [];
    for (const message of store.activePath(threadId)) {
      const card = message.signIn;
      if (message.kind !== "signin" || !card || card.stopped || !signInWaits(card)) continue;
      handSignInPlaceBack(bot, threadId, message.id, card.place);
      store.patchMessage(threadId, message.id, { signIn: { ...card, answeredInChat: true, error: undefined } });
      answered.push(message.id);
    }
    const parked = coordinator.parkedDirect(threadId);
    const card = parked?.cards?.find((id) => answered.includes(id));
    if (!parked || !card || resumableCards(threadId, parked.startedAt ?? parked.createdAt).some((open) => parked.cards!.includes(open.id))) return;
    releaseCardNode(threadId, card, "The person answered in the chat");
  }

  return { settleSignIn, answerSignInsInChat };
}
