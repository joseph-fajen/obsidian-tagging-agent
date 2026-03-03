---
status: PENDING
created_date: 2026-03-02
---

# Feature: Fix Inline Tag Removal and Deduplication Bugs

The following plan should be complete, but validate documentation and codebase patterns before implementing.

Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

Three bugs were discovered during test vault validation that need fixes:

1. **P1 (High):** `removeInlineTag()` corrupts markdown when removing inline tags near code blocks - content gets duplicated and backticks corrupted
2. **P2 (Medium):** Test vault generator creates pre-existing duplicates via `rng.pick()` without deduplication
3. **P3 (Low):** Migration doesn't clean pre-existing duplicate tags in frontmatter

## User Story

As a vault owner running the tagging agent
I want the migration to complete with 100% compliance
So that my vault has clean, deduplicated tags in proper format without any content corruption

## Problem Statement

- P1: The `removeInlineTag()` function corrupts markdown when overlapping ranges aren't properly merged, causing code block content to be duplicated
- P2: The test vault generator can create notes with duplicate frontmatter tags due to `rng.pick()` selecting the same tag multiple times
- P3: The batch executor prevents adding new duplicates but doesn't clean up pre-existing duplicates, leaving notes with duplicate tags after migration

## Solution Statement

- P1: Add `mergeOverlappingRanges()` helper to consolidate overlapping code ranges before segmentation
- P2: Use `Set`-based collection in generators to ensure unique tags
- P3: Add silent deduplication step before writing frontmatter tags

## Feature Metadata

**Feature Type**: Bug Fix
**Estimated Complexity**: Medium
**Primary Systems Affected**: `lib/tag-parser.ts`, `scripts/generate-complex-vault.ts`, `lib/batch-executor.ts`
**Dependencies**: None (all internal code)

---

## CONTEXT REFERENCES

### Relevant Codebase Files - READ THESE BEFORE IMPLEMENTING!

- `lib/tag-parser.ts` (lines 60-112) - `removeInlineTag()` function with the bug
- `lib/tag-parser.ts` (lines 3-5) - Regex definitions for code detection
- `lib/tag-parser.ts` (lines 64-81) - Range collection logic to understand
- `lib/batch-executor.ts` (lines 44-77) - `applyChangesToNote()` tag handling
- `lib/batch-executor.ts` (lines 71-75) - Current duplicate prevention logic
- `scripts/generate-complex-vault.ts` (lines 264-272) - Daily note generator with bug
- `scripts/generate-complex-vault.ts` (lines 339-344) - Meeting note generator (same pattern)
- `tests/tag-parser.test.ts` (lines 139-174) - Existing `removeInlineTag` tests
- `tests/batch-executor.test.ts` - Test patterns for batch executor

### New Files to Create

None - all changes are to existing files.

### Relevant Documentation

- `CLAUDE.md` - Project conventions (kebab-case filenames, named exports, bun test)
- `PRD.md` (Section 7) - Tool specifications including `apply_tag_changes` behavior

### Patterns to Follow

**Test Pattern:** (from `tests/tag-parser.test.ts`)
```typescript
import { describe, test, expect } from "bun:test";

describe("functionName", () => {
  test("describes expected behavior", () => {
    const result = functionUnderTest(input);
    expect(result).toBe(expected);
  });
});
```

**Range Handling Pattern:** (from `lib/tag-parser.ts:64-81`)
```typescript
const codeRanges: { start: number; end: number }[] = [];
for (const re of [FENCED_CODE_BLOCK_RE, INLINE_CODE_RE]) {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    codeRanges.push({ start: m.index, end: m.index + m[0].length });
  }
}
codeRanges.sort((a, b) => a.start - b.start);
```

**Deduplication Pattern:** (JavaScript Set preserves insertion order)
```typescript
const uniqueTags = [...new Set(tags)];
```

---

## IMPLEMENTATION PLAN

### Phase 1: Fix P1 - removeInlineTag Range Merging

Fix the core bug in `removeInlineTag()` by merging overlapping ranges before segmentation.

**Tasks:**
1. Add `mergeOverlappingRanges()` helper function
2. Call it after collecting and sorting ranges
3. Add comprehensive test coverage

