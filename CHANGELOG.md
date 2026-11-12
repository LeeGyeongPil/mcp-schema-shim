# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-11-12

### Added
- English and Korean screen language for the CLI: help, the text and markdown reports, error messages and the `simulate` output. Choose it with `--lang en|ko`, or the `MCP_SCHEMA_SHIM_LANG`, `LC_ALL`, `LC_MESSAGES` or `LANG` environment variable, in that order (a value starting with `ko` means Korean, everything else English). `--lang` with any other value exits 2 with one error line.
- Korean text and markdown reports describe each finding with a Korean one-line summary per rule ID; a rule without an entry falls back to the English message.
- `InputError` has optional `code` and `params` fields so the CLI can show library errors in the chosen language. `message` stays the same English text.
- `src/i18n.ts` holds every message in one table; tests check that the English and Korean keys match and that every rule has a Korean summary.

### Changed
- `simulate` prints its banner and labels in one language (English or Korean) instead of an English banner with a Korean note. The exported `MOCK_BANNER` constant is unchanged.
- Node `parseArgs` errors (unknown option, missing value) are shown in the chosen language, followed by a hint to run `--help`.

### Unchanged
- `--format json` output (including `Diagnostic.message`), rule IDs, exit codes, the library exports and the English `message` of every exception are byte-for-byte the same in both languages. Scripts that compare the human-readable English text should pin `--lang en` or `MCP_SCHEMA_SHIM_LANG=en` when the machine locale is Korean. The proxy operational log lines and `docs/rules.md` are not translated.

## [0.3.0] - 2026-11-12

### Added
- `anthropic-strict/limit-tools`: error (not fixable) when one `tools/list` has more than 20 tools. Docs: "Maximum number of tools with `strict: true`".
- `anthropic-strict/limit-optional`: error (not fixable) when more than 24 optional parameters (object properties not listed in `required`, counted at every nesting level) exist across all tool schemas. Docs: "Each parameter not listed in `required` counts toward this limit".
- Optional `Profile.checkToolList` hook, run once by `transformTools()`; only `anthropic-strict` uses it. Findings are reported under the tool name `(all tools)`.

### Changed
- `check` and `fix` now exit 1 for large tool lists under `anthropic-strict` (more than 20 tools or 24 optional parameters), because the API would reject the request with 400. Exactly 20 and 24 stay clean.

### Known limitations
- The limits come from the documentation (read 2026-11-12), not from tests against the live API.
- The proxy counts per `tools/list` page, not across pages, and only logs the rule in its `NOT fixable:` line; it still forwards `tools/list` unchanged.

## [0.2.0] - 2026-11-12

### Added
- `check` can run a stdio MCP server directly: `mcp-schema-shim check --profile <id> -- <server command> [args...]`. It sends `initialize`, reads every `tools/list` page (following `nextCursor`), stops the server and prints the same report and exit code as file mode.
- `--timeout <ms>` (default 10000) for the server mode of `check`. Start failures, timeouts, early server exits and MCP error responses end with exit 2 and a message that says what to change, never exit 70.
- The server child process is always stopped (stdin closed, then SIGTERM, then SIGKILL after one second each), so a silent server cannot hang `check`.

### Known limitations
- `check` with a server command supports stdio servers only; `fix` still reads files only.
- `simulate` with a missing command still ends with exit 70 and a stack trace.
- The `npm test` screenshot (`docs/images/06-test.png`) still shows the 0.1.0 output and 37 tests; the current run is 54 tests.

## [0.1.2] - 2026-11-11

### Fixed
- `anthropic-strict` now reports array constraints (`maxItems`, `uniqueItems`, `minItems` of 2 or more; 0 and 1 stay allowed) as `unsupported-constraint`, formats outside the supported list as the new `unsupported-format` rule, and regular expressions with `\b` or `\B` as `complex-pattern`. `fix` moves them into the description and `restore` still validates against the original schema. Previously `check` printed 0 errors for such schemas and the API answered 400.
- `anthropic-strict` `fix` output for a `complex-pattern` field now names the pattern in the description instead of a wrong `format` note.

### Known limitations
- The profile description string still mentions only numeric/length constraints and complex patterns; the rules table in `docs/rules.md` is current.
- `uniqueItems: false` and a backspace `[\b]` inside a character class are reported conservatively as errors; `fix` resolves both.
- The `anthropic-strict` rules were not re-checked against the official documentation in this release (date in `docs/rules.md` is the earlier check).
- Verified on Node 26 only; the minimum supported Node versions were not re-tested.

## [0.1.1] - 2026-11-10

### Changed
- README: replace the comparison table with a short when-to-use section.

## [0.1.0] - 2026-11-10

### Added
- Four provider profiles with documented rules: `gemini-parameters`, `gemini-json-schema`, `openai-strict`, `anthropic-strict`.
- Library API: `check`, `transformTool`, `transformTools`, `restore`, `PROFILES`, `PROFILE_IDS`, `isProfileId`, `RestoreError`, `UnknownToolError`, `InputError`, `DOCS_CHECKED` and the public types.
- `restore()` undoes `nullable-optional`, `enum-stringified` and `name-mapped` changes and validates the result against the original input schema.
- CLI: `check`, `fix`, `proxy` (stdio) and `simulate` (practice mock model, no LLM call).
- Examples: MCP servers on the v1 and v2 TypeScript SDK, a tools snapshot and a library example.
