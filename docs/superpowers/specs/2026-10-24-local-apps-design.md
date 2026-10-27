# Local apps

## Summary

A person picks an app from the existing Plugins catalog and runs it on their own computer with their own token: a
pinned stdio MCP server, saved as an ordinary custom MCP server entry. Calls go from that computer straight to the
app's API, with no connected-apps service in between. A bot gets the app only when the person chooses it for that bot.

No new service, daemon, route, settings section or bot field. The feature is one data file, one optional marker on
an MCP server entry, and one row in the catalog tile.

## Goals

- Every catalog app that has a usable local MCP server can be run locally from its tile, credentials entered once.
- No request or credential for a local app goes to Composio or the OpenMausBot broker.
- A local app reaches no bot until chosen for it, on every create path, including new bots.
- Existing connected apps and custom MCP servers behave exactly as before.

## Non-goals

- Vendor-hosted MCP endpoints (reachable today through **Add server → Connect to a URL**).
- Moving MCP secrets out of `config.json` into the desktop key store (it would change every custom server).
- Installing Node, Docker or uv.

## Design

### Recipes: `shared/local-apps.ts`

`LOCAL_APPS` maps a catalog slug to `{ command, args, env: [{ name, secret, url? }], source, server?, signIn? }`.
Adding an app is one entry. The MCP server is named after the slug, or `server` when several catalog apps share one
server. An app is listed only when its server:

1. runs as a stdio command on the person's computer;
2. takes every secret from an environment variable, never an argument;
3. calls only the app's own API;
4. uses a static token the person creates (no browser consent at start), except Google: an OAuth client the person
   creates, with a browser sign-in on first use whose token stays on the person's computer (`signIn: "google"`);
5. is a published release, pinned by version (Docker: by digest);
6. had a release in the last 12 months.

Fourteen of the 24 curated apps qualify: GitHub, Stripe and Notion (vendor servers); Trello, Airtable, Linear, Jira,
Slack and Figma (community servers); Gmail, Google Calendar, Drive, Docs and Sheets, all through one community server,
`workspace-mcp`.

Sentry's server (`@sentry/mcp-server` 0.42.0) fails rule 3: started, like every MCP server, with OpenMausBot's
environment, it sends search queries to the AI provider whose key it finds there and error reports to any `SENTRY_DSN`.

Google's server keeps one token file per Google account, holding the scopes of the services it was started with, so
the five Google apps share one entry, `google`: per-app servers would write the same file, each with its own scopes.
Setting it up from any Google card sets up all five; each Google card shows the same server. The first tool
call without a sign-in returns Google's authorization link and starts the server's callback listener on
`127.0.0.1:8000` (or the next free port up to 8004); the bot shows the link, the person signs in, and the warm engine
process that runs the server
takes the callback. The token is written by the server to `~/.google_workspace_mcp/credentials/` (mode 0600), never
into OpenMausBot.

### Marker: `localApp` on a stdio MCP server entry

`config.json → mcpServers.<name>.localApp` is a slug-shaped string, set only by Add (`POST /api/mcp/servers`). An
edit keeps the saved value: it can neither add, change nor remove it, and a local app cannot be edited into a URL
server. A bot's own add and Paste config never carry it. It is a plain string, not an enum of catalog slugs, so an app
leaving the catalog never invalidates a saved entry.

### Who gets it

With no `mcpServers` list, a bot mounts every enabled server **except local apps**; with a list, the named servers
that are enabled and run on this computer, as before. The rule is checked after the entry is parsed in the three
places that already decide "no list means all": `customMcpServers` (every turn, system prompt, tool-allow check and
chat app), the My Cloud connection prompt, and the client's `mcpServersForBot`. The per-bot switch list's first flip
writes the servers the bot already has, so it never pulls a local app in. No create path changes: each leaves the
list absent unless the person's New bot defaults set one.

### Plugins

`LocalAppRow` sits in each catalog tile that has a recipe:

- **Run on this computer** opens the exact command, a link to its source, and one field per variable (a password
  field for secrets) with a link to where the person creates it.
- **Test and start** posts the server with `localApp`, runs the existing Test, and turns it on when Test lists its
  tools. On failure it stays saved and off and shows the server's reason; the same button tries again.
- Running, the row says so and links to each bot's Access → MCP servers page. Pinned to another computer (after a
  move to My Cloud), it says which computer runs it.

A local app running on this computer counts as connected: it shows under **Connected** and in the count (once, also
when the same app is connected through connected apps), also where managed mode hides that app's connected-apps tile.
Edit, Remove and token changes stay in **Your MCP servers**, which reloads after a local app is set up. `AppsSection`
moved out of `PluginsPanel.tsx` unchanged to keep that file under its line cap.

### Move to My Cloud

The move copies `localApp` with the entry, and `runsHere` is true for a local app, so My Cloud saves it marked as
running on the person's computer and never starts it. The token travels with the entry, as every MCP server's env
and every provider key does today.

## Known risks

- Tokens are plaintext in `config.json` (mode 0600, write-only over the API), like every custom MCP server.
- Seven servers are community code that runs with the person's token. The command and source are shown first;
  versions are pinned. `npx` and `uvx` pin the package, not its dependency tree.
- The Google sign-in token is stored on the computer by the server, in `~/.google_workspace_mcp/credentials/`.
  Its callback needs one of ports 8000-8004 free and the engine process still running when the person finishes signing in;
  `workspace-mcp` calls stdio its legacy mode, recommending HTTP for new clients.
- Under Codex, every mounted stdio server's environment is merged into one app-server process, as for all custom
  servers today.
- A bot's list keeps a server name after the server is removed, so re-adding the same app re-mounts it for that bot.
- New-bot defaults may name a local app; that is the person choosing it.
- An older build after a downgrade rejects entries with `localApp` and skips them.
