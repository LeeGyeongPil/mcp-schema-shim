# Rules

Every rule belongs to one profile, links to the provider documentation it is based on, and says whether `transform`/`fix` repairs it.

> Based on the provider documentation as read on 2026-11-10. The rules are **not** verified against the live APIs yet (a `--live` check is planned). Provider limits change; if a rule looks wrong, open an issue with the documentation link.

## `gemini-parameters`

Gemini function declarations — parameters (OpenAPI Schema subset). The classic `parameters` field of a Gemini FunctionDeclaration. Accepts only an OpenAPI 3.0 Schema subset; one bad tool fails the whole request.

Documentation: https://aistudio.google.com/docs/function-calling

| Rule | Severity | Fixable | What it does | Documentation (checked 2026-11-10) |
|---|---|---|---|---|
| `gemini-parameters/meta-keyword` | error | yes | $schema/$id/$comment/$anchor are not Schema fields and make the request fail; they are removed. | https://aistudio.google.com/api-reference/caching |
| `gemini-parameters/const` | error | yes | const is not a Schema field; it becomes a one-value enum (non-string values are stringified and restored later). | https://aistudio.google.com/api-reference/caching |
| `gemini-parameters/enum-non-string` | error | yes | enum is only defined for strings; other values are stringified (type becomes string) and restored later. | https://aistudio.google.com/api-reference/caching |
| `gemini-parameters/type-array` | error | yes | type arrays such as ["string","null"] are not allowed; they become nullable or a sibling-free anyOf. | https://aistudio.google.com/api-reference/caching |
| `gemini-parameters/anyof-siblings` | error | yes | anyOf must not have sibling fields; siblings (including description) move into each branch. | https://aistudio.google.com/api-reference/caching |
| `gemini-parameters/one-of` | warning | yes | oneOf is not a Schema field; it becomes anyOf (exclusivity is not enforced upstream, the original schema re-checks it). | https://aistudio.google.com/api-reference/caching |
| `gemini-parameters/all-of` | warning | yes | allOf is not a Schema field; object branches are merged into the node. | https://aistudio.google.com/api-reference/caching |
| `gemini-parameters/ref-inlined` | error | yes | $ref/$defs are not Schema fields; local references are inlined. | https://aistudio.google.com/api-reference/caching |
| `gemini-parameters/ref-recursive` | error | no | Recursive $ref cannot be inlined. Use the gemini-json-schema profile (parametersJsonSchema) instead. | https://aistudio.google.com/api-reference/caching |
| `gemini-parameters/ref-external` | error | no | $ref that points outside the schema cannot be resolved. | https://aistudio.google.com/api-reference/caching |
| `gemini-parameters/unsupported-keyword` | warning | yes | Keywords outside the Schema object (additionalProperties, not, if/then/else, patternProperties, multipleOf, ...) are removed; primitive values are kept in the description. | https://aistudio.google.com/api-reference/caching |
| `gemini-parameters/format-unsupported` | warning | yes | Only a few formats are accepted (string: enum, date-time; numbers: int32, int64, float, double); other formats move into the description. | https://aistudio.google.com/api-reference/caching |
| `gemini-parameters/missing-type` | warning | yes | properties without type: object are rejected; type is added. | https://aistudio.google.com/api-reference/caching |
| `gemini-parameters/array-items-missing` | warning | yes | An array schema needs items; a string item schema is added (the original schema re-checks the values). | https://aistudio.google.com/api-reference/caching |
| `gemini-parameters/root-type` | warning | yes | The root schema needs type "object". | https://aistudio.google.com/api-reference/caching |
| `gemini-parameters/root-object` | error | no | The root schema must be an object schema, not a combinator or another type. | https://aistudio.google.com/api-reference/caching |

## `gemini-json-schema`

Gemini function declarations — parametersJsonSchema. The newer `parametersJsonSchema` field takes real JSON Schema (including $ref/$defs and const) and ignores keywords it does not use.

Documentation: https://aistudio.google.com/docs/function-calling

| Rule | Severity | Fixable | What it does | Documentation (checked 2026-11-10) |
|---|---|---|---|---|
| `gemini-json-schema/root-type` | warning | yes | The root schema needs type "object". | https://aistudio.google.com/docs/function-calling |
| `gemini-json-schema/root-object` | error | no | The root schema must describe an object. | https://aistudio.google.com/docs/function-calling |
| `gemini-json-schema/ref-external` | error | no | $ref that points outside the schema cannot be resolved by the API. | https://aistudio.google.com/docs/structured-output |
| `gemini-json-schema/ignored-keyword` | info | no | minLength/maxLength are stripped and ignored; the original schema still checks them when the shim restores arguments. | https://aistudio.google.com/docs/structured-output |

## `openai-strict`

