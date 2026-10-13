import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

// The shared row fill lives in the CSS module, so the DOM tests (which mock
// the module away) can never see it. This compiles the module the way the app
// build does and reads the emitted rules: a disabled row must not answer the
// pointer with a fill — the browser still matches `:hover` on a disabled
// button — and the rule that cancels it must land with a selector at least as
// specific as the fill's, so the cascade picks it.
const here = dirname(fileURLToPath(import.meta.url));
const tailwindRoot = dirname(fileURLToPath(import.meta.resolve("tailwindcss/package.json")));

/** Compiles the popover menu CSS module the way the app build does. */
async function compiledModule(): Promise<string> {
  const compiler = await compile(readFileSync(join(here, "popover-menu.module.css"), "utf8"), {
    base: here,
    loadStylesheet: async (id, base) => {
      const path = id === "tailwindcss"
        ? join(tailwindRoot, "index.css")
        : id.startsWith("tailwindcss/")
          ? join(tailwindRoot, id.slice("tailwindcss/".length))
          : resolve(base, id);
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  return compiler.build([]);
}

describe("menu row fill", () => {
  it("fills a hovered row, and holds the fill back while the row is disabled", async () => {
    const css = await compiledModule();
    const fill = css.indexOf(".rowFill:hover");
    const guard = css.indexOf(".rowFill:disabled:hover");
    expect(fill).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(fill);
    // :disabled:hover outranks :hover, so a disabled row stays clear however
    // the rules are ordered; the fill underneath is the one being cancelled.
    expect(css.slice(fill, guard)).toContain("--color-raised-hover");
    expect(css.slice(guard, guard + 120)).toContain("background-color: transparent");
    // Both stay a pointer thing: hover is gated to devices that have one.
    const wrapping = (at: number) => css.slice(css.lastIndexOf("@media", at), at);
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.rowFill:hover/);
    expect(wrapping(fill)).toContain("@media (hover: hover)");
    expect(wrapping(guard)).toContain("@media (hover: hover)");
  });
});
