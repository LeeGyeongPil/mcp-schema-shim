# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-10

### Added
- Four provider profiles with documented rules: `gemini-parameters`, `gemini-json-schema`, `openai-strict`, `anthropic-strict`.
- Library API: `check`, `transformTool`, `transformTools`, `restore`, `PROFILES`, `PROFILE_IDS`, `isProfileId`, `RestoreError`, `UnknownToolError`, `InputError`, `DOCS_CHECKED` and the public types.
- `restore()` undoes `nullable-optional`, `enum-stringified` and `name-mapped` changes and validates the result against the original input schema.
- CLI: `check`, `fix`, `proxy` (stdio) and `simulate` (practice mock model, no LLM call).
- Examples: MCP servers on the v1 and v2 TypeScript SDK, a tools snapshot and a library example.