OpenAI strict function calling (Structured Outputs). `strict: true` tools accept a JSON Schema subset: all properties required, additionalProperties: false everywhere, optional fields expressed as null unions.

Documentation: https://developers.openai.com/api/docs/guides/structured-outputs

| Rule | Severity | Fixable | What it does | Documentation (checked 2026-11-10) |
|---|---|---|---|---|
| `openai-strict/additional-properties` | error | yes | Every object needs additionalProperties: false. | https://developers.openai.com/api/docs/guides/structured-outputs |
| `openai-strict/optional-property` | error | yes | Every property must be listed in required; optional ones become nullable (the shim removes the null again when arguments are restored). | https://developers.openai.com/api/docs/guides/structured-outputs |
| `openai-strict/const` | warning | yes | const is not in the list of supported keywords; it becomes a one-value enum. | https://developers.openai.com/api/docs/guides/structured-outputs |
| `openai-strict/unsupported-keyword` | warning | yes | not, if/then/else, dependentRequired/dependentSchemas, patternProperties (and allOf that cannot be merged) are not supported; they are removed. | https://developers.openai.com/api/docs/guides/structured-outputs |
| `openai-strict/unsupported-format` | warning | yes | Only date-time, time, date, duration, email, hostname, ipv4, ipv6 and uuid formats are supported; others move into the description. | https://developers.openai.com/api/docs/guides/structured-outputs |
| `openai-strict/all-of` | warning | yes | allOf is not supported; object branches are merged into the node. | https://developers.openai.com/api/docs/guides/structured-outputs |
| `openai-strict/free-form-object` | error | no | Objects without fixed properties (free-form maps) cannot be expressed in strict mode. Planned: JSON-string field conversion. | https://developers.openai.com/api/docs/guides/structured-outputs |
| `openai-strict/root-anyof` | error | no | The root schema must not be an anyOf. | https://developers.openai.com/api/docs/guides/structured-outputs |
| `openai-strict/root-type` | warning | yes | The root schema needs type "object". | https://developers.openai.com/api/docs/guides/structured-outputs |
| `openai-strict/root-object` | error | no | The root schema must be an object schema. | https://developers.openai.com/api/docs/guides/structured-outputs |
| `openai-strict/ref-recursive` | error | no | Recursive $ref: argument restore cannot follow recursive structures yet. | https://developers.openai.com/api/docs/guides/structured-outputs |
| `openai-strict/ref-external` | error | no | $ref that points outside the schema cannot be resolved. | https://developers.openai.com/api/docs/guides/structured-outputs |
| `openai-strict/limit-depth` | error | no | At most 10 levels of nesting are allowed. | https://developers.openai.com/api/docs/guides/structured-outputs |
| `openai-strict/limit-properties` | error | no | At most 5000 properties in total are allowed. | https://developers.openai.com/api/docs/guides/structured-outputs |
| `openai-strict/limit-enum` | error | no | At most 1000 enum values in total are allowed. | https://developers.openai.com/api/docs/guides/structured-outputs |

## `anthropic-strict`

Anthropic strict tool use. `strict: true` tools reject numeric/length constraints and complex patterns, and tool names must match ^[a-zA-Z0-9_-]{1,128}$.

Documentation: https://platform.claude.com/docs/en/build-with-claude/structured-outputs

| Rule | Severity | Fixable | What it does | Documentation (checked 2026-11-10) |
|---|---|---|---|---|
| `anthropic-strict/unsupported-constraint` | error | yes | minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, minLength and maxLength, and array constraints (maxItems, uniqueItems, minItems of 2 or more; minItems 0 and 1 are fine) are rejected (400); they move into the description and the original schema re-checks them on restore. | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| `anthropic-strict/complex-pattern` | error | yes | Complex regular expressions (longer than 200 characters, back-references, look-around, word boundaries \b and \B) are rejected; the pattern moves into the description. | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| `anthropic-strict/unsupported-format` | error | yes | Only date-time, time, date, duration, email, hostname, uri, ipv4, ipv6 and uuid formats are supported; others are rejected (400) and move into the description. | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| `anthropic-strict/additional-properties` | warning | yes | Objects should set additionalProperties: false explicitly (true is rejected). | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| `anthropic-strict/additional-properties-schema` | error | no | A schema-valued additionalProperties (map) is not supported; only false is. | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| `anthropic-strict/ref-recursive` | error | no | Recursive $ref is not supported. | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| `anthropic-strict/ref-external` | error | no | External $ref is not supported. | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| `anthropic-strict/tool-name` | error | yes | Tool names must match ^[a-zA-Z0-9_-]{1,128}$; the name is rewritten and the proxy maps it back. | https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use |
| `anthropic-strict/root-type` | warning | yes | The root schema needs type "object". | https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use |
| `anthropic-strict/root-object` | error | no | The root schema must be an object schema. | https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use |
