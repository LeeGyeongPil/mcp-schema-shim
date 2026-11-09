// Minimal library example: transform a tool for a provider, then restore the arguments a model sent back.
// Run `npm run build` first, then `node examples/library.mjs`.
import { readFileSync } from "node:fs";
import { transformTools, restore } from "mcp-schema-shim";

const { tools } = JSON.parse(readFileSync(new URL("./tools.json", import.meta.url), "utf8"));

// 1. Make the tool definitions acceptable for OpenAI strict mode.
const { tools: forModel, map } = transformTools(tools, "openai-strict");
const searchIssues = forModel.find((t) => t.name === "search_issues");
console.log("required for the model:", JSON.stringify(searchIssues.inputSchema.required));

// 2. A strict-mode model fills every field; optional ones come back as null.
const fromModel = { query: "bug", limit: null, state: null, since: null, filters: null, sort: null };
console.log("model sent:", JSON.stringify(fromModel));

// 3. Restore the original argument shape (and validate it against the ORIGINAL schema).
const restored = restore("search_issues", fromModel, map);
console.log("restored:", JSON.stringify(restored.args));