### Phase 2: Fix P2 - Test Vault Generator Deduplication

Fix the test vault generator to not create duplicate tags.

**Tasks:**
1. Fix `generateDailyNotes()` to use Set-based collection
2. Fix `generateMeetingNotes()` which has the same pattern
3. Verify other generators don't have this issue

### Phase 3: Fix P3 - Batch Executor Silent Deduplication

Add silent deduplication to clean up pre-existing duplicates.

**Tasks:**
1. Add deduplication step in `applyChangesToNote()` before writing
2. Add test for pre-existing duplicate cleanup

### Phase 4: Validation

Run full test suite and verify with test vault.

**Tasks:**
1. Run all tests
2. Regenerate test vault and run full migration
3. Verify 100% compliance

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

---

### Task 1: ADD mergeOverlappingRanges helper to lib/tag-parser.ts

**Location:** `lib/tag-parser.ts` - add after line 12 (after `stripCodeAndLinks` function)

**IMPLEMENT:** Add a helper function that merges overlapping ranges:

```typescript
/**
 * Merge overlapping ranges to prevent duplicate content in segmentation.
 * Ranges must be sorted by start position before calling.
 */
function mergeOverlappingRanges(ranges: { start: number; end: number }[]): { start: number; end: number }[] {
  if (ranges.length === 0) return [];

  const merged: { start: number; end: number }[] = [];
  let current = { ...ranges[0] };

  for (let i = 1; i < ranges.length; i++) {
    const next = ranges[i];
    if (next.start <= current.end) {
      // Overlapping or adjacent - extend current range
      current.end = Math.max(current.end, next.end);
    } else {
      // No overlap - push current and start new
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);

  return merged;
}
```

**PATTERN:** Similar to standard interval merging algorithm
**VALIDATE:** `bunx tsc --noEmit` (type check)

---

### Task 2: UPDATE removeInlineTag to use mergeOverlappingRanges

**Location:** `lib/tag-parser.ts` - in `removeInlineTag()` function

**IMPLEMENT:** After line 81 (after `codeRanges.sort(...)`), add call to merge:

```typescript
  codeRanges.sort((a, b) => a.start - b.start);

  // Merge overlapping ranges to prevent duplicate content
  const mergedRanges = mergeOverlappingRanges(codeRanges);
```

Then update line 84 to use `mergedRanges` instead of `codeRanges`:

```typescript
  // Split content into code/non-code segments
  for (const range of mergedRanges) {
```

**PATTERN:** Reference `lib/tag-parser.ts:82-96`
**VALIDATE:** `bun test tests/tag-parser.test.ts`

---

### Task 3: ADD test for multiple inline tags with code block

**Location:** `tests/tag-parser.test.ts` - add to `describe("removeInlineTag", ...)` block

**IMPLEMENT:** Add test case that reproduces the bug:

```typescript
  test("handles multiple tag removals near code blocks without corruption", () => {
    const content = `# Test Note

Real tag: #blockchain

\`\`\`python
# This is a comment with #fake-tag
code = "value"
\`\`\`

Inline code: \`#not-a-tag\` here.

Another tag: #ai-tools
`;

    // Remove first tag
    let result = removeInlineTag(content, "blockchain");
    // Remove second tag
    result = removeInlineTag(result, "ai-tools");

    // Code block should NOT be corrupted or duplicated
    expect(result).toContain("```python");
    expect(result).toContain("# This is a comment with #fake-tag");
    expect(result).toContain("```\n\nInline code:");

    // Tags should be removed
    expect(result).not.toContain("#blockchain");
    expect(result).not.toContain("#ai-tools");

    // Inline code should be preserved
    expect(result).toContain("`#not-a-tag`");

    // Content should NOT be duplicated
    const codeBlockCount = (result.match(/```python/g) || []).length;
    expect(codeBlockCount).toBe(1);
  });
```

**PATTERN:** Reference `tests/tag-parser.test.ts:147-153`
**VALIDATE:** `bun test tests/tag-parser.test.ts`

---

### Task 4: ADD test for overlapping range handling

**Location:** `tests/tag-parser.test.ts` - add to `describe("removeInlineTag", ...)` block

**IMPLEMENT:** Add edge case test:

```typescript
  test("handles inline code inside text near fenced blocks", () => {
    const content = `Text with \`inline\` code.

\`\`\`
block
\`\`\`

More \`inline\` and #tag here.`;

    const result = removeInlineTag(content, "tag");

    // Both inline code spans should be preserved
    expect((result.match(/`inline`/g) || []).length).toBe(2);
    // Code block preserved
    expect(result).toContain("```\nblock\n```");
    // Tag removed
    expect(result).not.toContain("#tag");
  });
