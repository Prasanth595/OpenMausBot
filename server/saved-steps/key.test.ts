import { describe, expect, it } from "vitest";
import { firstSentence, hasMomentWords, inRequest, requestKey } from "./key.ts";

describe("requestKey", () => {
  it("drops case, punctuation and filler words", () => {
    expect(requestKey("Hey, could you please open TextEdit and type hello world now!")).toBe("open textedit and type hello world");
    expect(requestKey("open textedit and type hello world")).toBe("open textedit and type hello world");
  });
  it("drops fillers only as whole words", () => expect(requestKey("Open Justin's notes")).toBe("open justin s notes"));
  it("normalises Unicode", () => expect(requestKey("Ｏｐｅｎ  Notes")).toBe("open notes"));
});

it("finds moment words as whole words", () => {
  expect(hasMomentWords("Send this to Ana")).toBe(true);
  expect(hasMomentWords("put it here")).toBe(true);
  expect(hasMomentWords("Open Thistle notes")).toBe(false);
});

it("matches typed text word for word, ignoring case", () => {
  expect(inRequest("Hello World", "type hello world please")).toBe(true);
  expect(inRequest("hello", "type helloworld")).toBe(false);
  expect(inRequest("a.b", "type a.b now")).toBe(true);
  expect(inRequest("hello world", "type hello, world")).toBe(false);
  expect(inRequest("  ", "anything")).toBe(false);
});

it("keeps the first sentence of a reply", () => {
  expect(firstSentence("Typed hello world into TextEdit. Nothing else changed.")).toBe("Typed hello world into TextEdit.");
  expect(firstSentence("   ")).toBeNull();
  expect(firstSentence("x ".repeat(400))!.length).toBeLessThanOrEqual(281);
});
