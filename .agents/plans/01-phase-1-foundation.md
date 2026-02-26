---
status: IMPLEMENTED
implemented_date: 2026-01-29
commit: 25ae891
---

# Feature: Phase 1 Foundation — Lib Layer, MCP Tools, and Unit Tests

The following plan has been implemented.

Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

Build the foundation layer for the Obsidian vault tagging agent: library utilities for frontmatter parsing, inline tag extraction, and configuration; MCP tool definitions for vault access (list, read, search, write notes), tag operations (apply changes), and git commits; and unit tests validating the core parsing logic. This is PRD Phase 1 — everything the agent needs to interact with the vault, without the agent itself.

## User Story

As a developer building the tagging agent
I want tested MCP tools and parsing utilities
So that the agent can safely read, search, write, and retag vault notes through a structured tool interface

## Problem Statement

The tagging agent needs a well-tested foundation of vault access tools and parsing utilities before agent behavior can be built on top. All vault interaction must go through MCP tools (never raw fs from agent code), frontmatter must be parsed with gray-matter, and inline tags must be extracted while skipping code blocks.

## Solution Statement

Implement three library modules (`lib/config.ts`, `lib/frontmatter.ts`, `lib/tag-parser.ts`), three tool modules (`tools/vault-tools.ts`, `tools/tag-tools.ts`, `tools/git-tools.ts`), and unit tests. Tools follow the agent-optimized docstring template from `reference/adding_tools_guide.md` and use Zod schemas for input validation. The MCP server is assembled but not wired to an agent yet.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium
**Primary Systems Affected**: `lib/`, `tools/`, `tests/`, `package.json`
**Dependencies**: `gray-matter` (new), `zod` (existing), `@anthropic-ai/claude-agent-sdk` (existing)

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING

- `reference/workshop/advanced-agent.ts` (lines 31-87) — Pattern for `tool()` definition with Zod schemas, `createSdkMcpServer()` assembly
- `reference/workshop/demo/mcp-servers.ts` (lines 39-161) — More tool examples with optional params, enum schemas, error returns
- `reference/adding_tools_guide.md` (entire file) — **MANDATORY**: Template for agent-optimized tool docstrings. Every tool description must include: one-line summary, "Use this when", "Do NOT use this for", performance notes, examples
- `PRD.md` (Section 7, lines 174-296) — Complete tool specifications: inputs, outputs, behaviors, examples for all 6 tools
- `PRD.md` (Section 6, lines 107-173) — Architecture, directory structure, design patterns
- `CLAUDE.md` (entire file) — Project conventions: kebab-case files, no default exports, gray-matter for frontmatter, tag format rules
- `.env.example` — Current env var format (needs vault-specific vars added)
- `tests/test-mcp.ts` — Existing MCP test pattern using `tool()`, `createSdkMcpServer()`, streaming input mode

### New Files to Create

- `lib/config.ts` — Environment variable loading and validation
- `lib/frontmatter.ts` — gray-matter wrapper for safe YAML frontmatter parsing/serialization
- `lib/tag-parser.ts` — Extract inline tags and frontmatter tags, identify noise tags, skip code blocks
- `tools/vault-tools.ts` — MCP tools: `list_notes`, `read_note`, `search_notes`, `write_note`
- `tools/tag-tools.ts` — MCP tool: `apply_tag_changes`
- `tools/git-tools.ts` — MCP tool: `git_commit`
- `tests/test-frontmatter.ts` — Unit tests for frontmatter parsing
- `tests/test-tag-parser.ts` — Unit tests for tag extraction (including code block skipping, noise detection)
- `tests/test-tools-smoke.ts` — Smoke test: assemble MCP server, verify tools register

### Relevant Documentation — READ BEFORE IMPLEMENTING

- [gray-matter GitHub](https://github.com/jonschlinkert/gray-matter) — API: `matter(str)` returns `{ data, content, orig, stringify() }`. `matter.stringify(content, data)` serializes back. `matter.test(str)` checks for frontmatter.
- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) — Full API for `tool()`, `createSdkMcpServer()`, `CallToolResult` type, `McpSdkServerConfigWithInstance`

