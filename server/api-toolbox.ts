// Harness-mounted tool executors for API-driven engines.
//
// CLI engines (Claude, Codex, ACP, pi) mount `turn.integrations.*` MCP
// servers inside their own agent process. API engines have no agent process
// — the harness is the MCP host instead: this module spawns each mounted
// integration's stdio MCP server, advertises its tools on the turn, and
// executes calls through server/mcp-stdio-client.ts. The OpenAI-compatible
// tool loop in the shared runtime consumes the result.
//
// Approval semantics are preserved exactly as for CLI engines: the mounted
// local-computer descriptor is the gated proxy (gatedLocalComputer), whose
// who-is-driving gate already answers tool calls with a refusal while the
// person holds control. Browser mounts ride the app's own browser proxy.
//
// Spawn failures degrade one server at a time: a computer mount that cannot
// start removes only its own tools and reports through toolListProblems, so
// a broken browser never silently disables the computer too — the model is
// told what actually mounted.
import { McpStdioClient } from "./mcp-stdio-client.ts";
import type { RuntimeTool } from "./contracts.ts";

/** The integration descriptors startTurn may mount for an API engine. */
export type ApiToolboxIntegrations = {
  localComputer?: { command: string; args: string[]; env: Record<string, string> };
  browser?: { command: string; args: string[]; env: Record<string, string> };
  phone?: { command: string; args: string[]; env: Record<string, string> };
  agents?: { command: string; args: string[]; env: Record<string, string> };
  composio?: { command: string; args: string[]; env: Record<string, string> };
  custom?: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
};

export interface ApiToolbox {
  tools: RuntimeTool[];
  /** Why a mounted integration contributed no tools (spawn/handshake/list). */
  toolListProblems: string[];
  close(): Promise<void>;
}

// A mount-sanity cap, not a budget: built-ins mount first, and a custom
// catalog like REA's 207-tool surface must survive whole (its orchestration
// tools sit last in the list — truncating it would mount a catalog nobody
// can use). Two large servers still degrade instead of overflowing.
const MAX_TOOLS_PER_TURN = 256;

// Above this much argument-schema per server, every model request pays a
// serious token tax; warn once with the number and the way out (scope the
// server to specific bots in Bot Settings -> MCP servers) instead of
// silently taxing every turn of every API-engine bot.
const CATALOG_SCHEMA_WARN_BYTES = 64 * 1024;
const warnedCatalogServers = new Set<string>();

export async function buildApiToolbox(integrations: ApiToolboxIntegrations): Promise<ApiToolbox> {
  const clients: Array<{ label: string; client: McpStdioClient }> = [];
  const tools: RuntimeTool[] = [];
  const toolListProblems: string[] = [];

  const mounts: Array<{ label: string; spec: { command: string; args: string[]; env?: Record<string, string> } | undefined }> = [
    { label: "computer", spec: integrations.localComputer },
    { label: "browser", spec: integrations.browser },
    { label: "phone", spec: integrations.phone },
    { label: "agents", spec: integrations.agents },
    { label: "composio", spec: integrations.composio },
    ...Object.entries(integrations.custom ?? {}).map(([name, spec]) => ({ label: `mcp:${name}`, spec })),
  ];

  for (const { label, spec } of mounts) {
    if (!spec || tools.length >= MAX_TOOLS_PER_TURN) continue;
    try {
      const client = await McpStdioClient.start(spec);
      const listed = await client.listTools();
      if (listed.length === 0) {
        await client.close().catch(() => {});
        toolListProblems.push(`${label}: mounted but exposed no tools`);
        continue;
      }
      {
        const schemaBytes = listed.reduce((sum, tool) => {
          try {
            return sum + JSON.stringify(tool.inputSchema ?? {}).length;
          } catch {
            return sum;
          }
        }, 0);
        if (schemaBytes > CATALOG_SCHEMA_WARN_BYTES && !warnedCatalogServers.has(label)) {
          warnedCatalogServers.add(label);
          console.warn(
            `api-tools: ${label} advertises ${listed.length} tools with ~${Math.round(schemaBytes / 1024)} KB of argument schemas; ` +
              `scope it to specific bots in Bot Settings -> MCP servers if that is not intended`,
          );
        }
      }
      clients.push({ label, client });
      for (const tool of listed) {
        if (tools.length >= MAX_TOOLS_PER_TURN) break;
        tools.push({
          name: tool.name,
          description: tool.description,
          // The schema the model needs to shape arguments; a server that
          // advertises none still gets a valid empty object schema.
          parameters: tool.inputSchema ?? { type: "object", properties: {} },
          execute: async (args) => {
            try {
              return await client.callTool(tool.name, args);
            } catch (error) {
              return {
                isError: true,
                text: `${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`,
                images: [],
              };
            }
          },
        });
      }
    } catch (error) {
      toolListProblems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    tools,
    toolListProblems,
    close: async () => {
      for (const { client } of clients) await client.close().catch(() => {});
    },
  };
}
