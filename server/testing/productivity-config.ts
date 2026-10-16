// The productivity report's settings as its tests assume them: a São Paulo
// calendar with Brazil's holidays, a merge gate, a production tag and a small
// role list. Imported for its effect, before a test file's own imports run.
import { configureReport } from "../../shared/productivity.ts";
import { configureGithubSources } from "../productivity-github.ts";

configureReport({
  timeZone: "America/Sao_Paulo",
  repo: "acme/widgets",
  holidays: "BR",
  botRoles: {
    "lead-dev-id": "engineering", "Lead Dev": "engineering",
    "Eng Dev": "engineering", "QA Dev": "engineering", "DBA Dev": "engineering", "SRE Dev": "engineering", "Delivery Dev": "engineering",
    "support-monitor-id": "operations", "Support Monitor": "operations",
    "Chief of Staff": "operations",
  },
});
configureGithubSources({ gateContext: "ci/merge-gate", productionTag: "production" });
