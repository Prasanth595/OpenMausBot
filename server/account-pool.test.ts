import { describe, expect, it } from "vitest";
import { accountPoolBackups, accountPoolEnabled } from "./account-pool.ts";

const accounts = [
  { instanceId: "main", driverKind: "antigravityAgent", enabled: true, defaultModel: "gemini" },
  { instanceId: "work", driverKind: "antigravityAgent", enabled: true, defaultModel: "gemini" },
  { instanceId: "personal", driverKind: "antigravityAgent", enabled: true, defaultModel: "gemini" },
  { instanceId: "off", driverKind: "antigravityAgent", enabled: false, defaultModel: "gemini" },
  { instanceId: "claude", driverKind: "claudeAgent", enabled: true, defaultModel: "sonnet" },
];

describe("Antigravity account pool", () => {
  it("uses enabled accounts in priority order after the current account", () => {
    expect(accountPoolBackups({ enabled: true, failover: true, restore: true, priorities: { work: 80, personal: 50 } }, "main", accounts))
      .toEqual([{ instanceId: "work", model: "gemini" }, { instanceId: "personal", model: "gemini" }]);
  });

  it("does not route work when pooling or failover is disabled", () => {
    expect(accountPoolBackups({ enabled: false, failover: true, restore: true, priorities: {} }, "main", accounts)).toEqual([]);
    expect(accountPoolBackups({ enabled: true, failover: false, restore: true, priorities: {} }, "main", accounts)).toEqual([]);
    expect(accountPoolEnabled({ enabled: true, failover: true, restore: true, priorities: {} }, "claudeAgent")).toBe(false);
  });
});
