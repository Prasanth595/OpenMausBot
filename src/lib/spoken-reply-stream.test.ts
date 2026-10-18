import { describe, expect, it } from "vitest";
import { redactSecretsInText } from "../../shared/redact";
import type { RuntimeEvent } from "../../shared/runtime-events";
import type { ReplySpeechSink, SpokenReplyOwner } from "./spoken-reply-stream";
import { SpokenReplyStream } from "./spoken-reply-stream";

interface FakeHandle {
  opts: { botId?: string; voiceId?: string; messageId?: string };
  pushes: string[];
  inputs: string[];
  ends: number;
  failure: string | null;
}

/** Mirrors the committed splitter's contract: the whole text is redacted
 * first, blocks close at sentence separators, and the trailing piece stays
 * open until a later block exists. */
function fakeSpeech(prepareOverride?: (text: string) => string[]) {
  const handles: FakeHandle[] = [];
  let stops = 0;
  const sink: ReplySpeechSink = {
    begin(opts) {
      const handle: FakeHandle = { opts, pushes: [], inputs: [], ends: 0, failure: null };
      handles.push(handle);
      const split = prepareOverride ?? ((text: string) => redactSecretsInText(text).split(/(?<=[.!?])\s+/).filter(Boolean));
      return {
        push: (block) => {
          handle.pushes.push(block);
        },
        end: async () => {
          handle.ends += 1;
        },
        prepare: async (text) => {
          handle.inputs.push(text);
          return split(text);
        },
        fail: (error) => {
          handle.failure = error;
        },
      };
    },
    stop: () => {
      stops += 1;
    },
  };
  return { sink, handles, stops: () => stops };
}

const owner: SpokenReplyOwner = { botId: "bot", voiceId: "vo" };
const base = { provider: "claude", threadId: "t", turnId: "turn-1", createdAt: "2026-10-17T12:00:00Z" };
const delta = (text: string, turnId = "turn-1"): RuntimeEvent =>
  ({ ...base, eventId: `${turnId}-d`, type: "content.delta", streamKind: "assistant_text", delta: text });
const turnDone = (ok: boolean, turnId = "turn-1"): RuntimeEvent => ({ ...base, eventId: `${turnId}-c`, type: "turn.completed", ok });
const turnStart = (turnId: string): RuntimeEvent => ({ ...base, eventId: `${turnId}-s`, type: "turn.started" });
const toolStart = (turnId = "turn-1"): RuntimeEvent => ({ ...base, eventId: `${turnId}-i`, type: "item.started", itemType: "tool" });
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

