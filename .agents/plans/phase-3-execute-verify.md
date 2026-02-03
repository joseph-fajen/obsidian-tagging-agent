---
status: IMPLEMENTED
implemented_date: 2026-01-30
commit: 4480214
---

# Feature: Phase 3 — Execute & Verify Agent Modes

The following plan has been implemented.

Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

Add two new agent modes to the tagging agent: **execute** (apply the migration plan to vault notes in batches with git safety) and **verify** (post-migration audit confirming full compliance). Execute mode reads `_Tag Migration Plan.md`, processes one batch of notes per invocation using `apply_tag_changes`, and wraps each batch in git commits. Verify mode performs a fresh full-vault scan checking for zero inline tags, full scheme compliance, and no content corruption, then writes `_Tag Migration Verification.md`.

## User Story

As a vault owner
I want the agent to apply the migration plan and verify the results
So that all tags are migrated to the hierarchical scheme safely with git rollback

## Problem Statement

Phases 1-2 built the tools and the audit/plan modes. The agent can catalog tags and produce a migration plan, but cannot yet apply changes or confirm results. Execute and verify modes complete the audit → plan → execute → verify lifecycle.

## Solution Statement

Add `buildExecuteSystemPrompt(config)` and `buildVerifySystemPrompt(config)` to `tagging-agent.ts`, update `buildUserPrompt` to handle execute/verify modes, and wire them into the `runAgent()` mode dispatch. Update tests to verify prompt content instead of asserting throws. No new files or tools needed — this is purely prompt engineering + mode wiring in the existing entry point.

## Feature Metadata

**Feature Type**: New Capability (extending existing agent)
**Estimated Complexity**: Medium
**Primary Systems Affected**: `tagging-agent.ts` (update), `tests/test-agent-prompts.ts` (update)
**Dependencies**: All Phase 1 MCP tools (already built), Phase 2 agent entry point (already built)

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING

- `tagging-agent.ts` (lines 12-49) — `buildAuditSystemPrompt` pattern: role statement, workflow steps as numbered list, constraints section, tool references by short name
- `tagging-agent.ts` (lines 51-87) — `buildPlanSystemPrompt` pattern: reads prerequisite note, produces output note, states REVIEW-ONLY constraint
- `tagging-agent.ts` (lines 89-97) — `buildUserPrompt` mode dispatch: returns short task string per mode, throws for unimplemented modes
- `tagging-agent.ts` (lines 131-155) — `runAgent()` mode selection: if/else chain building systemPrompt, currently throws for execute/verify
- `tagging-agent.ts` (lines 1-6) — imports: `query`, `createSdkMcpServer` from SDK, `loadConfig`, `Config`, `AgentMode` from config, tool factories, `SCHEME_NOTE_PATH` from tag-scheme
- `tests/test-agent-prompts.ts` (lines 84-91) — current tests asserting execute/verify throw "not yet implemented"
- `tests/test-agent-prompts.ts` (lines 1-11) — test setup: mockConfig, imports from `../tagging-agent.js` and `../lib/config.js`
- `tests/test-agent-prompts.ts` (lines 13-39) — audit prompt test pattern: verify key strings exist in prompt output
- `PRD.md` (lines 449-458) — Phase 3 deliverables: execute with batch processing + git commits, verify scanning for remaining inline tags and scheme violations
- `PRD.md` (lines 375-386) — CLI interface: `bun run tagging-agent.ts execute`, `bun run tagging-agent.ts verify`
- `PRD.md` (lines 255-296) — `apply_tag_changes` and `git_commit` tool specs (the tools execute mode will instruct the agent to use)
- `PRD.md` (lines 393-406) — Functional requirements for execute/verify: all tags in YAML frontmatter, lowercase kebab-case, hierarchical prefixes correct, noise tags removed, zero inline tags remaining
- `tag-scheme.ts` (lines 28-32) — `NOISE_TAG_PATTERNS` and `SCHEME_NOTE_PATH` constants referenced in prompts

