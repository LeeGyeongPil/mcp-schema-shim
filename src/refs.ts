import type { JsonSchema } from "./types.js";
import { isObj } from "./walk.js";

export interface RefHooks {
  onInlined(pointer: string, ref: string): void;
  onRecursive(pointer: string, ref: string): void;
  onExternal(pointer: string, ref: string): void;
}

const MAP_KEYS = new Set(["properties", "patternProperties", "dependentSchemas"]);
const SCHEMA_KEYS = new Set(["items", "additionalProperties", "not", "if", "then", "else", "contains", "propertyNames", "unevaluatedProperties", "unevaluatedItems"]);
const ARRAY_KEYS = new Set(["anyOf", "oneOf", "allOf", "prefixItems", "items"]);
const DEF_KEYS = new Set(["$defs", "definitions"]);

function resolvePointer(root: JsonSchema, ref: string): unknown {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) return undefined;
  let cur: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const seg = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObj(cur) && !Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function collectRefs(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (isObj(node)) {
    if (typeof node.$ref === "string") out.add(node.$ref);
    for (const v of Object.values(node)) collectRefs(v, out);
  }
}

/** True when following `ref` can lead back to `ref` itself. */
function isRecursive(root: JsonSchema, ref: string): boolean {
  const seen = new Set<string>();
  const queue = [ref];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    const found = new Set<string>();
    collectRefs(resolvePointer(root, current), found);
    for (const r of found) {
      if (r === ref || r === "#") return true;
      if (!seen.has(r)) {
        seen.add(r);
        queue.push(r);
      }
    }
  }
  return false;
}

/**
 * Inline local, non-recursive `$ref`s. Recursive and external references stay in place and are reported
 * through the hooks. `$defs`/`definitions` are removed only when no `$ref` remains.
 */
export function inlineRefs(root: JsonSchema, hooks: RefHooks): JsonSchema {
  let remaining = false;

  const walkNode = (node: JsonSchema, pointer: string, stack: string[]): JsonSchema => {
    if (typeof node.$ref === "string") {
      const ref: string = node.$ref;
      const target = ref.startsWith("#") ? resolvePointer(root, ref) : undefined;
      if (!isObj(target)) {
        remaining = true;
        hooks.onExternal(pointer, ref);
        return node;
      }
      if (ref === "#" || stack.includes(ref) || isRecursive(root, ref)) {
        remaining = true;
        hooks.onRecursive(pointer, ref);
        return node;
      }
      const siblings: JsonSchema = { ...node };
      delete siblings.$ref;
      const resolved = walkNode(target, pointer, [...stack, ref]);
      const walkedSiblings = walkNode(siblings, pointer, stack);
      hooks.onInlined(pointer, ref);
      return { ...resolved, ...walkedSiblings };
    }
    const out: JsonSchema = {};
    for (const [k, v] of Object.entries(node)) {
      if (DEF_KEYS.has(k)) {
        out[k] = v;
      } else if (MAP_KEYS.has(k) && isObj(v)) {
        out[k] = Object.fromEntries(
          Object.entries(v).map(([name, child]) => [name, isObj(child) ? walkNode(child, pointer + "/" + k + "/" + name, stack) : child]),
        );
      } else if (SCHEMA_KEYS.has(k) && isObj(v)) {
        out[k] = walkNode(v, pointer + "/" + k, stack);
      } else if (ARRAY_KEYS.has(k) && Array.isArray(v)) {
        out[k] = v.map((child, i) => (isObj(child) ? walkNode(child, pointer + "/" + k + "/" + i, stack) : child));
      } else {
        out[k] = v;
      }
    }
    return out;
  };

  const result = walkNode(root, "", []);
  if (!remaining) {
    for (const k of DEF_KEYS) delete result[k];
  }
  return result;
}