describe("SpokenReplyStream", () => {
  it("pushes the first closed block before the completed message frame arrives", async () => {
    const { sink, handles } = fakeSpeech();
    const stream = new SpokenReplyStream(sink);
    stream.onRuntimeEvent(delta("One two. Three "), owner);
    await settle();
    expect(handles).toHaveLength(1);
    expect(handles[0].pushes).toEqual(["One two."]);
    expect(handles[0].ends).toBe(0);
  });

  it("speaks each block exactly once and ends once the turn completes", async () => {
    const { sink, handles } = fakeSpeech();
    const stream = new SpokenReplyStream(sink);
    stream.onRuntimeEvent(delta("One two. Three four. Five "), owner);
    await settle();
    expect(handles[0].pushes).toEqual(["One two.", "Three four."]);
    stream.completeBotText("t", "turn-1", "One two. Three four. Five six.", owner, "m1");
    stream.onRuntimeEvent(turnDone(true), owner);
    await settle();
    expect(handles[0].pushes).toEqual(["One two.", "Three four.", "Five six."]);
    expect(handles[0].ends).toBe(1);
  });

  it("never speaks a credential that straddles delta chunk boundaries", async () => {
    const { sink, handles } = fakeSpeech();
    const stream = new SpokenReplyStream(sink);
    const secret = "sk-ant-api03-" + "A".repeat(30);
    stream.onRuntimeEvent(delta(`First sentence. The key sk-`), owner);
    await settle();
    stream.onRuntimeEvent(delta(`ant-api03-${"A".repeat(30)} is done. Last words. `), owner);
    await settle();
    const noPrefixAnywhere = (spoken: string) => {
      for (let n = 2; n <= secret.length; n += 1) expect(spoken).not.toContain(secret.slice(0, n));
    };
    noPrefixAnywhere(handles[0].pushes.join(" "));
    stream.completeBotText("t", "turn-1", `First sentence. The key ${secret} is done. Last words.`, owner);
    stream.onRuntimeEvent(turnDone(true), owner);
    await settle();
    const spoken = handles[0].pushes.join(" ");
    noPrefixAnywhere(spoken);
    expect(spoken).toContain("«redacted");
    expect(handles[0].pushes).toEqual([
      "First sentence.",
      `The key ${redactSecretsInText(secret)} is done.`,
      "Last words.",
    ]);
  });

  it("goes silent when the speak gates close at the completed frame", async () => {
    const { sink, handles, stops } = fakeSpeech();
    const stream = new SpokenReplyStream(sink);
    stream.onRuntimeEvent(delta("One. Two. Three "), owner);
    await settle();
    expect(handles[0].pushes.length).toBeGreaterThan(0);
    stream.completeBotText("t", "turn-1", "One. Two. Three four.", null);
    stream.onRuntimeEvent(turnDone(true), null);
    await settle();
    expect(stops()).toBe(1);
    expect(handles[0].pushes).toEqual(["One.", "Two."]);
    expect(handles[0].ends).toBe(0);
    expect(handles).toHaveLength(1);
  });

  it("speaks the completed text outright when no deltas arrived", async () => {
    const { sink, handles } = fakeSpeech();
    const stream = new SpokenReplyStream(sink);
    stream.completeBotText("t", "turn-1", "One. Two.", owner, "msg-1");
    await settle();
    expect(handles).toHaveLength(1);
    expect(handles[0].opts).toEqual({ botId: "bot", voiceId: "vo", messageId: "msg-1" });
    expect(handles[0].pushes).toEqual(["One.", "Two."]);
    expect(handles[0].ends).toBe(1);
    expect(handles[0].inputs).toEqual(["One. Two."]);
  });

  it("stops speech when the turn fails", async () => {
    const { sink, handles, stops } = fakeSpeech();
    const stream = new SpokenReplyStream(sink);
    stream.onRuntimeEvent(delta("One. Two. Three "), owner);
    await settle();
    stream.onRuntimeEvent(turnDone(false), owner);
    await settle();
    expect(stops()).toBe(1);
    expect(handles[0].pushes).toEqual(["One.", "Two."]);
    expect(handles[0].ends).toBe(0);
  });

  it("holds back an unclosed private-key block until it closes", async () => {
    const { sink, handles } = fakeSpeech();
    const stream = new SpokenReplyStream(sink);
    stream.onRuntimeEvent(delta("Safe intro. Also safe. -----BEGIN OPENSSH PRIVATE KEY-----\nAAAAB3Nza"), owner);
    await settle();
    expect(handles[0].pushes).toEqual(["Safe intro."]);
    stream.onRuntimeEvent(delta("C1lY2E=\n-----END OPENSSH PRIVATE KEY----- tail. "), owner);
    await settle();
    expect(handles[0].pushes).toEqual(["Safe intro.", "Also safe."]);
    stream.completeBotText(
      "t",
      "turn-1",
      "Safe intro. Also safe. -----BEGIN OPENSSH PRIVATE KEY-----\nAAAAB3NzaC1lY2E=\n-----END OPENSSH PRIVATE KEY----- tail.",
      owner,
    );
    stream.onRuntimeEvent(turnDone(true), owner);
    await settle();
    const pemBlock = handles[0].pushes[2];
    expect(pemBlock).toContain("«redacted");
    expect(pemBlock).not.toContain("AAAAB3Nza");
  });

  it("speaks each item's text once across tool narration within one turn", async () => {
    const { sink, handles } = fakeSpeech();
    const stream = new SpokenReplyStream(sink);
    stream.onRuntimeEvent(delta("Before the tool. More. "), owner);
    await settle();
    stream.completeBotText("t", "turn-1", "Before the tool. More.", owner, "m1");
    await settle();
    stream.onRuntimeEvent(toolStart(), owner);
    stream.onRuntimeEvent(delta("After the tool. Wrap up. "), owner);
    await settle();
    stream.completeBotText("t", "turn-1", "After the tool. Wrap up.", owner, "m2");
    stream.onRuntimeEvent(turnDone(true), owner);
    await settle();
    expect(handles).toHaveLength(1);
    expect(handles[0].pushes).toEqual(["Before the tool.", "More.", "After the tool.", "Wrap up."]);
    expect(handles[0].ends).toBe(1);
  });

  it("fails the stream when the splitter rejects", async () => {
    const { sink, handles } = fakeSpeech(() => {
      throw new Error("splitter down");
    });
    const stream = new SpokenReplyStream(sink);
    stream.onRuntimeEvent(delta("One. Two. "), owner);
    await settle();
    expect(handles).toHaveLength(1);
    expect(handles[0].failure).toBe("splitter down");
    expect(handles[0].ends).toBe(0);
  });

  it("ends the open stream when a new turn starts", async () => {
    const { sink, handles } = fakeSpeech();
    const stream = new SpokenReplyStream(sink);
    stream.onRuntimeEvent(delta("One. Two. Three "), owner);
    await settle();
    stream.onRuntimeEvent(turnStart("turn-2"), owner);
    await settle();
    expect(handles[0].ends).toBe(1);
    stream.onRuntimeEvent(delta("Fresh. ", "turn-2"), owner);
    await settle();
    expect(handles).toHaveLength(2);
    expect(handles[1].pushes).toEqual([]);
  });
});