```

**VALIDATE:** `bun test tests/tag-parser.test.ts`

---

### Task 5: UPDATE generateDailyNotes to deduplicate tags

**Location:** `scripts/generate-complex-vault.ts` - lines 263-272

**IMPLEMENT:** Replace the loop with Set-based collection:

```typescript
    // Add some topic tags with format variants (deduplicated)
    const topicCount = rng.int(1, 3);
    const selectedTopics = new Set<string>();
    while (selectedTopics.size < topicCount) {
      const tag = rng.pick(VALID_TAGS);
      if (FORMAT_VARIANTS[tag] && rng.next() > 0.6) {
        selectedTopics.add(rng.pick(FORMAT_VARIANTS[tag]));
      } else {
        selectedTopics.add(tag);
      }
    }
    for (const tag of selectedTopics) {
      tags.push(tag);
    }
```

**GOTCHA:** The `while` loop ensures we get exactly `topicCount` unique tags
**VALIDATE:** `bunx tsc --noEmit`

---

### Task 6: UPDATE generateMeetingNotes to deduplicate tags

**Location:** `scripts/generate-complex-vault.ts` - lines 339-344

**IMPLEMENT:** The meeting notes generator also picks random tags. Review and ensure no duplicate patterns. Current code:

```typescript
    // Add topic tags with variants
    tags.push(rng.pick([
      "productivity",
      ...FORMAT_VARIANTS["productivity"] || [],
      "team-building",
      "leadership",
    ]));
```

This only picks ONE tag, so no deduplication needed here. However, verify that the full meeting note tag array doesn't have duplicates from other sources. If needed, add deduplication at the end:

```typescript
    // Deduplicate tags before creating frontmatter
    const uniqueTags = [...new Set(tags)];
    const frontmatter = formatFrontmatter(uniqueTags, { date: dateStr });
```

**VALIDATE:** `bunx tsc --noEmit`

---

### Task 7: ADD deduplication to applyChangesToNote

**Location:** `lib/batch-executor.ts` - line 79, before `setFrontmatterTags`

**IMPLEMENT:** Add deduplication step:

```typescript
    // Deduplicate tags (silently removes pre-existing duplicates)
    currentTags = [...new Set(currentTags)];

    // Write back
    const newData = setFrontmatterTags(parsed.data, currentTags);
```

**PATTERN:** Using `Set` preserves insertion order (first occurrence wins)
**VALIDATE:** `bun test tests/batch-executor.test.ts`

---

### Task 8: ADD test for pre-existing duplicate cleanup

**Location:** `tests/batch-executor.test.ts` - add to `describe("executeBatch", ...)` block

**IMPLEMENT:** Add test case:

```typescript
  test("silently deduplicates pre-existing duplicate tags", async () => {
    // Create a note with pre-existing duplicates
    await writeFile(
      join(TEST_VAULT_PATH, "note-with-dupes.md"),
      `---
tags:
  - duplicate-tag
  - other-tag
  - duplicate-tag
---
# Note with duplicates
`
    );

    const entries: BatchEntry[] = [
      {
        path: "note-with-dupes.md",
        changes: [{ oldTag: "other-tag", newTag: "type/other" }],
      },
    ];

    const result = await executeBatch(
      TEST_VAULT_PATH,
      TEST_DATA_PATH,
      entries,
      1
    );

    expect(result.succeeded).toBe(1);

    // Read back and verify deduplication
    const content = await readFile(join(TEST_VAULT_PATH, "note-with-dupes.md"), "utf-8");
    const tagMatches = content.match(/duplicate-tag/g) || [];
    expect(tagMatches.length).toBe(1); // Only one occurrence now
    expect(content).toContain("type/other");
  });
