/**
 * An image reader for models that cannot see.
 *
 * A turn carries an image as native input only when the engine supports it and
 * the model does. When it does not, the picture reaches the bot as a tag with a
 * path and nothing else, so a question about the photo goes unanswered. This
 * module lets one configured vision model read the picture first and hands the
 * bot its description as ordinary text.
 *
 * Off unless OMB_VISION_MODEL (and OMB_VISION_URL) are set: an unconfigured
 * install sends exactly what it sent before. Inference stays controlled — one
 * model, one endpoint, chosen by the operator — which is also why the heavy
 * reading is not pushed onto every bot's own model.
 */
import { readFileSync } from "node:fs";

import type { TurnImageInput } from "./contracts.ts";

export interface ImageReaderConfig {
  url: string;
  apiKey: string | undefined;
  model: string;
  /** Models that read images themselves; `*` stands for any model id. */
  capable: string[];
  prompt: string;
}

type FetchLike = typeof fetch;

export const DEFAULT_READER_PROMPT =
  "Describe this image for an agent that cannot see it: what it is, every readable text, numbers, and anything a person would point at. Answer in the language of the picture's text, or in Portuguese if it has none. No preamble.";

function list(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

/** Null unless a reader model and its endpoint are both configured. */
export function imageReaderConfig(env: NodeJS.ProcessEnv = process.env): ImageReaderConfig | null {
  const model = env.OMB_VISION_MODEL?.trim();
  const url = env.OMB_VISION_URL?.trim();
  if (!model || !url) return null;
  return {
    url,
    apiKey: env.OMB_VISION_KEY?.trim() || undefined,
    model,
    capable: list(env.OMB_VISION_CAPABLE),
    prompt: env.OMB_VISION_PROMPT?.trim() || DEFAULT_READER_PROMPT,
  };
}

/** Unset list means no model is known to see images, so the reader reads for all of them. */
export function modelReadsImages(config: ImageReaderConfig, model: string | undefined): boolean {
  if (!model) return false;
  return config.capable.some((entry) => entry === "*" || model === entry || (entry.endsWith("*") && model.startsWith(entry.slice(0, -1))));
}

async function describe(
  image: TurnImageInput,
  config: ImageReaderConfig,
  fetchImpl: FetchLike,
): Promise<string | null> {
  try {
    const data = readFileSync(image.path).toString("base64");
    const response = await fetchImpl(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 700,
        messages: [{ role: "user", content: [
          { type: "text", text: config.prompt },
          { type: "image_url", image_url: { url: `data:${image.mime};base64,${data}` } },
        ] }],
      }),
    });
    if (!response.ok) throw new Error(`reader answered ${response.status}`);
    const body = (await response.json()) as Record<string, unknown>;
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first && typeof first === "object" ? (first.message as Record<string, unknown> | undefined) : undefined;
    const text = message && typeof message.content === "string" ? message.content.trim() : "";
    return text || null;
  } catch (error) {
    console.warn(`image ${image.path} was not read: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** One description per image, in order; unreadable images are left out. */
export async function describeImages(
  images: readonly TurnImageInput[],
  config: ImageReaderConfig,
  fetchImpl: FetchLike = fetch,
): Promise<string[]> {
  const descriptions: string[] = [];
  for (const image of images) {
    const text = await describe(image, config, fetchImpl);
    if (text) descriptions.push(text);
  }
  return descriptions;
}

/** The block a turn gets instead of pixels; empty when nothing was read. */
export function readerBlock(descriptions: readonly string[]): string {
  if (!descriptions.length) return "";
  return [
    "The attached image(s) were read for you; here is what they show:",
    ...descriptions.map((description, index) => `${index + 1}. ${description}`),
  ].join("\n\n");
}
