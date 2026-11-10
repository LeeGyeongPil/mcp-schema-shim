# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