### Files to Modify

- `tagging-agent.ts` — Add `buildExecuteSystemPrompt`, `buildVerifySystemPrompt`, update `buildUserPrompt`, update `runAgent()` mode dispatch
- `tests/test-agent-prompts.ts` — Replace throw assertions with content verification tests for execute/verify prompts

### No New Files to Create

All changes are modifications to existing files.

### Relevant Documentation — READ BEFORE IMPLEMENTING

- `PRD.md` Section 12 Phase 3 (lines 449-458) — Deliverables checklist
- `PRD.md` Section 11 (lines 389-406) — Success criteria and functional requirements

### Patterns to Follow

**System prompt structure** (extracted from `buildAuditSystemPrompt` in `tagging-agent.ts:12-49`):
```typescript
export function buildXxxSystemPrompt(config: Config): string {
  const today = new Date().toISOString().split("T")[0];

  return `You are an Obsidian vault tagging <role> agent. Today's date is ${today}.

Your task is to <one-sentence goal>.

## Workflow

1. <Step with specific tool call>
2. <Step with specific tool call>
...

## Constraints

- <Safety constraint>
- <Budget constraint>
- Vault path: ${config.vaultPath}`;
}
```

**User prompt pattern** (from `buildUserPrompt` in `tagging-agent.ts:89-97`):
```typescript
if (mode === "execute") {
  return `<Short task instruction referencing config values>`;
}
```

**Mode dispatch pattern** (from `runAgent()` in `tagging-agent.ts:148-155`):
```typescript
} else if (mode === "execute") {
  systemPrompt = buildExecuteSystemPrompt(config);
} else if (mode === "verify") {
  systemPrompt = buildVerifySystemPrompt(config);
} else {
  throw new Error(`Unknown mode: "${mode}"`);
}
```

**Test pattern** (from `tests/test-agent-prompts.ts:13-39`):
```typescript
describe("buildExecuteSystemPrompt", () => {
  const prompt = buildExecuteSystemPrompt(mockConfig);

  test("contains key instruction", () => {
    expect(prompt).toContain("expected string");
  });
});
```

---

## IMPLEMENTATION PLAN

### Phase 3A: Execute System Prompt

Add `buildExecuteSystemPrompt(config)` to `tagging-agent.ts`. This is the critical prompt that instructs the agent to read the migration plan, identify the next batch of unprocessed notes, apply changes via `apply_tag_changes`, and commit with `git_commit`.

### Phase 3B: Verify System Prompt

Add `buildVerifySystemPrompt(config)` to `tagging-agent.ts`. This prompt instructs the agent to do a fresh full-vault scan checking for inline tags, scheme compliance, and content integrity, then write `_Tag Migration Verification.md`.

### Phase 3C: Wire Modes

Update `buildUserPrompt` and `runAgent()` to handle execute and verify modes instead of throwing.

### Phase 3D: Update Tests

Replace the throw-assertion tests with content verification tests for the new prompts.

---

## STEP-BY-STEP TASKS

### Task 1: ADD `buildExecuteSystemPrompt` to `tagging-agent.ts`