```

**VALIDATE:** `bun test tests/batch-executor.test.ts`

---

### Task 9: RUN full test suite

**IMPLEMENT:** Run all tests to ensure no regressions:

```bash
bun test
```

**VALIDATE:** All tests pass (367+ tests)

---

### Task 10: VALIDATE with test vault migration

**IMPLEMENT:** Regenerate test vault and run full migration:

```bash
# Regenerate fresh test vault
bun run scripts/generate-complex-vault.ts --clean

# Clear previous data
rm -f data/*.json

# Run full migration
bun run tagging-agent.ts
```

**VALIDATE:** Verification phase shows 100% compliance (0 violations)

---

## TESTING STRATEGY

### Unit Tests

**Tag Parser Tests:** (`tests/tag-parser.test.ts`)
- Test `removeInlineTag` with multiple tags near code blocks
- Test overlapping inline code and fenced code blocks
- Test that code block content is never duplicated

**Batch Executor Tests:** (`tests/batch-executor.test.ts`)
- Test pre-existing duplicate cleanup
- Test that deduplication preserves first occurrence

### Integration Tests

**Full Migration Test:**
- Regenerate test-vault-complex
- Run full audit → plan → generate-worklist → execute → verify cycle
- Verify 100% compliance with 0 violations

### Edge Cases

- Multiple inline tags in same paragraph with code block nearby
- Nested code (inline code containing backticks - rare but possible with 4-backtick fences)
- Notes with many duplicate tags (stress test deduplication)
- Empty tag arrays after deduplication

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Type Checking

```bash
bunx tsc --noEmit
```

### Level 2: Unit Tests - Tag Parser

```bash
bun test tests/tag-parser.test.ts
```

### Level 3: Unit Tests - Batch Executor

```bash
bun test tests/batch-executor.test.ts
```

### Level 4: Full Test Suite

```bash
bun test
```

### Level 5: Integration Test

```bash
# Regenerate and test
bun run scripts/generate-complex-vault.ts --clean
rm -f data/*.json
rm -f test-vault-complex/_Tag*.md

# Run interactive mode or individual phases
bun run tagging-agent.ts audit
bun run tagging-agent.ts plan
bun run tagging-agent.ts generate-worklist
bun run tagging-agent.ts execute
bun run tagging-agent.ts verify
```

Expected: Verify phase shows 100% compliance.

---

## ACCEPTANCE CRITERIA

- [x] P1: `removeInlineTag()` no longer corrupts markdown with code blocks
- [x] P1: Code block content is never duplicated
- [x] P1: Tags inside code blocks are preserved (not removed)
- [x] P2: Test vault generator creates unique tags (no pre-existing duplicates)
- [x] P3: Migration silently deduplicates pre-existing duplicate tags
- [x] All validation commands pass with zero errors
- [x] Full test suite passes (367+ tests)
- [x] Integration test achieves 100% compliance

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual testing confirms feature works
- [ ] Acceptance criteria all met
- [ ] CHANGELOG.md updated with fix details
- [ ] PROJECT_STATUS.md updated if needed

---

## NOTES

### Design Decisions

1. **Merge overlapping ranges:** The standard interval merging algorithm ensures no duplicate content. Ranges are already sorted by start position, so we just need to merge adjacent/overlapping ones.

2. **Silent deduplication:** Per user request, deduplication happens silently without warnings. First occurrence wins (Set preserves insertion order in JavaScript).

3. **Set-based collection in generator:** Using `while (set.size < count)` ensures we get exactly the requested number of unique tags.

### Risk Assessment

- **Low risk:** These are focused bug fixes with clear test coverage
- **No behavioral changes** to the happy path - just fixing edge cases
- **All changes are additive** - existing tests should continue to pass

### Post-Implementation

After implementing, update:
- `CHANGELOG.md` with bug fix details
- `PROJECT_STATUS.md` if verification now passes 100%
- This plan's status header to `IMPLEMENTED`