### Patterns to Follow

**Tool definition pattern** (from `reference/workshop/demo/mcp-servers.ts`):
```typescript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const myTool = tool(
  "tool_name",
  `One-line summary.\n\nUse this when:\n- scenario 1\n- scenario 2\n\nDo NOT use this for:\n- anti-scenario (use other_tool instead)\n\nPerformance notes:\n- detail\n\nExamples:\n- example`,
  {
    param: z.string().describe("Description"),
    optional_param: z.enum(["a", "b"]).optional().describe("Description"),
  },
  async ({ param, optional_param = "a" }) => {
    // implementation
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  }
);

const server = createSdkMcpServer({
  name: "server-name",
  version: "1.0.0",
  tools: [myTool],
});
```

**Naming conventions** (from `CLAUDE.md`):
- Kebab-case filenames: `vault-tools.ts`, `tag-parser.ts`
- No default exports — use named exports only
- Tag format: lowercase kebab-case with hierarchical prefixes (`status/`, `type/`, `area/`, `project/`)

**Error return pattern** (from MCP tool examples):
```typescript
return {
  content: [{ type: "text" as const, text: "Error: description" }],
  isError: true,
};
```

**gray-matter API**:
```typescript
import matter from "gray-matter";

// Parse
const { data, content } = matter("---\ntags: [foo]\n---\nBody");
// data = { tags: ["foo"] }, content = "Body"

// Stringify back
const output = matter.stringify("Body", { tags: ["foo", "bar"] });
// "---\ntags:\n  - foo\n  - bar\n---\nBody"

// Test if string has frontmatter
matter.test("---\nfoo: bar\n---"); // true
```

---

## IMPLEMENTATION PLAN

### Phase 1A: Dependencies and Config

Add `gray-matter` dependency. Create `lib/config.ts` for environment variable loading. Update `.env.example` with vault-specific variables.

### Phase 1B: Library Utilities

Create `lib/frontmatter.ts` wrapping gray-matter for safe parse/serialize. Create `lib/tag-parser.ts` for inline tag extraction (with code block skipping) and noise tag identification.

### Phase 1C: MCP Tool Definitions

Create all 6 MCP tools across 3 files, following PRD Section 7 specs and the adding_tools_guide docstring template. Each tool uses Zod schemas and returns `CallToolResult`.

### Phase 1D: Tests

Unit tests for frontmatter parsing and tag extraction with representative vault samples. Smoke test for MCP server assembly.

---

## STEP-BY-STEP TASKS

### Task 1: ADD gray-matter dependency

- **IMPLEMENT**: Run `bun add gray-matter` to add the dependency
- **VALIDATE**: `bun install && grep gray-matter package.json`

### Task 2: UPDATE `.env.example` with vault-specific variables

- **IMPLEMENT**: Add `VAULT_PATH`, `AGENT_MODE`, `BATCH_SIZE`, `MAX_BUDGET_USD` (renamed from original), `AGENT_MODEL` variables per PRD Section 9
- **PATTERN**: Follow existing `.env.example` comment style
- **VALIDATE**: `cat .env.example` — should contain all PRD env vars

### Task 3: CREATE `lib/config.ts`

- **IMPLEMENT**: Named exports for config loading. Load from `process.env` with defaults. Validate `VAULT_PATH` exists (required). Export a `Config` type and `loadConfig()` function.
- **FIELDS**: `vaultPath: string` (required, from `VAULT_PATH`), `agentMode: "audit" | "plan" | "execute" | "verify"` (default `"audit"`, from `AGENT_MODE`), `batchSize: number` (default `50`, from `BATCH_SIZE`), `maxBudgetUsd: number` (default `1.0`, from `MAX_BUDGET_USD`), `agentModel: string` (default `"claude-sonnet-4-20250514"`, from `AGENT_MODEL`)
- **GOTCHA**: Do NOT import `fs` — config just reads env vars. Vault path existence check happens at tool layer.
- **VALIDATE**: `bun run lib/config.ts` — should not crash (but will warn about missing VAULT_PATH)