- **IMPLEMENT**: Add a new exported function `buildExecuteSystemPrompt(config: Config): string` after `buildPlanSystemPrompt` (after line 87). The system prompt must instruct the agent to:

  1. Read the migration plan: `read_note({ path: "_Tag Migration Plan.md", detail: "full" })`.
     - If not found, stop and report error — plan mode must run first.
  2. Read the proposed tagging scheme: `read_note({ path: "${SCHEME_NOTE_PATH}", detail: "full" })` for reference.
  3. Parse the per-note change list from the migration plan. Each entry has a note path and an array of `{ oldTag, newTag }` changes.
  4. Determine which notes still need processing. For each note in the plan:
     - Call `read_note({ path, detail: "minimal" })` to check current tags.
     - If the note's tags already match the target state (all new tags present, all old tags absent), skip it.
     - Otherwise, add it to the work queue.
  5. From the work queue, take the first `${config.batchSize}` notes as this invocation's batch.
  6. Before the batch: call `git_commit({ message: "Pre-migration checkpoint: batch starting" })`.
  7. For each note in the batch: call `apply_tag_changes({ path, changes })` with the changes from the plan.
     - Log each note processed (output the path and result summary).
     - If `apply_tag_changes` returns warnings, log them but continue.
  8. After the batch: call `git_commit({ message: "Tag migration batch N: <summary of notes processed>" })`.
  9. Report a summary: how many notes processed in this batch, how many remaining, whether more invocations are needed.

  Constraints section must state:
  - Apply ONLY the changes specified in the migration plan — do not improvise or add extra tag changes.
  - Use `apply_tag_changes` for every note — do NOT use `write_note` to modify note tags.
  - If a note in the plan no longer exists in the vault, log a warning and skip it.
  - This invocation processes at most `${config.batchSize}` notes. The user will run execute mode multiple times to process the full vault.
  - Vault path: `${config.vaultPath}`

- **PATTERN**: Mirror `buildAuditSystemPrompt` structure at `tagging-agent.ts:12-49` — role statement, numbered workflow, constraints section.
- **IMPORTS**: `SCHEME_NOTE_PATH` is already imported at line 6.
- **GOTCHA**: The system prompt must be explicit about how to parse the migration plan markdown. The plan mode (Phase 2) writes a "per-note change list" section. The execute prompt should tell the agent to look for a machine-parseable section with note paths and changes. Reference the plan format: entries like `{ path: "...", changes: [{ oldTag: "...", newTag: "..." }] }`.
- **GOTCHA**: The "skip already-processed notes" logic is how the agent achieves resumability across invocations. This is critical — without it, re-running execute would re-apply changes to already-migrated notes (which would mostly be no-ops but waste budget).
- **VALIDATE**: `bun test tests/test-agent-prompts.ts` — will fail on the execute throw test (expected, fixed in Task 5)

### Task 2: ADD `buildVerifySystemPrompt` to `tagging-agent.ts`

- **IMPLEMENT**: Add a new exported function `buildVerifySystemPrompt(config: Config): string` after `buildExecuteSystemPrompt`. The system prompt must instruct the agent to:

  1. Call `list_notes({ recursive: true })` to get the full vault inventory.
  2. For each note, call `read_note({ path, detail: "minimal" })` to get tag data.
     - Use "minimal" detail to stay within budget (~50 tokens per note).
     - Process in batches of 100 notes if needed to manage context window.
  3. For each note, check:
     - **Zero inline tags remaining**: `inlineTags` array should be empty (all tags moved to frontmatter). Noise tags in `inlineTags` are also violations — they should have been removed.
     - **Scheme compliance**: Every tag in `frontmatterTags` must be lowercase kebab-case with a valid prefix (`status/`, `type/`, `area/`, `project/`) or a valid flat topic tag (no prefix, lowercase kebab-case).
     - **No orphan tags**: Flag any tags not in the proposed scheme (read scheme note for reference: `read_note({ path: "${SCHEME_NOTE_PATH}", detail: "full" })`).
  4. Compile results into a verification report and write it using `write_note({ path: "_Tag Migration Verification.md", content: <report>, frontmatter: { tags: ["type/report"], date: "${today}" } })`.
     The report must include:
     - Summary: total notes scanned, notes fully compliant, notes with violations
     - Violation list: for each non-compliant note, what's wrong (inline tags found, invalid tag format, orphan tags)
     - Tag statistics: total unique tags now in use, breakdown by prefix category
     - Compliance percentage
     - Overall pass/fail verdict
  5. Call `git_commit({ message: "Verification complete: _Tag Migration Verification.md" })` after writing.

  Constraints section must state:
  - This is a READ-ONLY verification — do NOT modify any notes, only write the verification report.
  - Use "minimal" detail for budget efficiency.
  - Tag format reference: lowercase kebab-case, valid prefixes are `status/`, `type/`, `area/`, `project/`.
  - Notes prefixed with `_` (agent artifacts like reports) should be excluded from verification.
  - Vault path: `${config.vaultPath}`

