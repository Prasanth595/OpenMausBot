/** A catalog app that runs as an MCP server on this computer with the person's own credentials, so its calls go
 * straight to the app and through no connected-apps service. */
export interface LocalAppRecipe {
  /** The program and its arguments, every version pinned; never a secret. */
  command: string;
  args: readonly string[];
  /** The variables the server reads; `secret: false` for a setting such as a site address. `url`: where the person
   * gets the value. */
  env: ReadonlyArray<{ name: string; secret: boolean; url?: string }>;
  /** The server's source code, shown before it runs. */
  source: string;
  /** The MCP server's name when several catalog apps share one server and one sign-in; absent: the app's slug. */
  server?: string;
  /** The service whose browser sign-in the server starts on first use, with an OAuth client the person creates; the
   * token it gets stays on this computer. */
  signIn?: "google";
}

/** workspace-mcp 2.2.0 keeps one token file per Google account, with the scopes of every service it was started with:
 * one server for all Google apps. */
const GOOGLE: LocalAppRecipe = {
  command: "uvx",
  args: ["workspace-mcp==2.2.0", "--transport", "stdio", "--tools", "gmail", "calendar", "drive", "docs", "sheets", "--tool-tier", "core"],
  env: [
    { name: "GOOGLE_OAUTH_CLIENT_ID", secret: false, url: "https://console.cloud.google.com/auth/clients" },
    { name: "GOOGLE_OAUTH_CLIENT_SECRET", secret: true, url: "https://console.cloud.google.com/auth/clients" },
    { name: "USER_GOOGLE_EMAIL", secret: false },
  ],
  source: "https://github.com/taylorwilsdon/google_workspace_mcp",
  server: "google",
  signIn: "google",
};

/** Keyed by the app's catalog slug. */
export const LOCAL_APPS: Readonly<Record<string, LocalAppRecipe>> = {
  gmail: GOOGLE,
  googlecalendar: GOOGLE,
  googledrive: GOOGLE,
  googledocs: GOOGLE,
  googlesheets: GOOGLE,
  github: {
    command: "docker",
    args: ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server:v2.0.3@sha256:250bc6ce70788207608ef74cef4397230ff2e8481218da74d6093e4bd9101132"],
    env: [{ name: "GITHUB_PERSONAL_ACCESS_TOKEN", secret: true, url: "https://github.com/settings/personal-access-tokens/new" }],
    source: "https://github.com/github/github-mcp-server",
  },
  stripe: {
    command: "npx",
    args: ["-y", "@stripe/mcp@0.3.3"],
    env: [{ name: "STRIPE_SECRET_KEY", secret: true, url: "https://dashboard.stripe.com/apikeys" }],
    source: "https://github.com/stripe/ai",
  },
  notion: {
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server@2.5.2"],
    env: [{ name: "NOTION_TOKEN", secret: true, url: "https://www.notion.so/profile/integrations" }],
    source: "https://github.com/makenotion/notion-mcp-server",
  },
  trello: {
    command: "npx",
    args: ["-y", "@delorenj/mcp-server-trello@1.8.1"],
    env: [
      { name: "TRELLO_API_KEY", secret: true, url: "https://trello.com/app-key" },
      { name: "TRELLO_TOKEN", secret: true, url: "https://trello.com/app-key" },
    ],
    source: "https://github.com/delorenj/mcp-server-trello",
  },
  airtable: {
    command: "npx",
    args: ["-y", "airtable-mcp-server@1.14.0"],
    env: [{ name: "AIRTABLE_API_KEY", secret: true, url: "https://airtable.com/create/tokens/new" }],
    source: "https://github.com/domdomegg/airtable-mcp-server",
  },
  linear: {
    command: "npx",
    args: ["-y", "@tacticlaunch/mcp-linear@1.4.5"],
    env: [{ name: "LINEAR_API_TOKEN", secret: true, url: "https://linear.app/settings/account/security" }],
    source: "https://github.com/tacticlaunch/mcp-linear",
  },
  jira: {
    command: "uvx",
    args: ["mcp-atlassian==0.23.1"],
    env: [
      { name: "JIRA_URL", secret: false },
      { name: "JIRA_USERNAME", secret: false },
      { name: "JIRA_API_TOKEN", secret: true, url: "https://id.atlassian.com/manage-profile/security/api-tokens" },
    ],
    source: "https://github.com/sooperset/mcp-atlassian",
  },
  slack: {
    command: "npx",
    args: ["-y", "slack-mcp-server@1.3.0", "--transport", "stdio"],
    env: [{ name: "SLACK_MCP_XOXP_TOKEN", secret: true, url: "https://api.slack.com/apps" }],
    source: "https://github.com/korotovsky/slack-mcp-server",
  },
  figma: {
    command: "npx",
    args: ["-y", "figma-developer-mcp@0.13.2", "--stdio"],
    env: [{ name: "FIGMA_API_KEY", secret: true, url: "https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens" }],
    source: "https://github.com/GLips/Figma-Context-MCP",
  },
};
