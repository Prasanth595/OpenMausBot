// Bot replies speak from the assistant-text delta stream the server already
// broadcasts, instead of waiting for the completed message frame. Blocks close
// incrementally through the committed splitter (`/api/tts/prepare`, the voice
// path's first-block cap included) and the authoritative completed frame
// reconciles what was actually spoken.
//
// Streamed text can differ from completed text, so nothing may be spoken that
// the completed frame would redact. A block is only spoken once a later block
// exists, and every separator the splitter cuts on carries whitespace, while
// the credential shapes in shared/redact.ts are whitespace-free: masking the
// whole buffer before splitting keeps closed blocks within what the completed
// frame shows, and a credential prefix straddling chunk boundaries stays in
// the open tail. The one redaction shape that spans a separator is a
// private-key block (its body holds newlines), so an opener without its END
// holds the rest of the buffer back until the block closes or the
// authoritative frame lands.
import { redactSecretsInText } from "../../shared/redact";
import type { RuntimeEvent } from "../../shared/runtime-events";
import { speaker, type SpeechStream } from "@/lib/tts";

/** The bot whose reply may speak, when the store's speak gates pass. */
export interface SpokenReplyOwner {
  botId: string;
  voiceId?: string;
}

/** The Speaker surface this stream drives. */
export interface ReplySpeechSink {
  begin(opts: { botId?: string; voiceId?: string; messageId?: string }): SpeechStream;
}

function speakableStreamText(buffer: string): string {
  const redacted = redactSecretsInText(buffer);
  for (const match of redacted.matchAll(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g)) {
    const body = redacted.slice(match.index + match[0].length);
    if (!/-----END [A-Z ]*PRIVATE KEY-----/.test(body)) return redacted.slice(0, match.index);
  }
  return redacted;
}

interface TurnSpeech {
  threadId: string;
  turnId?: string;
  stream: SpeechStream;
  /** Concatenated assistant-text deltas of the burst since the last reset. */
  buffer: string;
  /** Blocks already pushed for this burst. */
  spoken: string[];
  /** Completed-frame text waiting to reconcile. */
  authoritative: string | null;
  pumping: boolean;
  dirty: boolean;
  ended: boolean;
}

const sameTurn = (turn: TurnSpeech, turnId: string | undefined): boolean =>
  turn.turnId === undefined || turnId === undefined || turn.turnId === turnId;

export class SpokenReplyStream {
  private readonly turns = new Map<string, TurnSpeech>();

  constructor(private readonly speech: ReplySpeechSink) {}

  onRuntimeEvent(event: RuntimeEvent, owner: SpokenReplyOwner | null): void {
    if (event.type === "turn.started") {
      const current = this.turns.get(event.threadId);
      if (current) this.drop(current);
      return;
    }
    if (event.type === "turn.completed") {
      this.finishTurn(event.threadId, event.turnId, event.ok);
      return;
    }
    if (event.type === "content.delta" && event.streamKind === "assistant_text" && owner) {
      this.appendDelta(event.threadId, event.turnId, event.delta, owner);
    }
  }

  /** The authoritative bot-text frame for a reply. `owner` null means the
   * store's speak gates fail now, and a live stream must go silent. */
  completeBotText(threadId: string, turnId: string | undefined, text: string, owner: SpokenReplyOwner | null, messageId?: string): void {
    const current = this.turns.get(threadId);
    if (current && sameTurn(current, turnId)) {
      if (!owner) {
        this.turns.delete(threadId);
        current.ended = true;
        current.stream.cancel();
        return;
      }
      current.stream.identify(messageId);
      current.authoritative = text;
      this.pump(current);
      return;
    }
    if (!owner || !text.trim()) return;
    const turn: TurnSpeech = {
      threadId,
      turnId,
      stream: this.speech.begin({ botId: owner.botId, voiceId: owner.voiceId, messageId }),
      buffer: "",
      spoken: [],
      authoritative: text,
      pumping: false,
      dirty: false,
      ended: false,
    };
    this.turns.set(threadId, turn);
    this.pump(turn);
    this.finishTurn(threadId, turnId, true);
  }

  private appendDelta(threadId: string, turnId: string | undefined, delta: string, owner: SpokenReplyOwner): void {
    const current = this.turns.get(threadId);
    if (current && sameTurn(current, turnId)) {
      current.buffer += delta;
      current.dirty = true;
      this.pump(current);
      return;
    }
    if (current) this.drop(current);
    const turn: TurnSpeech = {
      threadId,
      turnId,
      // begin stops whatever was speaking: a new turn's audio supersedes it.
      stream: this.speech.begin({ botId: owner.botId, voiceId: owner.voiceId }),
      buffer: delta,
      spoken: [],
      authoritative: null,
      pumping: false,
      dirty: true,
      ended: false,
    };
    this.turns.set(threadId, turn);
    this.pump(turn);
  }

  private drop(turn: TurnSpeech): void {
    if (this.turns.get(turn.threadId) !== turn) return;
    this.turns.delete(turn.threadId);
    turn.ended = true;
    void turn.stream.end();
  }

  private finishTurn(threadId: string, turnId: string | undefined, ok: boolean): void {
    const current = this.turns.get(threadId);
    if (!current || !sameTurn(current, turnId)) return;
    if (!ok) {
      this.turns.delete(threadId);
      current.ended = true;
      current.stream.cancel();
      return;
    }
    current.ended = true;
    this.pump(current);
  }

  /** One sequential loop per turn: prepares and pushes stay in arrival order. */
  private pump(turn: TurnSpeech): void {
    if (turn.pumping) {
      turn.dirty = true;
      return;
    }
    turn.pumping = true;
    void (async () => {
      try {
        for (;;) {
          if (turn.authoritative !== null) {
            const text = turn.authoritative;
            turn.authoritative = null;
            const blocks = await turn.stream.prepare(text);
            let resume = 0;
            while (resume < turn.spoken.length && resume < blocks.length && turn.spoken[resume] === blocks[resume]) resume += 1;
            // Re-speak from the first divergence: content the authoritative
            // frame holds is never dropped, and this matches what speaking the
            // completed frame alone would have said.
            for (const block of blocks.slice(resume)) turn.stream.push(block);
            turn.spoken = [];
            turn.buffer = "";
            continue;
          }
          if (turn.dirty && !turn.ended) {
            turn.dirty = false;
            const blocks = await turn.stream.prepare(speakableStreamText(turn.buffer));
            const closed = blocks.slice(0, -1);
            for (const block of closed.slice(turn.spoken.length)) turn.stream.push(block);
            turn.spoken = closed;
            continue;
          }
          break;
        }
      } catch (error) {
        if (this.turns.get(turn.threadId) === turn) this.turns.delete(turn.threadId);
        turn.stream.fail(error instanceof Error ? error.message : String(error));
        return;
      }
      turn.pumping = false;
      if (turn.ended && this.turns.get(turn.threadId) === turn) {
        this.turns.delete(turn.threadId);
        void turn.stream.end();
      }
    })();
  }
}

export const spokenReplyStream = new SpokenReplyStream(speaker);
