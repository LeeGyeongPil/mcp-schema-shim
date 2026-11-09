import type { Diagnostic, McpTool, ProfileId } from "./types.js";
import { transformTools } from "./transform.js";

/**
 * Report which rules of a profile the given tool definition(s) break.
 * Uses the same rule engine as `transformTools()`, so every fixable diagnostic is fixed by it.
 */
export function check(tools: McpTool[] | McpTool, profile: ProfileId): Diagnostic[] {
  const list = Array.isArray(tools) ? tools : [tools];
  return transformTools(list, profile).diagnostics;
}
