// Example MCP server on the v2 TypeScript SDK (@modelcontextprotocol/server).
// Same tools as server-v1.mjs; v2 emits JSON Schema 2020-12 (`$schema`) instead of draft-07.
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

const server = new McpServer({ name: "example-server-v2", version: "0.1.0" });

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
    inputSchema: z.object({
      query: z.string().min(1).describe("free text"),
      limit: z.number().int().min(1).max(100).optional(),
      state: z.literal("open").optional(),
      since: z.string().datetime().optional(),
      filters: z.array(Filter).optional(),
      sort: z.object({ by: z.string(), dir: z.enum(["asc", "desc"]) }).optional(),
    }),
  },
  echo,
);

server.registerTool(
  "issues.search",
  {
    description: "Same search under a dotted name",
    inputSchema: z.object({
      query: z.string().min(1).describe("free text"),
      limit: z.number().int().min(1).max(100).optional(),
    }),
  },
  echo,
);

await server.connect(new StdioServerTransport());
