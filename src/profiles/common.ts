import type { Diagnostic, JsonSchema, MapEntry, ProfileId } from "../types.js";
import type { RuleDef } from "../rules/registry.js";
import type { RefHooks } from "../refs.js";
import { isObj } from "../walk.js";

/** Everything a profile needs while it walks one tool schema. */
export interface Ctx {
  tool: string;
  profile: ProfileId;
  diagnostics: Diagnostic[];
  entries: MapEntry[];
  /** Report a finding of rule `<profile>/<name>`. Returns the rule so callers can branch on `fixable`. */
  emit(name: string, pointer: string, message: string): RuleDef;
  has(name: string): boolean;
  record(entry: MapEntry): void;
}

export interface ProfileInfo {
  id: ProfileId;
  title: string;
  description: string;
  docUrl: string;
  rules: RuleDef[];
}

export interface Profile extends ProfileInfo {
  /** Check + repair one `inputSchema` (already deep-cloned). Diagnostics and map entries go through `ctx`. */
  transformSchema(root: JsonSchema, ctx: Ctx): JsonSchema;
  /** Optional tool-name rewriting; return the name unchanged when it is already valid. */
  mapToolName?(name: string): string;
  /** Rule name used when `mapToolName` changes a name. */
  nameRule?: string;
}

export function createCtx(profile: ProfileId, rules: RuleDef[], tool: string): Ctx {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const diagnostics: Diagnostic[] = [];
  const entries: MapEntry[] = [];
  return {
    tool,
    profile,
    diagnostics,
    entries,
    has: (name) => byId.has(profile + "/" + name),
    emit(name, pointer, message) {
      const rule = byId.get(profile + "/" + name);
      if (!rule) throw new Error("internal: unknown rule " + profile + "/" + name);
      diagnostics.push({ tool, pointer, ruleId: rule.id, profile, severity: rule.severity, fixable: rule.fixable, message, docUrl: rule.docUrl });
      return rule;
    },
    record(entry) {
      entries.push(entry);
    },
  };
}

/** `$ref` hooks shared by all profiles that inline references. */
export function refHooks(ctx: Ctx): RefHooks {
  return {
    onInlined: (pointer, ref) => {
      if (ctx.has("ref-inlined")) ctx.emit("ref-inlined", pointer + "/$ref", "$ref " + ref + " is not supported here; it was inlined");
    },
    onRecursive: (pointer, ref) => {
      ctx.emit("ref-recursive", pointer + "/$ref", "Recursive $ref " + ref + " cannot be inlined and is not supported by this profile");
    },
    onExternal: (pointer, ref) => {
      ctx.emit("ref-external", pointer + "/$ref", "$ref " + ref + " points outside the schema (or to a missing definition) and cannot be resolved");
    },
  };
}

export function appendDescription(node: JsonSchema, note: string): void {
  const base = typeof node.description === "string" && node.description.length > 0 ? node.description + " " : "";
  node.description = base + "[" + note + "]";
}

/** True when the schema already accepts `null`. */
export function allowsNull(node: JsonSchema): boolean {
  if (node.type === "null" || node.const === null) return true;
  if (Array.isArray(node.type) && node.type.includes("null")) return true;
  if (Array.isArray(node.enum) && node.enum.includes(null)) return true;
  for (const key of ["anyOf", "oneOf"]) {
    if (Array.isArray(node[key]) && node[key].some((b: unknown) => isObj(b) && allowsNull(b))) return true;
  }
  return false;
}

export function isObjectSchema(node: JsonSchema): boolean {
  return node.type === "object" || (Array.isArray(node.type) && node.type.includes("object")) || isObj(node.properties);
}

/** Short JSON for messages and descriptions. */
export function brief(value: unknown, max = 60): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/**
 * Merge `allOf` branches into the node (properties and required are combined, other keywords: node wins,
 * then first branch). Returns null when a branch is not a plain schema object.
 */
export function mergeAllOf(node: JsonSchema): JsonSchema | null {
  const branches: unknown[] = node.allOf;
  if (!Array.isArray(branches) || !branches.every(isObj)) return null;
  const out: JsonSchema = { ...node };
  delete out.allOf;
  for (const b of branches as JsonSchema[]) {
    for (const [k, v] of Object.entries(b)) {
      if (k === "properties" && isObj(v)) out.properties = { ...v, ...(isObj(out.properties) ? out.properties : {}) };
      else if (k === "required" && Array.isArray(v)) out.required = Array.from(new Set([...(Array.isArray(out.required) ? out.required : []), ...v]));
      else if (!(k in out)) out[k] = v;
    }
  }
  return out;
}

/** Root checks shared by all profiles. Returns the (possibly repaired) root. */
export function ensureObjectRoot(root: JsonSchema, ctx: Ctx): JsonSchema {
  const out = { ...root };
  if (out.type === "object") return out;
  const hasCombinator = Array.isArray(out.anyOf) || Array.isArray(out.oneOf) || Array.isArray(out.allOf);
  if (out.type === undefined && !hasCombinator) {
    ctx.emit("root-type", "/type", 'The root schema has no "type": "object"; it was added');
    out.type = "object";
    return out;
  }
  if (Array.isArray(out.anyOf) && out.type === undefined && ctx.has("root-anyof")) {
    ctx.emit("root-anyof", "/anyOf", "The root schema must not be an anyOf; wrap the alternatives in one object schema");
    return out;
  }
  const what = out.type !== undefined ? "type " + brief(out.type) : "a combinator (anyOf/oneOf/allOf) at the root";
  ctx.emit("root-object", "/type", "The root schema must describe an object, but it uses " + what);
  return out;
}
