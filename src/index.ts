// Public API of mcp-schema-shim. Everything not exported here is internal and may change.
export type {
  ProfileId,
  JsonSchema,
  McpTool,
  Severity,
  Diagnostic,
  MapOp,
  MapEntry,
  ToolMap,
  ShimMap,
  TransformOptions,
  TransformResult,
  TransformToolResult,
  RestoreIssue,
} from "./types.js";
export type { ProfileInfo } from "./profiles/common.js";
export type { RuleDef } from "./rules/registry.js";
export { PROFILES, PROFILE_IDS, isProfileId } from "./profiles/index.js";
export { check } from "./check.js";
export { transformTool, transformTools } from "./transform.js";
export { restore } from "./restore.js";
export { RestoreError, UnknownToolError, InputError } from "./errors.js";
export { DOCS_CHECKED } from "./rules/docs.js";