### Task 4: CREATE `lib/frontmatter.ts`

- **IMPLEMENT**: Named exports wrapping gray-matter:
  - `parseFrontmatter(raw: string)`: Returns `{ data: Record<string, unknown>, content: string, hasFrontmatter: boolean }`. Uses `matter()` and `matter.test()`.
  - `serializeFrontmatter(content: string, data: Record<string, unknown>)`: Returns string with YAML frontmatter prepended. Uses `matter.stringify()`.
  - `getFrontmatterTags(data: Record<string, unknown>)`: Extracts `tags` field from parsed frontmatter data, normalizes to `string[]`. Handles: array of strings, single string, missing/null (returns `[]`).
  - `setFrontmatterTags(data: Record<string, unknown>, tags: string[])`: Returns new data object with `tags` field set. Preserves all other fields.
- **IMPORTS**: `import matter from "gray-matter"`
- **GOTCHA**: gray-matter uses default export. The `data` object from gray-matter is mutable — always spread/clone when modifying to avoid side effects. Tags in frontmatter can be `string`, `string[]`, or missing — handle all cases.
- **VALIDATE**: `bun run lib/frontmatter.ts` — no crash

### Task 5: CREATE `lib/tag-parser.ts`

- **IMPLEMENT**: Named exports:
  - `extractInlineTags(content: string)`: Returns `string[]` of tags found in markdown body (without `#` prefix). Must skip fenced code blocks (``` and ~~~) and inline code (`backticks`). Tag regex: `#([a-zA-Z0-9][a-zA-Z0-9_/-]*)` but exclude matches inside code blocks or URLs.
  - `isNoiseTag(tag: string)`: Returns `boolean`. Noise patterns: tags containing `=` (Google Docs anchors like `heading=h.xxxxx`), tags matching `follow-up-required-*`, tag exactly `heading` (standalone).
  - `classifyTags(allTags: string[])`: Returns `{ validTags: string[], noiseTags: string[] }` splitting tags by `isNoiseTag`.
  - `normalizeTag(tag: string)`: Returns lowercase kebab-case tag. Converts underscores to hyphens, lowercases.
  - `isValidTagFormat(tag: string)`: Returns `boolean`. Valid = lowercase, kebab-case, optionally with one hierarchical prefix (`status/`, `type/`, `area/`, `project/`).
- **GOTCHA**: The code block skipping is the hardest part. Strategy: strip fenced code blocks first (regex for ```...``` and ~~~...~~~), strip inline code (`...`), then extract tags from remaining text. Also skip tags that appear inside markdown links `[text](url#fragment)` — the `#fragment` is not a tag.
- **VALIDATE**: `bun run lib/tag-parser.ts` — no crash

### Task 6: CREATE `tools/vault-tools.ts`

- **IMPLEMENT**: Four MCP tools using `tool()` from the SDK. All tools receive the vault path via closure (passed at server creation time, not from env at tool-call time).

  **`list_notes`**:
  - Input: `{ path?: string, recursive?: boolean }` (Zod schema)
  - Reads the vault directory (or subdirectory) using `fs/promises` `readdir`
  - Returns array of `{ path, hasFrontmatter, tagCount }` as JSON text
  - Uses `parseFrontmatter` and `getFrontmatterTags` from `lib/frontmatter.ts`
  - Filters to `.md` files only
  - Description follows adding_tools_guide template (see PRD Section 7 for exact spec)

  **`read_note`**:
  - Input: `{ path: string, detail?: "minimal" | "standard" | "full" }` (Zod schema with enum)
  - Reads single `.md` file, parses frontmatter, extracts inline tags, classifies noise
  - Returns JSON with: `path`, `frontmatter`, `content` (truncated by detail level), `frontmatterTags`, `inlineTags`, `allTags`, `noiseTags`
  - Detail levels: `minimal` = tags only, `standard` = tags + first 200 chars, `full` = everything
  - Uses `parseFrontmatter`, `getFrontmatterTags`, `extractInlineTags`, `classifyTags`

  **`search_notes`**:
  - Input: `{ tag?: string, text?: string, directory?: string }` (at least one of tag/text required — validate in handler)
  - Scans vault files matching criteria, returns `{ path, matchContext }[]`
  - For tag search: check both frontmatter tags and inline tags
  - For text search: simple substring/regex match on file content

  **`write_note`**:
  - Input: `{ path: string, content: string, frontmatter?: z.record(z.unknown()).optional() }` — native Zod record schema (experimentally verified to work with SDK `tool()`)
  - Writes markdown file to vault. Uses `serializeFrontmatter` if frontmatter provided.
  - Validates path is within vault (no path traversal — reject `..`)
  - Creates parent directories if needed

- **EXPORTS**: Export each tool individually AND export a `createVaultTools(vaultPath: string)` function that returns all 4 tools bound to the vault path.
- **IMPORTS**: `tool` from SDK, `z` from zod, fs/promises, path, lib modules
- **GOTCHA**: All filesystem paths must be resolved relative to `vaultPath` and validated to stay within it. Use `path.resolve()` and check the resolved path starts with the vault path. Tool descriptions are the agent's contract — invest in making them match the PRD specs and the adding_tools_guide template.
- **GOTCHA**: For `list_notes` with `recursive: true` on 884 files, use `readdir({ recursive: true })` (Node 20+ / Bun supports this).
- **VALIDATE**: `bun run tools/vault-tools.ts` — no crash (module-level won't execute tool handlers, just defines them)

### Task 7: CREATE `tools/tag-tools.ts`

- **IMPLEMENT**: One MCP tool:

  **`apply_tag_changes`**:
  - Input: `{ path: string, changes: z.array(z.object({ oldTag: z.string(), newTag: z.string().nullable() })) }` — native Zod nested schema (experimentally verified to work with SDK `tool()`)
  - Reads note, applies changes: for each change, remove `oldTag` (from inline body + frontmatter), add `newTag` to frontmatter (if not null)
  - Inline tag removal: find and remove `#oldTag` from body text (skipping code blocks)
  - Validates new tags with `isValidTagFormat` before writing
  - Deduplicates resulting frontmatter tags
  - Returns `{ success, path, tagsAdded, tagsRemoved, warnings }`
  - Warnings for: tag not found in note, duplicate after mapping, invalid new tag format

- **EXPORTS**: Export the tool AND `createTagTools(vaultPath: string)`
- **IMPORTS**: `tool` from SDK, `z` from zod, lib modules, fs/promises
- **GOTCHA**: The inline tag removal must use the same code-block-skipping logic from `tag-parser.ts`. Factor it: tag-parser should export a `removeInlineTag(content: string, tag: string): string` function.
- **VALIDATE**: `bun run tools/tag-tools.ts` — no crash

### Task 8: UPDATE `lib/tag-parser.ts` — add `removeInlineTag`

- **IMPLEMENT**: Add `removeInlineTag(content: string, tag: string): string` — removes all occurrences of `#tag` from content while skipping code blocks. Should remove the `#` prefix and the tag, handling trailing whitespace/newlines gracefully (don't leave double spaces).
- **PATTERN**: Reuse the code-block-stripping approach from `extractInlineTags`
- **VALIDATE**: Manual review — logic correctness is tested in Task 11

### Task 9: CREATE `tools/git-tools.ts`

- **IMPLEMENT**: One MCP tool:

  **`git_commit`**:
  - Input: `{ message: string }` (Zod schema)
  - Runs `git -C <vaultPath> add -A && git -C <vaultPath> commit -m "<message>"` via `Bun.spawn` or `child_process.exec`
  - Returns `{ success, commitHash }` — parse commit hash from git output
  - If nothing to commit, return success with warning

- **EXPORTS**: Export the tool AND `createGitTools(vaultPath: string)`
- **IMPORTS**: `tool` from SDK, `z` from zod
- **GOTCHA**: Use `Bun.spawn` (Bun-native) or `child_process.execSync` for simplicity. The vault may have no changes to commit — handle that gracefully (git exit code 1 with "nothing to commit").
- **VALIDATE**: `bun run tools/git-tools.ts` — no crash

### Task 10: CREATE `tests/test-frontmatter.ts`

- **IMPLEMENT**: Unit tests using `bun:test` (`describe`, `test`, `expect`):
  - Parse note with standard YAML frontmatter (tags as array)
  - Parse note with tags as single string
  - Parse note with no frontmatter
  - Parse note with complex frontmatter (aliases, cssclasses, custom fields) — verify all fields preserved
  - Parse note with empty frontmatter (`---\n---`)
  - Serialize: roundtrip parse then serialize preserves content
  - Serialize: setting tags preserves other frontmatter fields
  - `getFrontmatterTags` handles missing, null, string, array
  - `setFrontmatterTags` returns new object, doesn't mutate input
- **IMPORTS**: `describe, test, expect` from `bun:test`, lib functions
- **VALIDATE**: `bun test tests/test-frontmatter.ts`

### Task 11: CREATE `tests/test-tag-parser.ts`

- **IMPLEMENT**: Unit tests using `bun:test`:
  - Extract inline tags from plain text (`#tag1 some text #tag2`)
  - Skip tags inside fenced code blocks (```...```)
  - Skip tags inside inline code (`#not-a-tag`)
  - Skip tags inside URLs (`[link](url#fragment)`)
  - Identify noise tags: `heading`, `heading=h.abc123`, `follow-up-required-weekly`
  - Classify tags correctly (valid vs noise split)
  - Normalize tag: uppercase → lowercase, underscores → hyphens
  - Validate tag format: valid prefixed tags, invalid formats
  - `removeInlineTag`: removes tag from body, skips code blocks, no double spaces
  - Edge case: tag at start of line, tag at end of line, tag adjacent to punctuation
- **VALIDATE**: `bun test tests/test-tag-parser.ts`

### Task 12: CREATE `tests/test-tools-smoke.ts`

- **IMPLEMENT**: Smoke test using `bun:test`:
  - Import `createVaultTools`, `createTagTools`, `createGitTools`
  - Import `createSdkMcpServer` from SDK
  - Verify each create function returns the expected number of tools
  - Verify `createSdkMcpServer({ name: "vault", version: "1.0.0", tools: [...allTools] })` succeeds without error
  - Verify the server object has the expected shape (has `name`, `type: "sdk"`)
- **GOTCHA**: This test does NOT call tools or make API calls — it just verifies wiring. No vault path needed (can pass a dummy path).
- **VALIDATE**: `bun test tests/test-tools-smoke.ts`

### Task 13: VERIFY all tests pass

- **IMPLEMENT**: Run full test suite
- **VALIDATE**: `bun test tests/test-frontmatter.ts tests/test-tag-parser.ts tests/test-tools-smoke.ts`

---

## TESTING STRATEGY

### Unit Tests

- `tests/test-frontmatter.ts` — 9+ test cases covering parse, serialize, roundtrip, edge cases
- `tests/test-tag-parser.ts` — 10+ test cases covering extraction, noise detection, normalization, validation, removal
- All tests use `bun:test` framework (`describe`, `test`, `expect`)

### Smoke Tests

- `tests/test-tools-smoke.ts` — Verifies MCP server assembly, tool registration, no runtime errors on import

### Edge Cases

- Notes with no frontmatter (31% of vault)
- Notes with complex frontmatter (aliases, cssclasses, custom fields)
- Empty frontmatter blocks (`---\n---`)
- Tags inside fenced code blocks (``` and ~~~)
- Tags inside inline code backticks
- Tags inside markdown link URLs
- Google Docs anchor links (`#heading=h.xxxxx`)
- Tags with underscores, mixed case
- Duplicate tags after migration mapping
- Path traversal attempts (`../outside-vault`)

---

## VALIDATION COMMANDS

### Level 1: Syntax & Types

```bash
bunx tsc --noEmit
```

### Level 2: Unit Tests

```bash
bun test tests/test-frontmatter.ts
bun test tests/test-tag-parser.ts
bun test tests/test-tools-smoke.ts
```

### Level 3: All Tests

```bash
bun test tests/test-frontmatter.ts tests/test-tag-parser.ts tests/test-tools-smoke.ts
```

### Level 4: Module Smoke Check

```bash
bun run lib/config.ts
bun run lib/frontmatter.ts
bun run lib/tag-parser.ts
```

---

## ACCEPTANCE CRITERIA

- [ ] `gray-matter` is in `package.json` dependencies and installed
- [ ] `.env.example` contains all vault-specific env vars from PRD
- [ ] `lib/config.ts` exports `Config` type and `loadConfig()` function
- [ ] `lib/frontmatter.ts` exports `parseFrontmatter`, `serializeFrontmatter`, `getFrontmatterTags`, `setFrontmatterTags`
- [ ] `lib/tag-parser.ts` exports `extractInlineTags`, `isNoiseTag`, `classifyTags`, `normalizeTag`, `isValidTagFormat`, `removeInlineTag`
- [ ] `tools/vault-tools.ts` exports 4 MCP tools matching PRD specs + `createVaultTools()`
- [ ] `tools/tag-tools.ts` exports `apply_tag_changes` tool + `createTagTools()`
- [ ] `tools/git-tools.ts` exports `git_commit` tool + `createGitTools()`
- [ ] All tool descriptions follow `adding_tools_guide.md` template (summary, use this when, do NOT use, performance notes, examples)
- [ ] All tool inputs validated with Zod schemas
- [ ] All tests pass: `bun test tests/test-frontmatter.ts tests/test-tag-parser.ts tests/test-tools-smoke.ts`
- [ ] `bunx tsc --noEmit` passes with no errors
- [ ] No default exports anywhere
- [ ] Kebab-case filenames throughout
- [ ] Path traversal protection in vault tools (reject `..` paths)
- [ ] Code blocks skipped in tag extraction and removal

---

## COMPLETION CHECKLIST

- [ ] All 13 tasks completed in order
- [ ] Each task validation passed
- [ ] All validation commands executed successfully
- [ ] Full test suite passes
- [ ] No TypeScript errors
- [ ] Acceptance criteria all met

---

## NOTES

### Key Design Decisions

1. **Vault path via closure, not env at call time**: Tools are created with `createVaultTools(vaultPath)` which captures the path. This is cleaner than reading env vars inside tool handlers and matches the SDK's tool creation pattern.

2. **Native Zod schemas for complex tool inputs**: Experimentally verified that `z.array(z.object({...}))` and `z.record(z.unknown())` work in the SDK's `tool()` function. So `apply_tag_changes.changes` uses a proper `z.array(z.object({ oldTag: z.string(), newTag: z.string().nullable() }))` schema, and `write_note.frontmatter` uses `z.record(z.unknown()).optional()`. No JSON string workarounds needed.

3. **`removeInlineTag` lives in tag-parser, not tag-tools**: The removal logic needs the same code-block-skipping as extraction. Keeping it in the parser module avoids duplication and makes it independently testable.

4. **No agent code in this phase**: `tagging-agent.ts` and `tag-scheme.ts` are Phase 2. This phase builds and tests the tools in isolation.

5. **Bun-native APIs**: Use `Bun.spawn` for git commands, `bun:test` for testing. No Node-specific shims needed.

### Risks

- ~~**gray-matter TypeScript types**: Experimentally verified — works perfectly with Bun + TS strict. Default import, `matter()`, `matter.test()`, `matter.stringify()` all work. Roundtrip preserves all frontmatter fields. **ELIMINATED.**~~
- ~~**Nested Zod schemas in tool()**: Experimentally verified — `z.array(z.object({...}))` and `z.record(z.unknown())` both work in `tool()` and register in `createSdkMcpServer()`. **ELIMINATED.**~~
- **Bun `readdir` recursive**: Bun should support `{ recursive: true }` but verify. Fallback: manual recursive walk.
- **Tool description length**: Agent-optimized docstrings can be long. The SDK should handle this, but watch for any truncation.
