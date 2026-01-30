# Feature: Phase 2 — Audit & Plan Agent

The following plan should be complete, but validate documentation and codebase patterns before implementing.

Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

Build the main tagging agent entry point (`tagging-agent.ts`) and tag scheme module (`tag-scheme.ts`) that enable two CLI modes: **audit** (scan all vault notes, catalog every tag with frequencies, identify noise, write `_Tag Audit Report.md`) and **plan** (read audit report + proposed tagging system note, classify every tag, produce per-note migration plan, write `_Tag Migration Plan.md`). The agent uses Claude Agent SDK's `query()` with in-process MCP tools built in Phase 1.

## User Story

As a vault owner
I want the agent to audit all tags and produce a reviewable migration plan
So that I can understand the current state and approve changes before execution

## Problem Statement

The vault has ~884 notes with inconsistent tags — mixed inline/frontmatter, no hierarchy, noise tags from Google Docs. Manual audit is impractical. The agent needs to scan everything, classify tags against a proposed scheme, and produce actionable reports the user can review in Obsidian before any changes are made.

## Solution Statement

Create `tagging-agent.ts` as the CLI entry point that loads config, assembles all Phase 1 MCP tools into an in-process server, constructs mode-specific system prompts, and runs `query()` with streaming input. Create `tag-scheme.ts` exporting a Zod schema for the tag scheme structure and hardcoded noise patterns. The agent reads the `Proposed Tagging System.md` vault note at runtime for scheme definitions. Audit and plan modes are separate CLI invocations with independent budgets.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium-High
**Primary Systems Affected**: `tagging-agent.ts` (new), `tag-scheme.ts` (new), `package.json` (update scripts), `tests/` (new test files)
**Dependencies**: `@anthropic-ai/claude-agent-sdk` (query, createSdkMcpServer), `zod`, all Phase 1 modules

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING

- `reference/workshop/advanced-agent.ts` (lines 82-88, 170-268) — Pattern for `createSdkMcpServer()` assembly, streaming input `async function*`, `query()` options with `mcpServers`, `permissionMode`, `maxBudgetUsd`, `systemPrompt`, and the `for await` message loop
- `reference/workshop/demo/mcp-servers.ts` — MCP tool naming convention: tools are referenced in `allowedTools` as `mcp__<server-name>__<tool-name>`
- `reference/workshop/agent.ts` (lines 30-41, 87-124) — Simple agent pattern: config from env/CLI args, prompt construction, `query()` with streaming, message type handling (`system/init`, `assistant`, `result`)
- `tools/vault-tools.ts` — Exports `createVaultTools(vaultPath)` returning 4 tools: `list_notes`, `read_note`, `search_notes`, `write_note`
- `tools/tag-tools.ts` — Exports `createTagTools(vaultPath)` returning 1 tool: `apply_tag_changes`
- `tools/git-tools.ts` — Exports `createGitTools(vaultPath)` returning 1 tool: `git_commit`
- `lib/config.ts` — Exports `Config` type and `loadConfig()` function. Fields: `vaultPath`, `agentMode`, `batchSize`, `maxBudgetUsd`, `agentModel`
- `tests/test-tools-smoke.ts` — Pattern for smoke tests using `bun:test` with `describe`/`test`/`expect`
- `PRD.md` (Section 7, lines 174-296) — Tool specs with exact input/output contracts
- `PRD.md` (Section 6, lines 107-173) — Architecture: phased execution, MCP tool boundary, vault-native reporting, git checkpoint pattern
- `PRD.md` (Section 10, lines 369-386) — CLI interface: `bun run tagging-agent.ts audit`, `bun run tagging-agent.ts plan`
- `PRD.md` (Section 12, Phase 2, lines 436-448) — Phase 2 deliverables checklist

### New Files to Create

- `tag-scheme.ts` — Zod schema for tag scheme structure, noise pattern constants, scheme note path
- `tagging-agent.ts` — Main CLI entry point with audit and plan modes
- `tests/test-tag-scheme.ts` — Unit tests for tag scheme Zod validation
- `tests/test-agent-prompts.ts` — Unit tests for system prompt construction and mode selection

### Relevant Documentation — READ BEFORE IMPLEMENTING

