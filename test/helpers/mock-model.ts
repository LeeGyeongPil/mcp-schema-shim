// The practice mock model used by the tests is the same encoder `simulate` uses.
export { encodeArgs, mockModelCall } from "../../src/simulate.js";

import { readFileSync } from "node:fs";
import type { McpTool } from "../../src/types.js";

/** Load a tools/list fixture from test/fixtures. */
export function loadFixture(name: string): McpTool[] {
  const text = readFileSync(new URL("../fixtures/" + name + ".json", import.meta.url), "utf8");
  return (JSON.parse(text) as { tools: McpTool[] }).tools;
}

export const FIXTURES = ["sdk-v1-tools", "sdk-v2-tools", "edge-cases"] as const;
