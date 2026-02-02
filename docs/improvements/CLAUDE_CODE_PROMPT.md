# Claude Code Task: Tagging Agent Architectural Improvements

## Context

You're improving the Obsidian Vault Tagging Agent after its maiden voyage revealed significant architectural inefficiencies. The agent successfully migrated ~500 notes but cost $10.34 and took 18 batches due to redundant re-scanning. The goal is to reduce execute-phase cost by ~50% through better data flow between phases.

**Project location:** `/Users/josephfajen/git/claude-agent-sdk-proactive-agent`

**Key files to modify:**
- `tagging-agent.ts` — system prompts for each phase
- `lib/tag-parser.ts` — bug fixes for noise detection and case sensitivity
- `lib/frontmatter.ts` — bug fix for `#` prefix stripping
- `tools/vault-tools.ts` — potentially add progress tracking tool

**Reference documents (read these first):**
- `ARCHITECTURE_CHANGES.md` — detailed specifications for the worklist and progress tracking
- `BUG_FIXES.md` — three specific bugs with exact fixes
- `SYSTEM_PROMPT_UPDATES.md` — updated prompts for plan and execute phases

---

## Task 1: Implement Bug Fixes (P1 — Do First)

Three bugs caused manual intervention during the maiden voyage. Fix all three before architectural changes.

### Bug 1: Numeric inline tags not classified as noise

**File:** `lib/tag-parser.ts` → `isNoiseTag()` function

**Current behavior:** Tags like `#1` pass through because they don't match existing noise patterns.

**Fix:** Add check for purely numeric tags:

```typescript
// Add to isNoiseTag() function
if (/^\d+$/.test(tag)) return true;
```

**Test:** Verify `isNoiseTag("1")` returns `true`, `isNoiseTag("123")` returns `true`, `isNoiseTag("tag1")` returns `false`.

### Bug 2: Frontmatter tags with `#` prefix not normalized

**File:** `lib/frontmatter.ts` → `getFrontmatterTags()` function

**Current behavior:** If YAML contains `tags: ["#project-catalyst"]`, the function returns `"#project-catalyst"` as-is. Then `apply_tag_changes` looking for `oldTag: "project-catalyst"` can't match it.

**Fix:** Strip leading `#` from all frontmatter tags:

```typescript
// In getFrontmatterTags(), after extracting tags array:
return tags.map(t => typeof t === 'string' ? t.replace(/^#/, '') : t);
```

**Test:** Verify `getFrontmatterTags({ tags: ["#foo", "bar", "#baz"] })` returns `["foo", "bar", "baz"]`.

### Bug 3: Inline tag removal is case-sensitive

**File:** `lib/tag-parser.ts` → `removeInlineTag()` function

**Current behavior:** If note contains `#Plutus-docs-design` but migration plan specifies `plutus-docs-design`, the removal regex won't match.

**Fix:** Add case-insensitive flag to the removal regex:

```typescript
// Change the regex construction to use 'gi' flags instead of 'g'
const regex = new RegExp(`#${escapedTag}(?![\\w-])`, 'gi');
```

**Test:** Verify `removeInlineTag(content, "plutus-docs-design")` removes `#Plutus-docs-design` from content.

---

## Task 2: Plan Phase — Generate Machine-Parseable Worklist (P1)

This is the highest-impact change. The plan phase currently produces a human-readable mapping table but tells the execute phase to "scan all 597 notes" itself. This caused 40% of execute budget to be wasted on rediscovery.

### Requirements

1. After generating the tag mapping table, the plan phase must scan ALL tagged notes
2. For each note, compute the exact changes based on the mapping
3. Output a JSON worklist embedded in the plan note
4. The worklist must be complete — execute phase should need zero searches

### Implementation

**Modify `buildPlanSystemPrompt()` in `tagging-agent.ts`:**

See `SYSTEM_PROMPT_UPDATES.md` for the complete updated prompt. Key additions:

```markdown
## Critical Requirement: Per-Note Worklist Generation

After creating the tag mapping table, you MUST generate a complete per-note worklist:

1. Call `list_notes({ recursive: true })` to get all note paths
2. For each note with tags, call `read_note({ path, detail: "minimal" })`
3. For each tag in the note, look up the mapping and compute the change
4. Accumulate all changes into a JSON structure
5. Write the worklist as a fenced JSON block at the end of the migration plan

The JSON structure MUST follow this exact format:
[see ARCHITECTURE_CHANGES.md for schema]
```

**Expected output in `_Tag Migration Plan.md`:**

The plan note should end with:

~~~markdown
## Machine-Parseable Worklist

```json
{
  "generatedAt": "2026-01-31T10:00:00Z",
  "schemeVersion": "1.0",
  "totalNotes": 597,
  "worklist": [
    {
      "path": "Journal/2025-01-15.md",
      "changes": [
        { "oldTag": "#daily-reflection", "newTag": "type/daily-note" },
        { "oldTag": "#heading", "newTag": null }
      ]
    }
  ],
  "unmappedTags": [
    { "tag": "complex-query", "notePaths": ["note1.md", "note2.md"] }
  ]
}
```
~~~

---

## Task 3: Add Progress Tracking (P1)

Each execute batch currently starts with zero knowledge of previous batches, causing expensive re-scanning of already-migrated notes.

### Requirements

