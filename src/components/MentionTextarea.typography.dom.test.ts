// @vitest-environment happy-dom
// The mirror draws the glyphs while the textarea owns the caret. They must share one set of metrics, or the caret and
// the text separate. Simple mode sizes its composer away from the stylesheet; Advanced leaves both as they were.
import { createElement, createRef, type RefObject } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MentionTextarea } from "./MentionTextarea";

let host: HTMLDivElement;
let root: Root;
let inputRef: RefObject<HTMLTextAreaElement | null>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  inputRef = createRef<HTMLTextAreaElement>();
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    fontSize: "14px",
    lineHeight: "20px",
    padding: "4px 2px",
  } as CSSStyleDeclaration);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const render = (matchInputStyle: boolean) => createElement(MentionTextarea, {
  inputRef,
  peers: [],
  value: "a wrapped message that would drift",
  readOnly: true,
  matchInputStyle,
  onChange: () => {},
});

const mirror = () => host.querySelector<HTMLElement>(".mention-editor-mirror")!;

describe("the mention mirror's typography", () => {
  it("takes the textarea's font size, line height and padding, so the caret sits on the glyphs", () => {
    flushSync(() => root.render(render(true)));
    expect(mirror().style.fontSize).toBe("14px");
    expect(mirror().style.lineHeight).toBe("20px");
    expect(mirror().style.padding).toBe("4px 2px");
  });

  it("goes back to the stylesheet's metrics when Advanced mode turns the matching off", () => {
    flushSync(() => root.render(render(true)));
    expect(mirror().style.fontSize).toBe("14px");
    flushSync(() => root.render(render(false)));
    expect(mirror().style.fontSize).toBe("");
    expect(mirror().style.lineHeight).toBe("");
    expect(mirror().style.padding).toBe("");
  });
});
