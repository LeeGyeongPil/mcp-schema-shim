/** Official documentation pages the rules are based on. */
export const DOC_URLS = {
  openaiStructured: "https://developers.openai.com/api/docs/guides/structured-outputs",
  geminiFunctionCalling: "https://aistudio.google.com/docs/function-calling",
  geminiSchema: "https://aistudio.google.com/api-reference/caching",
  geminiStructured: "https://aistudio.google.com/docs/structured-output",
  anthropicToolUse: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use",
  anthropicStructured: "https://platform.claude.com/docs/en/build-with-claude/structured-outputs",
} as const;

/** Date the documentation was last compared with the rules. Provider rules change; re-check before trusting. */
export const DOCS_CHECKED = "2026-11-10";