- [Claude Agent SDK TypeScript Reference](https://docs.anthropic.com/en/docs/agents/agent-sdk) — `query()` options, `createSdkMcpServer()`, streaming input mode, message types
- [Claude Agent SDK Custom Tools](https://docs.anthropic.com/en/docs/agents/custom-tools) — Streaming input requirement for in-process MCP servers
- `reference/adding_tools_guide.md` — Tool docstring template (already followed in Phase 1 tools)

### Patterns to Follow

**Streaming input for in-process MCP servers** (from `reference/workshop/advanced-agent.ts:202-210`):
```typescript
async function* streamPrompt() {
  yield {
    type: "user" as const,
    message: {
      role: "user" as const,
      content: [{ type: "text" as const, text: promptText }],
    },
  };
}
```

**MCP server assembly and query wiring** (from `reference/workshop/advanced-agent.ts:83-87, 212-242`):
```typescript
const customServer = createSdkMcpServer({
  name: "server-name",
  version: "1.0.0",
  tools: [tool1, tool2],
});

for await (const message of query({
  prompt: streamPrompt(),
  options: {
    mcpServers: { "server-name": customServer },
    allowedTools: ["mcp__server-name__tool1", "mcp__server-name__tool2"],
    permissionMode: "bypassPermissions",
    maxBudgetUsd: 2.0,
    systemPrompt: "...",
  },
})) { ... }
```

**Tool naming convention**: `mcp__<server-name>__<tool-name>` in `allowedTools`. For a server named `"vault"` with tool `list_notes`, the allowed tool name is `"mcp__vault__list_notes"`.

**Message loop pattern** (from `reference/workshop/agent.ts:99-124`):
```typescript
for await (const message of query({ prompt, options })) {
  if (message.type === "assistant" && message.message?.content) {
    for (const block of message.message.content) {
      if ("text" in block) { console.log(block.text); }
      else if ("name" in block) { console.log(`[Tool: ${block.name}]`); }
    }
  } else if (message.type === "result") {
    if (message.subtype === "success") {
      result = message.result;
      totalCost = message.total_cost_usd;
    } else {
      console.error(`Agent ended with error: ${message.subtype}`);
    }
  }
}
```

**Config loading** (from `lib/config.ts`):
```typescript
import { loadConfig } from "./lib/config.js";
const config = loadConfig();
// config.vaultPath, config.agentMode, config.maxBudgetUsd, config.agentModel
```

**Naming conventions** (from `CLAUDE.md`):
- Kebab-case filenames: `tag-scheme.ts`, `tagging-agent.ts`
- No default exports — use named exports only
- `bun:test` for testing with `describe`/`test`/`expect`

---

## IMPLEMENTATION PLAN

### Phase 2A: Tag Scheme Module

Create `tag-scheme.ts` with: Zod schema defining the tag scheme structure (categories, mappings, removals), hardcoded noise tag patterns, the vault path constant for the scheme note, and a validation function. This module provides the structural contract — the agent reads the actual scheme from the vault note at runtime.

### Phase 2B: System Prompts

Define system prompts for audit and plan modes within `tagging-agent.ts`. These are the critical instructions that drive agent behavior — they specify which tools to use, in what order, and what output format to produce.

### Phase 2C: Agent Entry Point

Create `tagging-agent.ts` with: CLI arg parsing (mode override), config loading, MCP server assembly, streaming input construction, query execution, and result reporting. Supports `audit` and `plan` modes (execute and verify are Phase 3).

### Phase 2D: Tests

Unit tests for: tag scheme Zod validation (valid/invalid schemas), system prompt construction (correct mode selection, prompt content), and config-to-query-options wiring.

---

## STEP-BY-STEP TASKS

### Task 1: CREATE `tag-scheme.ts`

- **IMPLEMENT**: Named exports:

  - `TagCategory` Zod schema:
    ```typescript
    export const TagCategorySchema = z.object({
      prefix: z.string(),
      description: z.string().optional(),
      tags: z.array(z.string()),
    });
    ```

  - `TagMapping` Zod schema:
    ```typescript
    export const TagMappingSchema = z.object({
      from: z.array(z.string()),
      to: z.string().nullable(), // null means REMOVE
    });
    ```

  - `TagScheme` Zod schema:
    ```typescript
    export const TagSchemeSchema = z.object({
      categories: z.array(TagCategorySchema),
      mappings: z.array(TagMappingSchema),
      removals: z.array(z.string()),
    });
    export type TagScheme = z.infer<typeof TagSchemeSchema>;
    ```

  - `parseTagScheme(raw: unknown): TagScheme` — validates unknown input against the schema, throws on invalid
  - `NOISE_TAG_PATTERNS` — hardcoded array of known noise patterns. These are detection rules that don't depend on the scheme note:
    ```typescript
    export const NOISE_TAG_PATTERNS = {
      exact: ["heading"],
      prefixes: ["follow-up-required-"],
      containsChars: ["="],
    };
    ```
  - `SCHEME_NOTE_PATH` — constant string: `"Proposed Tagging System.md"` (the vault-relative path to the scheme note)

- **IMPORTS**: `z` from `"zod"`
- **GOTCHA**: The `to` field in `TagMappingSchema` is `z.string().nullable()` — `null` means remove the tag entirely (same pattern as `apply_tag_changes` in `tools/tag-tools.ts`). Keep the schema flexible — the agent extracts this at runtime from the vault note and the shape may vary.
- **VALIDATE**: `bun run tag-scheme.ts` — no crash (module-level defines schemas but doesn't execute)

### Task 2: CREATE `tests/test-tag-scheme.ts`

- **IMPLEMENT**: Unit tests using `bun:test`:
  - `parseTagScheme` accepts valid scheme with categories, mappings, and removals
  - `parseTagScheme` accepts scheme with empty arrays (minimal valid scheme)
  - `parseTagScheme` rejects missing `categories` field
  - `parseTagScheme` rejects mapping with invalid shape (missing `from` or `to`)
  - `parseTagScheme` accepts mapping with `to: null` (removal mapping)
  - `NOISE_TAG_PATTERNS` contains expected patterns (exact `"heading"`, prefix `"follow-up-required-"`, contains `"="`)
  - `SCHEME_NOTE_PATH` equals `"Proposed Tagging System.md"`
- **PATTERN**: Follow `tests/test-tools-smoke.ts` structure — `describe`/`test`/`expect`
- **IMPORTS**: `describe, test, expect` from `bun:test`, all exports from `../tag-scheme.js`
- **VALIDATE**: `bun test tests/test-tag-scheme.ts`

### Task 3: CREATE system prompt functions in `tagging-agent.ts` (prompts only, no query wiring yet)

- **IMPLEMENT**: Named exports for system prompt construction. These are the critical instructions that drive agent behavior.

  **`buildAuditSystemPrompt(config: Config): string`** — Returns the audit mode system prompt. Must instruct the agent to:
  1. Call `list_notes({ recursive: true })` to get the full vault inventory
  2. For each note, call `read_note({ path, detail: "minimal" })` to get tags (emphasize "minimal" for budget efficiency — ~50 tokens per note vs ~2000 for "full")
  3. Catalog every unique tag with: frequency count, which notes use it, whether it's inline or frontmatter, whether it's a noise tag
  4. Read the `Proposed Tagging System.md` note using `read_note({ path: "Proposed Tagging System.md", detail: "full" })` to understand the target scheme
  5. Classify each tag: maps to scheme, unmapped (needs decision), noise (remove)
  6. Write `_Tag Audit Report.md` using `write_note` with a structured markdown format including: summary stats, tag frequency table, noise tags list, unmapped tags list, classification breakdown
  7. Call `git_commit({ message: "Audit complete: _Tag Audit Report.md" })` after writing the report
  8. Include today's date in the report

  The prompt must also state:
  - Use ONLY the MCP tools provided — no other tools
  - Process notes in batches if needed to manage context window (e.g., 100 notes at a time)
  - The audit is READ-ONLY — do not modify any notes, only write the report note
  - Tag format reference: lowercase kebab-case, valid prefixes are `status/`, `type/`, `area/`, `project/`

  **`buildPlanSystemPrompt(config: Config): string`** — Returns the plan mode system prompt. Must instruct the agent to:
  1. Read `_Tag Audit Report.md` using `read_note({ path: "_Tag Audit Report.md", detail: "full" })` — if not found, error and stop
  2. Read `Proposed Tagging System.md` using `read_note({ path: "Proposed Tagging System.md", detail: "full" })`
  3. For every tag in the audit report, determine the mapping: old tag → new tag (from scheme), or old tag → null (remove noise/obsolete), or old tag → UNMAPPED (flag for user decision)
  4. For unmapped tags, suggest where they might fit in the scheme or propose new categories
  5. Generate a per-note migration plan: for each note that needs changes, list `{ path, changes: [{ oldTag, newTag }] }`
  6. Write `_Tag Migration Plan.md` using `write_note` with structured markdown: summary, complete tag mapping table, per-note change list, unmapped tags requiring user decision, suggested scheme additions
  7. Call `git_commit({ message: "Plan complete: _Tag Migration Plan.md" })` after writing
  8. Include today's date and batch size from config in the plan

  The prompt must also state:
  - The plan is REVIEW-ONLY — do not apply any changes, only write the plan note
  - New tags must conform to lowercase kebab-case with valid prefixes
  - Deduplicate: if two old tags on the same note map to the same new tag, list once
  - The migration plan is the input for the execute phase — it must be comprehensive and machine-parseable by the execute phase agent

  **`buildUserPrompt(mode: AgentMode, config: Config): string`** — Returns the user prompt (the actual task instruction). Short and focused:
  - Audit: "Audit all tags in the vault at {vaultPath}. Write the report to _Tag Audit Report.md."
  - Plan: "Generate a tag migration plan based on the audit report. Write the plan to _Tag Migration Plan.md. Batch size for execution will be {batchSize}."
  - Execute/Verify: throw error — "Mode '{mode}' is not yet implemented (Phase 3)"

- **PATTERN**: System prompts follow the pattern in `reference/workshop/advanced-agent.ts:238-240` — include today's date, role description, and specific workflow steps.
- **GOTCHA**: System prompts are long. That's intentional — they're the agent's primary instruction set. Keep them as structured lists, not prose. Use markdown formatting for clarity since the agent reads them.
- **GOTCHA**: The tool names in the system prompt must match the MCP naming convention. Since the server will be named `"vault"`, tools are `mcp__vault__list_notes`, `mcp__vault__read_note`, etc. However, in the system prompt, just reference tools by their short names (`list_notes`, `read_note`) since the agent SDK resolves them. The `allowedTools` option is where the full `mcp__vault__*` names go.
- **VALIDATE**: `bun run tagging-agent.ts` — should fail with "VAULT_PATH environment variable is required" (config validation, not prompt code). This confirms the module loads without syntax errors.

### Task 4: CREATE `tests/test-agent-prompts.ts`

- **IMPLEMENT**: Unit tests using `bun:test`:
  - `buildAuditSystemPrompt` returns string containing key instructions: "list_notes", "read_note", "minimal", "_Tag Audit Report.md", "write_note", "git_commit", "READ-ONLY"
  - `buildAuditSystemPrompt` includes today's date
  - `buildPlanSystemPrompt` returns string containing key instructions: "_Tag Audit Report.md", "Proposed Tagging System.md", "_Tag Migration Plan.md", "write_note", "git_commit", "REVIEW-ONLY"
  - `buildPlanSystemPrompt` includes batch size from config
  - `buildUserPrompt` returns correct prompt for "audit" mode
  - `buildUserPrompt` returns correct prompt for "plan" mode
  - `buildUserPrompt` throws for "execute" mode (Phase 3)
  - `buildUserPrompt` throws for "verify" mode (Phase 3)
- **PATTERN**: Follow `tests/test-tools-smoke.ts` structure
- **IMPORTS**: `describe, test, expect` from `bun:test`, prompt functions from `../tagging-agent.js`
- **GOTCHA**: To test prompt functions without triggering `loadConfig()` at module level, the prompt functions must be importable independently. This means `tagging-agent.ts` must not call `loadConfig()` at module level — only inside the `main()` function. The prompt builder functions accept a `Config` object as parameter, so tests can pass a mock config.
- **VALIDATE**: `bun test tests/test-agent-prompts.ts`

### Task 5: IMPLEMENT agent wiring in `tagging-agent.ts`

- **IMPLEMENT**: The main execution logic. Structure:

  ```typescript
  import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
  import { loadConfig, type Config, type AgentMode } from "./lib/config.js";
  import { createVaultTools } from "./tools/vault-tools.js";
  import { createTagTools } from "./tools/tag-tools.js";
  import { createGitTools } from "./tools/git-tools.js";

  // ... prompt builder functions (from Task 3) ...

  function buildMcpServer(vaultPath: string) {
    const vaultTools = createVaultTools(vaultPath);
    const tagTools = createTagTools(vaultPath);
    const gitTools = createGitTools(vaultPath);
    const allTools = [...vaultTools, ...tagTools, ...gitTools];

    return createSdkMcpServer({
      name: "vault",
      version: "1.0.0",
      tools: allTools,
    });
  }

  function getAllowedTools(): string[] {
    return [
      "mcp__vault__list_notes",
      "mcp__vault__read_note",
      "mcp__vault__search_notes",
      "mcp__vault__write_note",
      "mcp__vault__apply_tag_changes",
      "mcp__vault__git_commit",
    ];
  }

  async function runAgent(config: Config) {
    // Override mode from CLI arg if provided
    const modeArg = process.argv[2] as AgentMode | undefined;
    const mode = modeArg && ["audit", "plan", "execute", "verify"].includes(modeArg)
      ? modeArg as AgentMode
      : config.agentMode;

    console.log("=".repeat(60));
    console.log("Obsidian Vault Tagging Agent");
    console.log("=".repeat(60));
    console.log(`Mode: ${mode}`);
    console.log(`Vault: ${config.vaultPath}`);
    console.log(`Budget: $${config.maxBudgetUsd}`);
    console.log(`Model: ${config.agentModel}`);
    console.log("=".repeat(60));
    console.log();

    // Build system prompt based on mode
    let systemPrompt: string;
    if (mode === "audit") {
      systemPrompt = buildAuditSystemPrompt(config);
    } else if (mode === "plan") {
      systemPrompt = buildPlanSystemPrompt(config);
    } else {
      throw new Error(`Mode "${mode}" is not yet implemented (Phase 3)`);
    }

    const userPrompt = buildUserPrompt(mode, config);

    // Assemble MCP server
    const server = buildMcpServer(config.vaultPath);

    // Streaming input (required for in-process MCP server)
    async function* streamPrompt() {
      yield {
        type: "user" as const,
        message: {
          role: "user" as const,
          content: [{ type: "text" as const, text: userPrompt }],
        },
      };
    }

    const startTime = Date.now();
    let finalResult = "";
    let totalCost = 0;

    // Run the agent
    for await (const message of query({
      prompt: streamPrompt(),
      options: {
        mcpServers: { vault: server },
        allowedTools: getAllowedTools(),
        permissionMode: "bypassPermissions",
        maxBudgetUsd: config.maxBudgetUsd,
        model: config.agentModel,
        systemPrompt,
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block) {
            console.log(block.text);
            finalResult = block.text;
          } else if ("name" in block) {
            console.log(`[Tool: ${block.name}]`);
          }
        }
      } else if (message.type === "result") {
        if (message.subtype === "success") {
          finalResult = message.result || finalResult;
          totalCost = message.total_cost_usd || 0;
        } else {
          console.error(`Agent error: ${message.subtype}`);
          if ("errors" in message) {
            console.error(message.errors);
          }
          process.exit(1);
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log();
    console.log("=".repeat(60));
    console.log(`Mode: ${mode} complete`);
    console.log(`Duration: ${duration}s`);
    console.log(`Cost: $${totalCost.toFixed(4)}`);
    console.log("=".repeat(60));
  }

  // Main
  runAgent(loadConfig()).catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
  ```

- **PATTERN**: Follows `reference/workshop/advanced-agent.ts` for MCP wiring and `reference/workshop/agent.ts` for CLI structure
- **IMPORTS**: `query`, `createSdkMcpServer` from SDK; `loadConfig`, `Config`, `AgentMode` from `lib/config.js`; tool factory functions from `tools/*.js`
- **GOTCHA**: The `query()` call must use streaming input (`streamPrompt()` generator) because we use `createSdkMcpServer`. A plain string prompt will NOT work with in-process MCP servers.
- **GOTCHA**: `process.argv[2]` provides CLI mode override (e.g., `bun run tagging-agent.ts audit`). Falls back to `config.agentMode` from env var.
- **GOTCHA**: For audit mode, the agent may need many turns to process 884 notes. Do NOT set `maxTurns` — let it run until complete or budget is exhausted. The `maxBudgetUsd` is the safety net.
- **GOTCHA**: `allowedTools` must use the `mcp__vault__<tool>` naming since the server is named `"vault"`. If the names don't match, the agent won't be able to call the tools.
- **VALIDATE**: `bun run tagging-agent.ts` — should fail with "VAULT_PATH environment variable is required" (confirms module loads and config validation works). With env set: `VAULT_PATH=/tmp/test-vault bun run tagging-agent.ts audit` — should attempt to run (will fail on vault access, but confirms wiring).

### Task 6: UPDATE `package.json` scripts

- **IMPLEMENT**: Add tagging agent scripts:
  ```json
  "tagging:audit": "bun run tagging-agent.ts audit",
  "tagging:plan": "bun run tagging-agent.ts plan",
  "tagging:execute": "bun run tagging-agent.ts execute",
  "tagging:verify": "bun run tagging-agent.ts verify"
  ```
- **PATTERN**: Follow existing script naming pattern in `package.json` (colon-separated namespacing like `demo:subagents`)
- **VALIDATE**: `grep tagging package.json` — should show all 4 scripts

### Task 7: VERIFY all tests pass

- **IMPLEMENT**: Run the full test suite including new tests
- **VALIDATE**: `bun test tests/test-tag-scheme.ts tests/test-agent-prompts.ts tests/test-tools-smoke.ts tests/test-frontmatter.ts tests/test-tag-parser.ts`

### Task 8: VERIFY TypeScript compilation

- **IMPLEMENT**: Run type checker
- **VALIDATE**: `bunx tsc --noEmit`

---

## TESTING STRATEGY

### Unit Tests

- `tests/test-tag-scheme.ts` — 7+ test cases: Zod schema validation (valid, empty, missing fields, nullable to), noise patterns, scheme note path
- `tests/test-agent-prompts.ts` — 8+ test cases: audit/plan prompt content verification, date inclusion, batch size inclusion, mode error handling

### Smoke Tests

- Existing `tests/test-tools-smoke.ts` still passes (no regressions)
- Module loads without crash: `bun run tagging-agent.ts` (fails at config, not syntax)
- Module loads without crash: `bun run tag-scheme.ts`

### Integration Tests (Manual, Not in Test Suite)

- Run against real vault with small budget: `VAULT_PATH=/path/to/vault MAX_BUDGET_USD=0.10 bun run tagging-agent.ts audit`
- Verify `_Tag Audit Report.md` is created in vault
- Run plan mode: `VAULT_PATH=/path/to/vault MAX_BUDGET_USD=0.50 bun run tagging-agent.ts plan`
- Verify `_Tag Migration Plan.md` is created in vault

### Edge Cases

- Missing `VAULT_PATH` env var → clear error message
- Invalid mode argument → falls back to config or errors
- Audit report missing when running plan mode → agent should error (instructed in system prompt)
- `Proposed Tagging System.md` not found → agent should report error (instructed in system prompt)
- Budget exhaustion mid-audit → `query()` returns `error_max_budget_usd` result

---

## VALIDATION COMMANDS

### Level 1: Syntax & Types

```bash
bunx tsc --noEmit
```

### Level 2: Unit Tests

```bash
bun test tests/test-tag-scheme.ts
bun test tests/test-agent-prompts.ts
```

### Level 3: All Tests (Including Phase 1)

```bash
bun test tests/test-tag-scheme.ts tests/test-agent-prompts.ts tests/test-tools-smoke.ts tests/test-frontmatter.ts tests/test-tag-parser.ts
```

### Level 4: Module Smoke Check

```bash
bun run tag-scheme.ts
bun run tagging-agent.ts 2>&1 | head -5
# Expected: "VAULT_PATH environment variable is required" error
```

### Level 5: Manual Integration (Against Real Vault)

```bash
# Audit mode (small budget for testing)
VAULT_PATH="/Users/josephfajen/git/obsidian-jpf" MAX_BUDGET_USD=0.10 bun run tagging-agent.ts audit

# Plan mode (requires audit report to exist)
VAULT_PATH="/Users/josephfajen/git/obsidian-jpf" MAX_BUDGET_USD=0.50 bun run tagging-agent.ts plan
```

---

## ACCEPTANCE CRITERIA

- [ ] `tag-scheme.ts` exports `TagSchemeSchema`, `TagCategorySchema`, `TagMappingSchema`, `parseTagScheme`, `NOISE_TAG_PATTERNS`, `SCHEME_NOTE_PATH`
- [ ] `tagging-agent.ts` exports `buildAuditSystemPrompt`, `buildPlanSystemPrompt`, `buildUserPrompt` (for testing)
- [ ] `tagging-agent.ts` runs as CLI: `bun run tagging-agent.ts audit` and `bun run tagging-agent.ts plan`
- [ ] Agent uses streaming input mode (async generator) for MCP server compatibility
- [ ] Agent assembles all 6 Phase 1 MCP tools into a single in-process server named `"vault"`
- [ ] `allowedTools` uses correct `mcp__vault__<tool>` naming
- [ ] Audit system prompt instructs: `list_notes` → `read_note` (minimal) → catalog → `write_note` report → `git_commit`
- [ ] Plan system prompt instructs: read audit report → read scheme note → classify → `write_note` plan → `git_commit`
- [ ] Plan prompt references batch size from config
- [ ] Execute/verify modes throw "not yet implemented" error
- [ ] `package.json` has `tagging:audit`, `tagging:plan`, `tagging:execute`, `tagging:verify` scripts
- [ ] All unit tests pass: `bun test tests/test-tag-scheme.ts tests/test-agent-prompts.ts`
- [ ] All Phase 1 tests still pass (no regressions)
- [ ] `bunx tsc --noEmit` passes with no errors
- [ ] No default exports anywhere
- [ ] Kebab-case filenames

---

## COMPLETION CHECKLIST

- [ ] All 8 tasks completed in order
- [ ] Each task validation passed
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + smoke)
- [ ] No TypeScript errors
- [ ] Acceptance criteria all met

---

## NOTES

### Key Design Decisions

1. **Agent reads scheme from vault note at runtime**: Rather than hardcoding tag mappings in `tag-scheme.ts`, the agent reads `Proposed Tagging System.md` via `read_note`. This means the user can modify the scheme and re-run without code changes. `tag-scheme.ts` provides the Zod schema for validation and noise patterns, not the mappings themselves.

2. **Noise patterns are hardcoded**: Unlike scheme mappings (which come from the vault note), noise detection rules (`heading`, `follow-up-required-*`, `=`-containing tags) are hardcoded in `tag-scheme.ts`. These are detection heuristics, not scheme-dependent — they're the same regardless of what tagging scheme the user adopts.

3. **System prompts are the primary agent control mechanism**: The system prompt is where agent behavior is defined. It's intentionally verbose — specifying exact tool calls, order of operations, output format, and constraints. The user prompt is short (just the task). This separation makes it easy to iterate on agent behavior by editing prompts.

4. **No `maxTurns` limit**: The audit phase may require hundreds of tool calls (884 notes × 1 `read_note` each + `list_notes` + `write_note` + `git_commit`). Setting `maxTurns` would prematurely stop the agent. Budget (`maxBudgetUsd`) is the safety net.

5. **Prompt functions exported for testing**: `buildAuditSystemPrompt`, `buildPlanSystemPrompt`, and `buildUserPrompt` are exported so tests can verify their content without running the agent. `loadConfig()` is only called inside `runAgent()`, not at module level, enabling clean imports in tests.

6. **Single MCP server named `"vault"`**: All 6 tools from Phase 1 (4 vault + 1 tag + 1 git) are bundled into one server. This simplifies `allowedTools` (all prefixed `mcp__vault__`) and matches the architecture — the agent interacts with one vault through one tool interface.

### Risks

- **System prompt quality**: The audit and plan prompts are the most critical piece. If the agent doesn't follow instructions well (e.g., uses "full" detail instead of "minimal", skips the scheme note), results will be poor. Mitigation: test prompts against real vault with small budget, iterate.
- **Budget for audit**: Scanning 884 notes with `read_note("minimal")` at ~50 tokens per response = ~44K tokens of tool output alone, plus `list_notes` (~17K tokens), plus agent reasoning. Total may exceed $1.00. Mitigation: configurable budget, batch processing instruction in prompt.
- **Context window**: 884 note results may exceed the agent's context window. The system prompt instructs batch processing, but the agent may not do it perfectly. Mitigation: explicit batching instructions, consider adding `maxTurns` as an escape hatch in future iterations.