- **PATTERN**: Mirror `buildAuditSystemPrompt` structure — similar to audit but focused on compliance checking rather than cataloging.
- **GOTCHA**: Verify is similar to audit but with different goals. Audit catalogs the current state; verify checks against the target state. The prompt must make this distinction clear so the agent doesn't just reproduce the audit report.
- **GOTCHA**: The `_` prefix exclusion is important — the agent's own report notes (`_Tag Audit Report.md`, `_Tag Migration Plan.md`) should not be checked for tag compliance.
- **VALIDATE**: `bun test tests/test-agent-prompts.ts` — will fail on the verify throw test (expected, fixed in Task 5)

### Task 3: UPDATE `buildUserPrompt` in `tagging-agent.ts`

- **IMPLEMENT**: Replace the throw at `tagging-agent.ts:96` with execute and verify prompts:

  For execute mode:
  ```
  Apply the tag migration plan to the vault at ${config.vaultPath}. Process up to ${config.batchSize} notes in this batch.
  ```

  For verify mode:
  ```
  Verify the tag migration in the vault at ${config.vaultPath}. Write the verification report to _Tag Migration Verification.md.
  ```

  Keep the throw as a fallback for truly unknown modes:
  ```typescript
  throw new Error(`Unknown mode: "${mode}"`);
  ```

- **PATTERN**: Mirror existing audit/plan cases at `tagging-agent.ts:90-95` — short, focused task instruction.
- **VALIDATE**: `bun test tests/test-agent-prompts.ts` — throw tests will now fail (fixed in Task 5)

### Task 4: UPDATE `runAgent()` mode dispatch in `tagging-agent.ts`

- **IMPLEMENT**: Replace the throw at `tagging-agent.ts:154` with execute and verify handling:

  ```typescript
  } else if (mode === "execute") {
    systemPrompt = buildExecuteSystemPrompt(config);
  } else if (mode === "verify") {
    systemPrompt = buildVerifySystemPrompt(config);
  } else {
    throw new Error(`Unknown mode: "${mode}"`);
  }
  ```

- **PATTERN**: Mirror existing if/else chain at `tagging-agent.ts:149-155`.
- **VALIDATE**: `VAULT_PATH=/tmp/test bun run tagging-agent.ts execute 2>&1 | head -10` — should print the agent header with "Mode: execute" (will fail on vault access, but confirms wiring)

### Task 5: UPDATE `tests/test-agent-prompts.ts`

