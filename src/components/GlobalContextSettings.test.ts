import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [fixture.values[fixture.index++] ?? initial, vi.fn()],
  useEffect: () => {},
}));
vi.mock("./GlobalSkillsSettings", () => ({ GlobalSkillsSettings: () => null }));
import { GlobalContextSettings } from "./GlobalContextSettings";

it("warns when non-ASCII text exceeds the byte limit", () => {
  fixture.values = ["界".repeat(8001), "", { instructions: "", memory: "" }, false, false, ""];
  fixture.index = 0;
  const html = renderToStaticMarkup(createElement(GlobalContextSettings));
  expect(html).toContain('role="alert"');
  expect(html).toContain("Each field is limited to 24,000 bytes");
});