1. Create a `_Migration_Progress.json` file in the vault root
2. Execute phase reads this before processing
3. Execute phase updates it after each batch
4. Progress file tracks which notes have been processed

### Implementation Options

**Option A: Use existing `write_note` tool (simpler)**

No new tools needed. The execute phase:
1. Calls `read_note("_Migration_Progress.json")` at start
2. Calls `write_note("_Migration_Progress.json", updatedContent)` at end

**Option B: Add dedicated progress tools (more robust)**

Add to `tools/vault-tools.ts`:
- `read_progress()` — returns parsed progress object
- `update_progress({ processedPaths: string[] })` — appends to processed list

I recommend **Option A** for MVP simplicity. The execute prompt can handle JSON parsing.

### Progress File Schema

```json
{
  "migrationId": "2026-01-31-v1",
  "startedAt": "2026-01-31T10:30:00Z",
  "lastUpdatedAt": "2026-01-31T14:45:00Z",
  "worklistSource": "_Tag Migration Plan.md",
  "totalInWorklist": 597,
  "processedPaths": [
    "Journal/2025-01-15.md",
    "Journal/2025-01-16.md"
  ],
  "batchHistory": [
    { "batch": 1, "count": 50, "commitHash": "abc123", "completedAt": "2026-01-31T10:45:00Z" },
    { "batch": 2, "count": 50, "commitHash": "def456", "completedAt": "2026-01-31T11:00:00Z" }
  ]
}
```

---

## Task 4: Update Execute Phase Prompt (P2)

The execute phase currently improvises — searching for notes, using Bash tools, making decisions. It should be deterministic.

### Requirements

1. Execute phase reads the worklist from the plan (not searches)
2. Execute phase reads progress file to know where to resume
3. Execute phase processes exactly `batchSize` notes in worklist order
4. Execute phase updates progress file after completion
5. Execute phase does NOT use `search_notes` or Bash

### Implementation

**Replace `buildExecuteSystemPrompt()` in `tagging-agent.ts`:**

See `SYSTEM_PROMPT_UPDATES.md` for the complete updated prompt. Key structure:

```markdown
## Execute Phase Algorithm

You are executing a pre-computed migration plan. Follow this exact sequence:

1. READ PROGRESS: Call `read_note({ path: "_Migration_Progress.json", detail: "full" })`
   - If file doesn't exist, this is batch 1 — create initial progress structure
   - Parse the JSON to get `processedPaths` array

2. READ WORKLIST: Call `read_note({ path: "_Tag Migration Plan.md", detail: "full" })`
   - Find the JSON code block in the "Machine-Parseable Worklist" section
   - Parse it to get the `worklist` array

3. COMPUTE BATCH: Filter worklist to notes NOT in processedPaths, take first {batchSize}

4. PRE-COMMIT: Call `git_commit({ message: "Pre-batch {N} checkpoint" })`

5. PROCESS EACH NOTE: For each note in the batch:
   - Call `apply_tag_changes({ path, changes })` with exact changes from worklist
   - Log success/warnings

6. UPDATE PROGRESS: Write updated progress JSON with new processedPaths

7. POST-COMMIT: Call `git_commit({ message: "Tag migration batch {N}: {count} notes" })`

8. REPORT: Output batch summary with notes processed, remaining count, any warnings

## Forbidden Actions

- Do NOT call `search_notes` — the worklist already contains all information
- Do NOT use Bash or shell commands
- Do NOT skip notes or reorder processing
- Do NOT modify notes beyond applying the worklist changes
```

---

## Task 5: Update Verify Phase Prompt (P2)

The verify phase incorrectly flagged valid flat topic tags as invalid.

### Requirements

1. Verify prompt must recognize two valid tag formats:
   - Prefixed: `status/pending`, `type/daily-note`, `area/career`, `project/isee`
   - Flat topic: lowercase kebab-case without prefix (e.g., `ai-tools`, `meditation`)

2. Only flag as invalid:
   - Tags containing `#` prefix
   - Tags with underscores or uppercase (non-kebab-case)
   - Tags on the explicit noise list

### Implementation

**Update `buildVerifySystemPrompt()` in `tagging-agent.ts`:**

See `SYSTEM_PROMPT_UPDATES.md` for the complete updated prompt.

---

## Validation Checklist

After implementing all changes, verify:

- [ ] `bun test` passes (fix test runner in package.json first: `"test": "bun test"`)
- [ ] Bug fixes work: numeric noise tags, `#` prefix stripping, case-insensitive removal
- [ ] Plan phase on a small test vault produces JSON worklist
- [ ] Execute phase reads worklist and progress file correctly
- [ ] Execute phase does not call `search_notes` or Bash
- [ ] Progress file updates after each batch
- [ ] Verify phase does not flag flat topic tags as invalid

---

## Files to Reference

Read these supporting documents I've provided:

1. **ARCHITECTURE_CHANGES.md** — Detailed schemas and data flow diagrams
2. **BUG_FIXES.md** — Exact code changes for the three bugs
3. **SYSTEM_PROMPT_UPDATES.md** — Complete updated prompts for plan, execute, verify phases

---

## Success Metrics

After these improvements, the next full vault migration should achieve:

| Metric | Maiden Voyage | Target |
|--------|---------------|--------|
| Execute cost per note | $0.018 | < $0.010 |
| Execute batches for 597 notes | 18 | < 12 |
| Manual fixes required | 4 | 0 |
| Bash tool usage | Multiple | 0 |