- **IMPLEMENT**: Replace the two throw-assertion tests (lines 84-91) with content verification tests for the new prompts. Add two new `describe` blocks:

  **`describe("buildExecuteSystemPrompt")`:**
  - Import `buildExecuteSystemPrompt` from `../tagging-agent.js` (add to existing import at line 2)
  - `const prompt = buildExecuteSystemPrompt(mockConfig);`
  - Test: "references migration plan as input" — `expect(prompt).toContain("_Tag Migration Plan.md")`
  - Test: "contains key tool instructions" — `expect(prompt).toContain("apply_tag_changes")`, `expect(prompt).toContain("git_commit")`, `expect(prompt).toContain("read_note")`
  - Test: "includes batch size from config" — `expect(prompt).toContain("50")`
  - Test: "instructs to skip already-processed notes" — `expect(prompt).toContain("skip")` (case-insensitive check or look for the concept)
  - Test: "includes today's date" — same pattern as audit test at line 31-34
  - Test: "states plan-only constraint" — `expect(prompt).toContain("ONLY the changes specified")`

  **`describe("buildVerifySystemPrompt")`:**
  - Import `buildVerifySystemPrompt` from `../tagging-agent.js` (add to existing import)
  - `const prompt = buildVerifySystemPrompt(mockConfig);`
  - Test: "references verification report output" — `expect(prompt).toContain("_Tag Migration Verification.md")`
  - Test: "contains key tool instructions" — `expect(prompt).toContain("list_notes")`, `expect(prompt).toContain("read_note")`, `expect(prompt).toContain("write_note")`, `expect(prompt).toContain("git_commit")`
  - Test: "instructs minimal detail for budget" — `expect(prompt).toContain('"minimal"')`
  - Test: "states READ-ONLY constraint" — `expect(prompt).toContain("READ-ONLY")`
  - Test: "includes today's date" — same pattern as audit test
  - Test: "instructs to exclude agent artifact notes" — `expect(prompt).toContain("_")` or more specific check for the exclusion instruction

  **Update `buildUserPrompt` tests:**
  - Replace "throws for execute mode" test with: `test("returns correct prompt for execute mode", () => { const prompt = buildUserPrompt("execute", mockConfig); expect(prompt).toContain("migration plan"); expect(prompt).toContain("50"); })`
  - Replace "throws for verify mode" test with: `test("returns correct prompt for verify mode", () => { const prompt = buildUserPrompt("verify", mockConfig); expect(prompt).toContain("Verify"); expect(prompt).toContain("_Tag Migration Verification.md"); })`

- **PATTERN**: Follow existing test structure at `tests/test-agent-prompts.ts:13-39` — describe block with `const prompt = build...`, individual content assertions.
- **IMPORTS**: Update line 2 to add `buildExecuteSystemPrompt, buildVerifySystemPrompt` to the import.
- **VALIDATE**: `bun test tests/test-agent-prompts.ts` — all tests should pass

### Task 6: VERIFY all tests pass

- **IMPLEMENT**: Run the full test suite to confirm no regressions.
- **VALIDATE**: `bun test tests/test-agent-prompts.ts tests/test-tag-scheme.ts tests/test-tools-smoke.ts tests/test-frontmatter.ts tests/test-tag-parser.ts`

### Task 7: VERIFY TypeScript compilation

- **IMPLEMENT**: Run type checker.
- **VALIDATE**: `bunx tsc --noEmit`

---

## TESTING STRATEGY

### Unit Tests

- `tests/test-agent-prompts.ts` — Updated with ~12 new test cases across 3 areas: execute prompt content, verify prompt content, user prompt mode handling
- All existing tests remain (audit/plan prompt tests unchanged)

### Smoke Tests

- `VAULT_PATH=/tmp/test bun run tagging-agent.ts execute 2>&1 | head -10` — confirms mode wiring
- `VAULT_PATH=/tmp/test bun run tagging-agent.ts verify 2>&1 | head -10` — confirms mode wiring

### Edge Cases

- Execute with no migration plan → agent should report error (instructed in system prompt)
- Execute when all notes already processed → agent should report "nothing to do" and skip
- Verify on vault with zero violations → clean report
- Verify on vault with mixed violations → detailed violation list
- Unknown mode string → throws error

---

## VALIDATION COMMANDS

### Level 1: Syntax & Types

```bash
bunx tsc --noEmit
```

### Level 2: Unit Tests (Phase 3 specific)

```bash
bun test tests/test-agent-prompts.ts
```

### Level 3: All Tests (Full regression)

```bash
bun test tests/test-agent-prompts.ts tests/test-tag-scheme.ts tests/test-tools-smoke.ts tests/test-frontmatter.ts tests/test-tag-parser.ts
```

### Level 4: Module Smoke Check

```bash
VAULT_PATH=/tmp/test bun run tagging-agent.ts execute 2>&1 | head -10
VAULT_PATH=/tmp/test bun run tagging-agent.ts verify 2>&1 | head -10
```

### Level 5: Manual Integration (Against Real Vault)

