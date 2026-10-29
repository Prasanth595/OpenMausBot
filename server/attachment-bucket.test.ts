import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DATA_ROOT = mkdtempSync(join(tmpdir(), "omb-attachment-bucket-"));
process.env.OMB_DATA_DIR = join(DATA_ROOT, "data");

const {
  BUCKET_RECORDS_DIR,
  __resetBucketTokensForTests,
  archiveAttachment,
  archivedAttachment,
  attachmentBucketConfig,
  bucketObjectName,
  bucketReferenceBlock,
  signedObjectUrl,
} = await import("./attachment-bucket.ts");

const { mkdirSync } = await import("node:fs");

const PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const SA = JSON.stringify({ client_email: "anexos@example.iam.gserviceaccount.com", private_key: PRIVATE_KEY });
const ENV = { OMB_ATTACHMENTS_BUCKET: "bucket-test", OMB_ATTACHMENTS_SA_JSON: SA } as NodeJS.ProcessEnv;

function stored(name: string, contents = "bytes"): string {
  mkdirSync(join(DATA_ROOT, "data", "attachments"), { recursive: true });
  const path = join(DATA_ROOT, "data", "attachments", name);
  writeFileSync(path, contents);
  return path;
}

function fakeFetch(seen: Array<{ url: string; body: unknown }>) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, body: init?.body });
    if (url.includes("token")) return new Response(JSON.stringify({ access_token: "token-1", expires_in: 3600 }), { status: 200 });
    return new Response(JSON.stringify({ name: "ok" }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("attachmentBucketConfig", () => {
  it("is off with no bucket named", () => {
    expect(attachmentBucketConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("is off when credentials are missing or unusable", () => {
    expect(attachmentBucketConfig({ OMB_ATTACHMENTS_BUCKET: "b" } as NodeJS.ProcessEnv)).toBeNull();
    expect(attachmentBucketConfig({ OMB_ATTACHMENTS_BUCKET: "b", OMB_ATTACHMENTS_SA_JSON: "{oops" } as NodeJS.ProcessEnv)).toBeNull();
    expect(attachmentBucketConfig({ OMB_ATTACHMENTS_BUCKET: "b", GCP_SPEECH_SA_JSON: JSON.stringify({ client_email: "x@y" }) } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("reads the bucket, the prefix and the service account", () => {
    const config = attachmentBucketConfig(ENV)!;
    expect(config.bucket).toBe("bucket-test");
    expect(config.prefix).toBe("anexos");
    expect(config.credentials.client_email).toContain("anexos@");
    expect(attachmentBucketConfig({ ...ENV, OMB_ATTACHMENTS_BUCKET_PREFIX: "/clientes/x/" }).prefix).toBe("clientes/x");
  });
});

describe("bucketObjectName", () => {
  it("partitions by day so a year of files stays listable", () => {
    const at = Date.parse("2026-10-29T01:20:00Z");
    expect(bucketObjectName("anexos", "abc.png", at)).toBe("anexos/2026-10-29/abc.png");
    expect(bucketObjectName("", "abc.png", at)).toBe("2026-10-29/abc.png");
  });
});

describe("archiveAttachment", () => {
  it("uploads the committed file and remembers a fetchable URL", async () => {
    __resetBucketTokensForTests();
    const seen: Array<{ url: string; body: unknown }> = [];
    const path = stored("11111111-2222-4333-8444-555555555555.png", "pixels");
    const record = await archiveAttachment(path, { config: attachmentBucketConfig(ENV), fetchImpl: fakeFetch(seen), now: Date.parse("2026-10-29T01:20:00Z") });
    expect(record).toEqual({
      bucket: "bucket-test",
      object: "anexos/2026-10-29/11111111-2222-4333-8444-555555555555.png",
      url: "https://storage.googleapis.com/bucket-test/anexos/2026-10-29/11111111-2222-4333-8444-555555555555.png",
      at: Date.parse("2026-10-29T01:20:00Z"),
    });
    expect(seen[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(seen[1]!.url).toContain("/upload/storage/v1/b/bucket-test/o?uploadType=media&name=anexos%2F2026-10-29%2F");
    expect(archivedAttachment("11111111-2222-4333-8444-555555555555.png")?.object).toBe(record!.object);
    expect(BUCKET_RECORDS_DIR.endsWith("attachment-bucket")).toBe(true);
  });

  it("reuses one access token for the following files", async () => {
    __resetBucketTokensForTests();
    const seen: Array<{ url: string; body: unknown }> = [];
    const config = attachmentBucketConfig(ENV);
    const fetchImpl = fakeFetch(seen);
    await archiveAttachment(stored("aaaaaaaa-2222-4333-8444-555555555555.png"), { config, fetchImpl });
    await archiveAttachment(stored("bbbbbbbb-2222-4333-8444-555555555555.png"), { config, fetchImpl });
    expect(seen.filter((call) => call.url.includes("token"))).toHaveLength(1);
  });

  it("never fails the upload it already committed", async () => {
    const config = attachmentBucketConfig(ENV);
    const fetchImpl = (async (input: string | URL | Request) => String(input).includes("token")
      ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 })
      : new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const record = await archiveAttachment(stored("cccccccc-2222-4333-8444-555555555555.png"), { config, fetchImpl });
    expect(record).toBeNull();
    expect(archivedAttachment("cccccccc-2222-4333-8444-555555555555.png")).toBeNull();
  });
});

describe("bucketReferenceBlock", () => {
  it("turns an archived attachment tag into a URL the bot can fetch anywhere", async () => {
    __resetBucketTokensForTests();
    const path = stored("dddddddd-2222-4333-8444-555555555555.pdf");
    await archiveAttachment(path, { config: attachmentBucketConfig(ENV), fetchImpl: fakeFetch([]) });
    const block = bucketReferenceBlock(`olha o laudo\n\n<attached-file path="${path}" name="laudo.pdf" />`);
    expect(block).toContain("laudo.pdf: https://storage.googleapis.com/bucket-test/");
    expect(block.startsWith("Attachments also stored outside this machine")).toBe(true);
  });

  it("says nothing for a tag whose file was never archived", () => {
    expect(bucketReferenceBlock('<attached-image path="/nowhere/eeeeeeee-2222-4333-8444-555555555555.png" />')).toBe("");
    expect(bucketReferenceBlock("no attachments here")).toBe("");
  });
});

describe("signedObjectUrl", () => {
  it("carries the permission itself, so the bucket can stay private", () => {
    const config = attachmentBucketConfig(ENV)!;
    const url = new URL(signedObjectUrl(config, "anexos/2026-10-29/laudo do cliente.pdf", Date.parse("2026-10-29T01:20:00Z")));
    expect(url.origin + url.pathname).toBe("https://storage.googleapis.com/bucket-test/anexos/2026-10-29/laudo%20do%20cliente.pdf");
    expect(url.searchParams.get("X-Goog-Algorithm")).toBe("GOOG4-RSA-SHA256");
    expect(url.searchParams.get("X-Goog-Date")).toBe("20261029T012000Z");
    expect(url.searchParams.get("X-Goog-Expires")).toBe("604800");
    expect(url.searchParams.get("X-Goog-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Goog-Credential")).toBe("anexos@example.iam.gserviceaccount.com/20261029/auto/storage/goog4_request");
    expect(url.searchParams.get("X-Goog-Signature")).toMatch(/^[0-9a-f]{512}$/);
  });

  it("reaches the turn as the signed link, not the bare object URL", async () => {
    __resetBucketTokensForTests();
    const config = attachmentBucketConfig(ENV);
    const path = stored("ffffffff-2222-4333-8444-555555555555.png");
    await archiveAttachment(path, { config, fetchImpl: fakeFetch([]) });
    const block = bucketReferenceBlock(`<attached-image path="${path}" name="foto.png" />`, {
      config,
      now: Date.parse("2026-10-29T01:20:00Z"),
    });
    expect(block).toContain("foto.png: https://storage.googleapis.com/bucket-test/anexos/");
    expect(block).toContain("X-Goog-Signature=");
  });
});
