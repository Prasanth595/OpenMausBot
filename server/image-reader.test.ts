import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_READER_PROMPT,
  describeImages,
  imageReaderConfig,
  modelReadsImages,
  readerBlock,
} from "./image-reader.ts";

const ROOT = mkdtempSync(join(tmpdir(), "omb-image-reader-"));
const IMAGE = join(ROOT, "aaaaaaaa-2222-4333-8444-555555555555.png");
writeFileSync(IMAGE, "pixels");
const TURN = { path: IMAGE, mime: "image/png", bytes: 6 } as const;

const ENV = { OMB_VISION_MODEL: "leitor", OMB_VISION_URL: "http://127.0.0.1:4000/v1/chat/completions" } as NodeJS.ProcessEnv;

describe("imageReaderConfig", () => {
  it("is off unless a reader model and its endpoint are set", () => {
    expect(imageReaderConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(imageReaderConfig({ OMB_VISION_MODEL: "leitor" } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("carries the model, the endpoint and the default prompt", () => {
    const config = imageReaderConfig(ENV)!;
    expect(config.model).toBe("leitor");
    expect(config.prompt).toBe(DEFAULT_READER_PROMPT);
    expect(config.apiKey).toBeUndefined();
    expect(imageReaderConfig({ ...ENV, OMB_VISION_KEY: "k" })!.apiKey).toBe("k");
  });
});

describe("modelReadsImages", () => {
  const config = (capable: string) => imageReaderConfig({ ...ENV, OMB_VISION_CAPABLE: capable })!;

  it("reads for every model when no model is known to see images", () => {
    expect(modelReadsImages(config(""), "openrouter/glm-5.3-flash")).toBe(false);
  });

  it("skips the models the operator lists, exactly or by prefix", () => {
    expect(modelReadsImages(config("openrouter/glm-5.3-flash"), "openrouter/glm-5.3-flash")).toBe(true);
    expect(modelReadsImages(config("openrouter/*"), "openrouter/glm-5.3-flash")).toBe(true);
    expect(modelReadsImages(config("*"), "anything")).toBe(true);
    expect(modelReadsImages(config("openrouter/*"), "gpu/qwen3-coder")).toBe(false);
  });
});

describe("describeImages", () => {
  it("asks the reader model for a description of each picture", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body) });
      return new Response(JSON.stringify({ choices: [{ message: { content: "  Um recibo de R$ 42,00.  " } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const config = imageReaderConfig(ENV)!;
    const descriptions = await describeImages([TURN], config, fetchImpl);
    expect(descriptions).toEqual(["Um recibo de R$ 42,00."]);
    expect(calls[0]!.url).toBe("http://127.0.0.1:4000/v1/chat/completions");
    expect(JSON.parse(calls[0]!.body).messages[0].content[1].image_url.url).toBe(`data:image/png;base64,${Buffer.from("pixels").toString("base64")}`);
  });

  it("keeps going when the reader fails, and sends the key when there is one", async () => {
    const headers: Array<Record<string, string>> = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      headers.push((init?.headers ?? {}) as Record<string, string>);
      return new Response("upstream broke", { status: 502 });
    }) as unknown as typeof fetch;
    const config = imageReaderConfig({ ...ENV, OMB_VISION_KEY: "chave" })!;
    expect(await describeImages([TURN], config, fetchImpl)).toEqual([]);
    expect(headers[0]!.authorization).toBe("Bearer chave");
  });
});

describe("readerBlock", () => {
  it("is empty when nothing was read, and numbered when something was", () => {
    expect(readerBlock([])).toBe("");
    expect(readerBlock(["Um gato laranja."])).toContain("1. Um gato laranja.");
    expect(readerBlock(["a", "b"])).toContain("2. b");
  });
});
