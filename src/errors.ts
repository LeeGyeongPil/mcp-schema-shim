import type { RestoreIssue } from "./types.js";

/** Thrown when restored arguments do not satisfy the ORIGINAL input schema. */
export class RestoreError extends Error {
  readonly issues: RestoreIssue[];
  readonly toolName: string;
  constructor(toolName: string, issues: RestoreIssue[]) {
    const lines = issues.map((i) => "- " + (i.pointer || "(root)") + ": " + i.message + " (" + i.keyword + ")");
    super('Arguments for tool "' + toolName + '" do not match its original input schema:\n' + lines.join("\n"));
    this.name = "RestoreError";
    this.toolName = toolName;
    this.issues = issues;
  }
}

/** Thrown by `restore()` when the tool name is not part of the transform map. */
export class UnknownToolError extends Error {
  readonly toolName: string;
  constructor(toolName: string, known: string[]) {
    super(
      'Tool "' + toolName + '" is not in the transform map. Known tools: ' + (known.length ? known.join(", ") : "(none)") + ". " +
        "Build the map with transformTools() from the same tools/list result the model saw.",
    );
    this.name = "UnknownToolError";
    this.toolName = toolName;
  }
}

/** Thrown for bad user input (malformed tool files, unknown profiles, bad CLI usage). */
export class InputError extends Error {
  /** Stable message key; the CLI uses it (with `params`) to show the message in the chosen screen language. `message` stays English. */
  readonly code?: string;
  readonly params?: Record<string, string | number>;
  constructor(message: string, code?: string, params?: Record<string, string | number>) {
    super(message);
    this.name = "InputError";
    this.code = code;
    this.params = params;
  }
}
