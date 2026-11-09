// Example MCP server on the v1 TypeScript SDK (@modelcontextprotocol/sdk).
// Used by `npm run demo`, `simulate` and the end-to-end tests. Every tool just echoes the arguments it received,
// so you can see exactly what reached the server.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "example-server-v1", version: "0.1.0" });

const Filter = z.object({
  field: z.string(),
  op: z.enum(["eq", "lt", "gt"]),
  value: z.union([z.string(), z.number()]),
});

const echo = async (args) => ({ content: [{ type: "text", text: JSON.stringify(args) }] });

server.registerTool(
  "search_issues",
  {
    description: "Search issues with optional filters",
    inputSchema: {
      query: z.string().min(1).describe("free text"),
      limit: z.number().int().min(1).max(100).optional(),
      state: z.literal("open").optional(),
      since: z.string().datetime().optional(),
      filters: z.array(Filter).optional(),
      sort: z.object({ by: z.string(), dir: z.enum(["asc", "desc"]) }).optional(),
    },
  },
  echo,
);

// A name with a dot: valid for MCP, rejected by Anthropic's tool-name rule.
server.registerTool(
  "issues.search",
  {
    description: "Same search under a dotted name",
    inputSchema: {
      query: z.string().min(1).describe("free text"),
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  echo,
);

await server.connect(new StdioServerTransport());
