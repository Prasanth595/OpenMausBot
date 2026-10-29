import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { ATTACHMENT_LINK_DIR, linkTurnAttachments } from "./attachment-workspace.ts";

const suite = mkdtempSync(join(tmpdir(), "omb-attachment-workspace-"));
const attachmentsDir = join(suite, "attachments");
const workspace = join(suite, "workspaces", "bot-1");
const outside = join(suite, "outside");
mkdirSync(attachmentsDir, { recursive: true });
mkdirSync(outside, { recursive: true });

afterAll(() => rmSync(suite, { recursive: true, force: true }));

const upload = (name: string, body = "pagina 1: regras do piv\u00f4"): string => {
  const path = join(attachmentsDir, name);
  writeFileSync(path, body);
  return path;
};

describe("linkTurnAttachments", () => {
  it("points a stored upload at the bot's own workspace and keeps the rest of the message", () => {
    const stored = upload("11111111-1111-4111-8111-111111111111.pdf");
    const text = `L\u00ea o PDF.\n\n<attached-file path="${stored}" name="Pivots Camarilla.pdf" />`;

    const result = linkTurnAttachments(text, { workspace, attachmentsDir });

    const expected = join(workspace, ATTACHMENT_LINK_DIR, "11111111-1111-4111-8111-111111111111.pdf");
    expect(result.text).toBe(`L\u00ea o PDF.\n\n<attached-file path="${expected}" name="Pivots Camarilla.pdf" />`);
    expect(result.linked).toEqual([{ from: stored, path: expected }]);
    expect(readFileSync(expected, "utf8")).toBe("pagina 1: regras do piv\u00f4");
  });

  it("shares the store's bytes, so the end-of-turn purge does not take the copy with it", () => {
    const stored = upload("22222222-2222-4222-8222-222222222222.pdf", "conteudo que sobrevive");
    const { text } = linkTurnAttachments(`<attached-file path="${stored}" name="a.pdf" />`, { workspace, attachmentsDir });
    const mirror = join(workspace, ATTACHMENT_LINK_DIR, "22222222-2222-4222-8222-222222222222.pdf");

    expect(statSync(mirror).ino).toBe(statSync(stored).ino);
    unlinkSync(stored);
    expect(readFileSync(mirror, "utf8")).toBe("conteudo que sobrevive");
    expect(text).toContain(mirror);
  });

  it("links an image tag the same way", () => {
    const stored = upload("33333333-3333-4333-8333-333333333333.png", "png-bytes");
    const { text } = linkTurnAttachments(`<attached-image path="${stored}" name="IMG_2304.png" />`, { workspace, attachmentsDir });

    expect(text).toContain(join(workspace, ATTACHMENT_LINK_DIR, "33333333-3333-4333-8333-333333333333.png"));
    expect(readFileSync(join(workspace, ATTACHMENT_LINK_DIR, "33333333-3333-4333-8333-333333333333.png"), "utf8")).toBe("png-bytes");
  });

  it("never mirrors a path this store did not write", () => {
    const foreign = join(outside, "44444444-4444-4444-8444-444444444444.pdf");
    writeFileSync(foreign, "alheio");
    const text = `<attached-file path="${foreign}" name="alheio.pdf" />`;

    const result = linkTurnAttachments(text, { workspace, attachmentsDir });

    expect(result.text).toBe(text);
    expect(result.linked).toEqual([]);
  });

  it("leaves a tag whose upload was already purged exactly as written", () => {
    const gone = join(attachmentsDir, "55555555-5555-4555-8555-555555555555.pdf");
    const text = `<attached-file path="${gone}" name="sumiu.pdf" />`;

    expect(linkTurnAttachments(text, { workspace, attachmentsDir })).toEqual({ text, linked: [] });
  });

  it("reads through a path spelled with HTML entities and reuses an existing mirror", () => {
    const stored = upload("66666666-6666-4666-8666-666666666666.pdf", "com entidades");
    const escaped = stored.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    const text = `<attached-file path="${escaped}" name="e.pdf" />`;

    const first = linkTurnAttachments(text, { workspace, attachmentsDir });
    const second = linkTurnAttachments(first.text, { workspace, attachmentsDir });

    expect(first.linked).toHaveLength(1);
    expect(first.linked[0]!.path).toBe(join(workspace, ATTACHMENT_LINK_DIR, "66666666-6666-4666-8666-666666666666.pdf"));
    // The second pass names a workspace path already, so it changes nothing and reports nothing to link.
    expect(second.text).toBe(first.text);
    expect(second.linked).toEqual([]);
  });
});