```bash
# Execute mode (requires _Tag Migration Plan.md to exist in vault)
VAULT_PATH="/Users/josephfajen/git/obsidian-jpf" MAX_BUDGET_USD=0.50 bun run tagging-agent.ts execute

# Verify mode
VAULT_PATH="/Users/josephfajen/git/obsidian-jpf" MAX_BUDGET_USD=0.50 bun run tagging-agent.ts verify
```

---

## ACCEPTANCE CRITERIA

- [ ] `tagging-agent.ts` exports `buildExecuteSystemPrompt` and `buildVerifySystemPrompt`
- [ ] Execute system prompt instructs: read plan → skip processed notes → batch apply → git commit
- [ ] Execute prompt references `_Tag Migration Plan.md`, `apply_tag_changes`, `git_commit`, `read_note`
- [ ] Execute prompt includes batch size from config
- [ ] Execute prompt constrains agent to plan-specified changes only
- [ ] Verify system prompt instructs: full vault scan → compliance check → write report → git commit
- [ ] Verify prompt references `_Tag Migration Verification.md`, `list_notes`, `read_note`, `write_note`, `git_commit`
- [ ] Verify prompt instructs "minimal" detail for budget efficiency
- [ ] Verify prompt states READ-ONLY constraint
- [ ] Verify prompt instructs exclusion of `_`-prefixed agent artifact notes
- [ ] `buildUserPrompt` handles execute and verify modes (no longer throws)
- [ ] `runAgent()` dispatches execute and verify modes to correct system prompts
- [ ] All unit tests pass: `bun test tests/test-agent-prompts.ts`
- [ ] All Phase 1-2 tests still pass (no regressions)
- [ ] `bunx tsc --noEmit` passes with no errors
- [ ] CLI runs: `bun run tagging-agent.ts execute` and `bun run tagging-agent.ts verify` wire correctly

---

## COMPLETION CHECKLIST

- [ ] All 7 tasks completed in order
- [ ] Each task validation passed
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + smoke)
- [ ] No TypeScript errors
- [ ] Acceptance criteria all met

---

## NOTES

### Key Design Decisions

1. **One batch per invocation**: Execute mode processes at most `batchSize` notes per run. The user invokes `bun run tagging-agent.ts execute` multiple times until all notes are migrated. This keeps each invocation within budget and context window limits. The agent determines "next batch" by checking which notes still need changes (skip already-processed).

2. **Resumability via tag state checking**: Rather than tracking progress in a separate state file, the agent checks each note's current tags against the plan. If a note already has the target tags, it's skipped. This is idempotent and robust — re-running execute is safe even if a previous run was interrupted.

3. **Verify is independent of the plan**: Verify does a fresh scan rather than checking against the migration plan. This catches any issues regardless of source — manual edits, plan errors, or execute bugs. It's a true post-condition check.

4. **No dry-run**: Excluded per user decision. The plan-then-execute workflow already provides preview, and git commits provide rollback.

5. **Agent artifact exclusion in verify**: Notes prefixed with `_` (like `_Tag Audit Report.md`) are the agent's own output. They should not be checked for tag compliance since they use the `type/report` tag as metadata, not as part of the vault's content tagging.

### Risks

- **Plan format parsing**: The execute agent must parse a markdown note written by the plan agent. If the plan format varies (the plan agent has some LLM discretion in formatting), the execute agent may misinterpret entries. Mitigation: the execute system prompt is explicit about expected format, and the plan system prompt from Phase 2 already instructs machine-parseable output.

- **Budget for execute**: Each batch of 50 notes requires ~50 `read_note` calls (to check state) + ~50 `apply_tag_changes` calls + 2 `git_commit` calls. At ~50 tokens per tool call response, that's ~5K tokens of tool output per batch, plus agent reasoning. Should stay well within $1.00 per invocation.

- **Context window for verify**: Scanning 884 notes with "minimal" detail is the same workload as the audit phase. The verify prompt includes the same "batch of 100" processing instruction from audit.
