// What the call button and its mode menu start. Pressing a button here reads
// the rendered element tree and calls its handler; the calls themselves are
// observed through the call and Live media modules.
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ liveConfigured: true, liveCall: null as AppState["liveCall"], cloudHome: false }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: {
        ...original.initialState,
        liveCall: fixture.liveCall,
        config: {
          tts: { configured: true, ready: true, voice: "v" },
          live: { configured: fixture.liveConfigured, voice: "marin", readTypedReplies: true, idleMinutes: 5 },
          cloudHome: fixture.cloudHome,
        } as AppState["config"],
      },
      dispatch: vi.fn(),
    }),
  };
});
vi.mock("./DesktopCapabilities", () => ({
  // a Mac that can take turns
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: true, engine: "apple-speech", onDevice: true } }, ready: true }),
}));

import { CallTargetButton, callModeItems } from "./CallView";
import { setCallMode, type CallMode } from "@/lib/call-mode";
import { currentCall, endCall, startCall } from "@/lib/call";
import { configureLiveMedia, liveMedia, resetLiveMedia, startLiveCall } from "@/lib/live-call-media";

type ElementProps = { children?: ReactNode; onClick?: () => void; [key: string]: unknown };
function findElement(tree: ReactNode, match: (props: ElementProps) => boolean): ReactElement<ElementProps> | undefined {
  for (const child of Children.toArray(tree)) {
    if (!isValidElement<ElementProps>(child)) continue;
    if (match(child.props)) return child;
    const found = findElement(child.props.children, match);
    if (found) return found;
  }
}

const bot: Pick<Bot, "id" | "threadId" | "name"> = { id: "atlas", threadId: "thread-atlas", name: "Atlas" };
/** A phone's Live call with another bot: it holds the one Live line. */
const phoneCall: NonNullable<AppState["liveCall"]> = {
  callId: "c9", botId: "juniper", threadId: "t9", client: "ios", voice: "marin", startedAt: 0, status: "live",
};

/** The one-to-one call button's markup. */
function renderButton(): string {
  return renderToStaticMarkup(createElement(CallTargetButton, {
    targetId: bot.id, targetName: bot.name, threadId: bot.threadId, voices: ["v"],
    requireExplicitVoices: false, liveCapable: true, onStart: vi.fn(),
  }));
}

/** Render the one-to-one call button and press the phone. */
function pressPhone(onStart: (mode: CallMode) => void) {
  let tree: ReactNode = null;
  function Capture() {
    tree = CallTargetButton({
      targetId: bot.id, targetName: bot.name, threadId: bot.threadId, voices: ["v"],
      requireExplicitVoices: false, liveCapable: true, onStart,
    });
    return tree;
  }
  renderToStaticMarkup(createElement(Capture));
  const phone = findElement(tree, (props) => typeof props["aria-label"] === "string" && /Atlas/.test(props["aria-label"] as string));
  if (!phone) throw new Error("no phone button");
  phone.props.onClick?.();
}

beforeEach(() => {
  fixture.liveConfigured = true;
  fixture.liveCall = null;
  fixture.cloudHome = false;
  vi.stubGlobal("window", { ogb: { speechStart: vi.fn(), speechStop: vi.fn(async () => {}) } });
  // the microphone prompt never answers: a Live call stays "starting"
  configureLiveMedia({ getUserMedia: () => new Promise<MediaStream>(() => {}) });
});
afterEach(() => {
  setCallMode("turns");
  resetLiveMedia();
  endCall();
  vi.unstubAllGlobals();
});

