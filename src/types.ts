/** Provider/path profiles supported by mcp-schema-shim. */
export type ProfileId = "gemini-parameters" | "gemini-json-schema" | "openai-strict" | "anthropic-strict";

/** A JSON Schema object. Kept loose on purpose: real-world tool schemas are arbitrary. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonSchema = { [keyword: string]: any };

/** An MCP tool definition as returned by `tools/list`. */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
  [key: string]: unknown;
}

export type Severity = "error" | "warning" | "info";

/** One finding of `check()`. `pointer` is a JSON Pointer into the tool's `inputSchema` (`/name` for the tool name). */
export interface Diagnostic {
  tool: string;
  pointer: string;
  ruleId: string;
  profile: ProfileId;
  severity: Severity;
  fixable: boolean;
  message: string;
  docUrl: string;
}

/** What a transform step did. Only some operations need work when arguments come back. */
export type MapOp =
  | "nullable-optional" // optional property became required + nullable; restore removes the null
  | "enum-stringified" // enum/const values were turned into strings; restore maps them back
  | "name-mapped" // tool name was rewritten; restore returns the original name
  | "constraint-to-description" // a keyword was moved into the description; the original schema re-checks it
  | "dropped" // a keyword was removed (lossy); the original schema re-checks it
  | "all-of-merged"
  | "one-of-to-any-of";

export interface MapEntry {
  op: MapOp;
  /** JSON Pointer of the changed node in the original (pre-transform) schema. */
  schemaPointer: string;
  /** Path of the affected value inside the call arguments; `*` stands for any array element / map value. */
  argPath: string;
  /** True when the change loses information the original-schema re-validation has to protect. */
  lossy: boolean;
  detail: string;
  /** Original values for `enum-stringified`. */
  values?: unknown[];
}

export interface ToolMap {
  originalName: string;
  /** The untouched original `inputSchema`; `restore()` validates against it. */
  originalSchema: JsonSchema;
  entries: MapEntry[];
}

/** Transform map: keyed by the tool name as exposed to the model (after any renaming). */
export interface ShimMap {
  version: 1;
  profile: ProfileId;
  tools: Record<string, ToolMap>;
}

export interface TransformOptions {
  /** Tool names that are already taken (used to avoid collisions when renaming). */
  usedNames?: Set<string>;
}

export interface TransformResult {
  tools: McpTool[];
  map: ShimMap;
  diagnostics: Diagnostic[];
}

export interface TransformToolResult {
  tool: McpTool;
  toolMap: ToolMap;
  diagnostics: Diagnostic[];
}

export interface RestoreIssue {
  pointer: string;
  keyword: string;
  message: string;
}