describe("the call button", () => {
  it("starts a Live call through the Live media, not the take-turns overlay", () => {
    setCallMode("live");
    const onStart = vi.fn();
    pressPhone(onStart);
    expect(liveMedia()).toMatchObject({ phase: "starting", botId: "atlas", threadId: "thread-atlas" });
    expect(onStart).toHaveBeenCalledWith("live");
  });

  // The microphone comes first, even with no key: a page that can't have
  // one says so before anyone pastes a key. The harness's "no key" answer
  // (needsKey) then opens the key form.
  it("asks for the microphone before the key when Live has none", () => {
    fixture.liveConfigured = false;
    setCallMode("live");
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(() => {}));
    configureLiveMedia({ getUserMedia });
    const onStart = vi.fn();
    pressPhone(onStart);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(liveMedia()).toMatchObject({ phase: "starting", botId: "atlas", threadId: "thread-atlas" });
    expect(renderButton()).not.toContain("OpenAI API key");
    expect(onStart).toHaveBeenCalledWith("live");
  });

  it("hangs up this window's Live call", () => {
    setCallMode("live");
    void startLiveCall({ botId: "atlas", threadId: "thread-atlas" });
    pressPhone(vi.fn());
    // hung up before the harness knew the call: nothing to wait for
    expect(liveMedia().phase).toBe("idle");
    expect(currentCall()).toBeNull();
  });

  // Another device holds the one Live line: no Live call button at all (the
  // iPhone's rule), instead of one that can only be refused as busy.
  it("is not there in Live mode while another device holds the Live line, on any bot", () => {
    setCallMode("live");
    expect(renderButton()).toContain('aria-label="Live call with Atlas"');
    fixture.liveCall = phoneCall;
    expect(renderButton()).toBe("");
    fixture.liveCall = { ...phoneCall, status: "ended", endReason: "hung-up" };
    expect(renderButton()).toContain('aria-label="Live call with Atlas"');
  });

  // Take turns never uses the Live line, so a phone's Live call leaves it be.
  it("keeps Take turns while another device holds the Live line", () => {
    setCallMode("turns");
    fixture.liveCall = phoneCall;
    expect(renderButton()).toContain('aria-label="Call Atlas"');
    const onStart = vi.fn();
    pressPhone(onStart);
    expect(currentCall()).toBe("atlas");
    expect(liveMedia().phase).toBe("idle");
    expect(onStart).toHaveBeenCalledWith("turns");
    expect(renderButton()).toContain('aria-label="Hang up on Atlas"');
  });

  it("keeps a running Take-turns call's Hang up when a phone takes the Live line, in either mode", () => {
    startCall("atlas");
    fixture.liveCall = phoneCall;
    for (const mode of ["turns", "live"] as const) {
      setCallMode(mode);
      expect(renderButton()).toContain('aria-label="Hang up on Atlas"');
    }
  });

  // The desktop app decides whether a server's page may use the microphone,
  // so a block there says what the app answered, not what the server's own
  // config claims: the app allowed it (the computer blocked it), or refused.
  it("tells a blocked microphone on a server's page who blocked it, whatever the page's config says", async () => {
    for (const [pageMic, notice] of [
      ["allowed", "Allow microphone access for this app in your computer's privacy settings"],
      ["refused", "Open it in your web browser to make the Live call."],
    ] as const) {
      for (const cloudHome of [true, false]) {
        resetLiveMedia();
        fixture.cloudHome = cloudHome;
        configureLiveMedia({
          getUserMedia: async () => { throw new DOMException("denied", "NotAllowedError"); },
          capabilities: () => ({ dictation: { available: false, engine: "none", onDevice: false, reasonCode: "remote-server" } }) as DesktopCapabilities,
          pageMicrophone: async () => pageMic,
        });
        setCallMode("live");
        pressPhone(vi.fn());
        await vi.waitFor(() => expect(liveMedia().phase).toBe("failed"));
        expect(liveMedia().notice, `${pageMic} cloudHome=${cloudHome}`).toContain(notice);
      }
    }
  });

  it("keeps Take turns as it was: the overlay's call, no Live media", () => {
    setCallMode("turns");
    const onStart = vi.fn();
    pressPhone(onStart);
    expect(currentCall()).toBe("atlas");
    expect(liveMedia().phase).toBe("idle");
    expect(onStart).toHaveBeenCalledWith("turns");
  });
});

describe("the call mode menu", () => {
  it("offers both modes as radio items, the current one checked", () => {
    const items = callModeItems({ mode: "live", onChoose: vi.fn() });
    expect(items.map((item) => item.key)).toEqual(["turns", "live"]);
    expect(items[0]).toMatchObject({ role: "menuitemradio", checked: false });
    expect(items[0]!.title).toBe("Take turns");
    expect(items[1]).toMatchObject({ role: "menuitemradio", checked: true });
    expect(items[1]!.title).toBe("Live");
    // the hints are sentences: the content runs unclamped
    expect(items.map((item) => item.lines?.content)).toEqual([-1, -1]);
  });

  it("says where the OpenAI key stays: this computer, or the person's Cloud", () => {
    expect(String(callModeItems({ mode: "live", onChoose: vi.fn() })[1]!.content)).toContain("The OpenAI key stays on your computer.");
    const cloud = callModeItems({ mode: "live", cloudHome: true, onChoose: vi.fn() });
    expect(String(cloud[1]!.content)).toContain("The OpenAI key stays on My Cloud.");
    expect(String(cloud[1]!.content)).not.toContain("stays on your computer");
  });

  // Off the Mac's own page, Take turns stays in the menu so the person sees
  // it exists, but it can't be picked, and it says where it works.
  it("shows Take turns disabled with its reason where this page can't take turns", () => {
    const turnsUnavailable = {
      label: "Calls where you take turns need the Mac app",
      reason: "They listen with on-device speech recognition, which only the Mac app has.",
    };
    const [turns, live] = callModeItems({ mode: "live", turnsUnavailable, onChoose: vi.fn() });
    // aria-disabled, not disabled: the arrow keys still reach it and its reason
    expect(turns).toMatchObject({ role: "menuitemradio", checked: false, ariaDisabled: true });
    expect(turns!.disabled).toBeUndefined();
    expect(turns!.title).toBe("Take turns");
    expect(String(turns!.content)).toContain("Calls where you take turns need the Mac app. They listen with on-device speech recognition, which only the Mac app has.");
    expect(String(turns!.content)).not.toContain("Listening stays on this computer");
    expect(live).toMatchObject({ role: "menuitemradio", checked: true });
    expect(live!.ariaDisabled).toBeUndefined();
    // where it can take turns, both modes can be picked
    const here = callModeItems({ mode: "turns", onChoose: vi.fn() });
    expect(here.some((item) => item.ariaDisabled || item.disabled)).toBe(false);
    expect(here[0]).toMatchObject({ checked: true });
  });

  it("reports the chosen mode", () => {
    const onChoose = vi.fn();
    callModeItems({ mode: "live", onChoose })[0]!.onSelect!();
    expect(onChoose).toHaveBeenCalledWith("turns");
  });
});
