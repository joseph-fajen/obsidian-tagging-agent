---
status: IMPLEMENTED
implemented_date: 2026-02-03
commit: e641424
---

# Feature: Post-Verification Improvements

The following plan has been implemented.

Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

Following the successful tag migration (99.7% compliance, $1.97 total cost), this plan addresses improvements identified during the migration and verification phases:

1. **Refined Templater Detection** — Allow parsing of ~280 daily notes that have valid YAML frontmatter but contain Templater expressions in the body
2. **Extended Tag Prefixes** — Add `topic/`, `tool/`, `skill/` to the valid prefix list to eliminate false "invalid format" warnings
3. **Documentation Updates** — Document the pragmatic Bash/Read tool usage as accepted behavior, update architecture documentation

## User Story

As a vault owner running the tagging agent
I want my daily notes with Templater cursor placeholders to be processed
So that all 280+ daily notes are included in tag migration instead of being skipped

As a developer maintaining this agent
I want clear documentation of the tool boundary decision
So that the architectural rationale is preserved for future reference

## Problem Statement

Three issues were identified post-migration:

1. **Overly aggressive Templater skip** — The worklist generator skips any file containing `<%` and `%>` anywhere, but ~280 daily notes have valid frontmatter with Templater only in the body (e.g., `<% tp.file.cursor() %>`). These notes should be processable.

2. **Missing tag prefixes** — The audit phase discovered additional hierarchical prefixes (`topic/`, `tool/`, `skill/`) that the tag validator doesn't recognize, causing benign but noisy warnings.

3. **Undocumented tool boundary** — The verify agent used Bash/Read despite the MCP-only design intent. Research confirmed this is an SDK limitation (`allowedTools` doesn't work with `bypassPermissions`), and the pragmatic behavior should be documented.

## Solution Statement

1. Refine Templater detection to check only the frontmatter region, not the entire file
2. Add the three new prefixes to `VALID_PREFIXES` in `lib/tag-parser.ts`
3. Update CLAUDE.md, PRD.md, and PROJECT_STATUS.md to document the tool boundary decision

## Feature Metadata

**Feature Type**: Enhancement / Bug Fix / Documentation
**Estimated Complexity**: Low
**Primary Systems Affected**: `lib/worklist-generator.ts`, `lib/tag-parser.ts`, `tools/tag-tools.ts`, documentation files
**Dependencies**: None (all changes are internal)

---

## CONTEXT REFERENCES

### Relevant Codebase Files — IMPORTANT: READ THESE FILES BEFORE IMPLEMENTING!

- `lib/worklist-generator.ts` (lines 94-100) — Current Templater skip logic to refine
- `lib/tag-parser.ts` (line 1) — `VALID_PREFIXES` array to extend
- `tools/tag-tools.ts` (lines 60-63) — Uses same Templater skip pattern, needs update
- `CLAUDE.md` — Architecture rules to update
- `PRD.md` (lines 168-172) — MCP tool boundary documentation
- `PROJECT_STATUS.md` (lines 79-84) — Open issues to update

### New Files to Create

None — all changes are to existing files.

### Relevant Documentation — READ BEFORE IMPLEMENTING!

- [Claude Agent SDK Permissions](https://platform.claude.com/docs/en/agent-sdk/permissions)
  - Section: "How permissions are evaluated"
  - Why: Confirms that `allowedTools` doesn't restrict tools with `bypassPermissions`

- [GitHub Issue #115](https://github.com/anthropics/claude-agent-sdk-typescript/issues/115)
  - Why: Documents the SDK behavior as a known limitation, not a bug in our code

### Patterns to Follow

**Frontmatter extraction pattern** (from `lib/frontmatter.ts`):
```typescript
// gray-matter handles the --- delimiters
const hasFrontmatter = matter.test(raw);
const { data, content } = matter(raw);
```

**Tag prefix validation pattern** (from `lib/tag-parser.ts:51-58`):
```typescript
const VALID_PREFIXES = ["status/", "type/", "area/", "project/"];

export function isValidTagFormat(tag: string): boolean {
  const hasPrefix = VALID_PREFIXES.some((p) => tag.startsWith(p));
  // ...
}
```

---

## IMPLEMENTATION PLAN

### Phase 1: Refine Templater Detection

Fix the overly aggressive skip logic to only skip files where Templater expressions are in the YAML frontmatter itself, not in the body content.

**Rationale**: Daily notes have expanded frontmatter (`created: '2025-01-31 09:35'`) but may contain cursor placeholders in the body (`<% tp.file.cursor() %>`). The frontmatter is valid YAML and should be parseable.

### Phase 2: Extend Tag Prefixes

Add the audit-discovered prefixes to the validator to eliminate false warnings.

### Phase 3: Documentation Updates

Document the tool boundary decision with rationale and research findings.

### Phase 4: Testing & Validation

Verify the changes work correctly and don't introduce regressions.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

---

### Task 1: UPDATE `lib/worklist-generator.ts` — Refine Templater detection

- **IMPLEMENT**: Replace the overly broad Templater check with a frontmatter-only check
- **PATTERN**: Use regex to extract frontmatter region before checking for Templater syntax
- **LOCATION**: Lines 94-100
- **GOTCHA**: Must handle files without frontmatter (no `---` delimiters)

**Current code to replace:**
```typescript
// Skip Templater template files (contain unexpanded <% %> syntax)
// These have unparseable YAML due to nested quotes in expressions
if (raw.includes("<%") && raw.includes("%>")) {
  warnings.push(`Skipping template file (contains Templater syntax): ${notePath}`);
  notesSkipped++;
  continue;
}
```

**New code:**
```typescript
// Skip files with Templater syntax IN THE FRONTMATTER (unparseable YAML)
// Files with Templater in body only (e.g., cursor placeholders) are safe to parse
const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
const frontmatterContent = frontmatterMatch?.[1] || "";
if (frontmatterContent.includes("<%") && frontmatterContent.includes("%>")) {
  warnings.push(`Skipping: Templater syntax in frontmatter: ${notePath}`);
  notesSkipped++;
  continue;
}
```

- **VALIDATE**: `bun test tests/worklist-generator.test.ts`

---

### Task 2: UPDATE `tools/tag-tools.ts` — Apply same Templater fix

- **IMPLEMENT**: Update the same Templater detection pattern in `apply_tag_changes`
- **PATTERN**: Mirror the fix from Task 1
- **LOCATION**: Lines 60-63

**Current code to replace:**
```typescript
// Skip Templater template files (unparseable YAML due to nested quotes)
if (raw.includes("<%") && raw.includes("%>")) {
  return errorResult(`Cannot process template file (contains Templater syntax): ${notePath}`);
}
```

**New code:**
```typescript
// Skip files with Templater syntax IN THE FRONTMATTER (unparseable YAML)
// Files with Templater in body only are safe to process
const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
const frontmatterContent = frontmatterMatch?.[1] || "";
if (frontmatterContent.includes("<%") && frontmatterContent.includes("%>")) {
  return errorResult(`Cannot process: Templater syntax in frontmatter: ${notePath}`);
}
```

- **VALIDATE**: `bun test tests/tools-smoke.test.ts`

---

### Task 3: UPDATE `lib/tag-parser.ts` — Add new tag prefixes

- **IMPLEMENT**: Add `topic/`, `tool/`, `skill/` to the `VALID_PREFIXES` array
- **LOCATION**: Line 1
- **GOTCHA**: Order doesn't matter for `some()` check, but keep alphabetical for readability

**Current code:**
```typescript
const VALID_PREFIXES = ["status/", "type/", "area/", "project/"];
```

**New code:**
```typescript
const VALID_PREFIXES = ["area/", "project/", "skill/", "status/", "tool/", "topic/", "type/"];
```

- **VALIDATE**: `bun test tests/tag-parser.test.ts`

---

### Task 4: ADD test case for body-only Templater

- **IMPLEMENT**: Add a test to `tests/worklist-generator.test.ts` confirming files with Templater in body are processed
- **PATTERN**: Follow existing test structure in the file

**Test to add:**
```typescript
test("processes files with Templater in body but valid frontmatter", async () => {
  // This simulates a daily note with expanded frontmatter but cursor placeholder in body
  const content = `---
created: '2025-01-31 09:35'
tags:
  - daily-reflection
---
# Daily Note

Some content here
- <% tp.file.cursor() %>
`;

  // The file should be processed, not skipped
  // (actual test implementation depends on test utilities available)
});
```

- **VALIDATE**: `bun test tests/worklist-generator.test.ts`

---

### Task 5: UPDATE `CLAUDE.md` — Document tool boundary decision

- **IMPLEMENT**: Update the Architecture Rules section to reflect the pragmatic tool usage
- **LOCATION**: Lines 12-17

**Add after line 17:**
```markdown
- **Tool boundary note**: The MCP tools are the *preferred* interface for vault access, but agents may use built-in SDK tools (Bash, Read) when pragmatically beneficial. This is a documented SDK limitation: `allowedTools` restrictions are not enforced when using `permissionMode: bypassPermissions`. The verify agent, for example, uses Bash for efficient vault scanning. All vault *writes* must still go through MCP tools.
```

- **VALIDATE**: Manual review

---

### Task 6: UPDATE `PRD.md` — Add architectural note

- **IMPLEMENT**: Add a note in the Architecture section about the tool boundary
- **LOCATION**: After line 172 (after "MCP tool boundary" bullet)

**Add:**
```markdown
  > **Implementation note (2026-02)**: Due to a [Claude Agent SDK limitation](https://github.com/anthropics/claude-agent-sdk-typescript/issues/115), `allowedTools` restrictions are not enforced when using `permissionMode: bypassPermissions`. The agent may use built-in SDK tools (Bash, Read) for efficiency. All vault writes are still routed through MCP tools for safety.
```

- **VALIDATE**: Manual review

---

### Task 7: UPDATE `PROJECT_STATUS.md` — Close the open issue

- **IMPLEMENT**: Move the "No technical enforcement of MCP-only tool access" from Open Issues to a resolved/documented section
- **LOCATION**: Lines 79-84

**Replace:**
```markdown
### Open Issues

1. **No technical enforcement of MCP-only tool access**
   - `allowedTools` is set but SDK's `bypassPermissions` may override it
   - Agent can still call Bash/Read if it chooses to ignore system prompt
```

**With:**
```markdown
### Open Issues

(None currently)

### Documented Decisions

1. **Pragmatic tool boundary (2026-02)**
   - The SDK's `allowedTools` is not enforced with `bypassPermissions` ([SDK issue #115](https://github.com/anthropics/claude-agent-sdk-typescript/issues/115))
   - Decision: Accept pragmatic use of Bash/Read for efficiency
   - All vault *writes* still go through MCP tools for auditability
   - Documented in CLAUDE.md and PRD.md
```

- **VALIDATE**: Manual review

---

### Task 8: Run full test suite

- **IMPLEMENT**: Verify no regressions
- **VALIDATE**: `bun test`

---

### Task 9: Type check

- **IMPLEMENT**: Ensure no TypeScript errors
- **VALIDATE**: `bunx tsc --noEmit`

---

### Task 10: Re-run generate-worklist to verify Templater fix

- **IMPLEMENT**: Run the worklist generator and confirm fewer files are skipped
- **VALIDATE**: `VAULT_PATH=/Users/josephfajen/git/obsidian-jpf bun run tagging-agent.ts generate-worklist`
- **EXPECTED**: Should see ~6 template files skipped (not ~280 daily notes)

---

## TESTING STRATEGY

### Unit Tests

- `tests/worklist-generator.test.ts` — Add test for body-only Templater handling
- `tests/tag-parser.test.ts` — Verify new prefixes are recognized as valid
- `tests/tools-smoke.test.ts` — Verify apply_tag_changes handles body-only Templater

### Integration Tests

- Run `generate-worklist` on the actual vault and verify:
  - Only ~6 Template files skipped (not ~280)
  - Daily notes with Templater cursor placeholders are processed

### Edge Cases

1. File with no frontmatter at all (no `---` delimiters) — should not crash
2. File with frontmatter containing `%` but not full Templater syntax — should process
3. File with multiple `---` in body (not frontmatter) — should not confuse the regex

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
# No linting configured, skip
```

### Level 2: Type Checking

```bash
bunx tsc --noEmit
```

### Level 3: Unit Tests

```bash
bun test
```

### Level 4: Integration Tests

```bash
# Run worklist generator and verify output
VAULT_PATH=/Users/josephfajen/git/obsidian-jpf bun run tagging-agent.ts generate-worklist
```

### Level 5: Manual Validation

1. Check that the worklist output shows ~6 skipped templates, not ~280
2. Verify a known daily note (e.g., `2025-01-31-Friday.md`) is in the worklist
3. Review CLAUDE.md, PRD.md, PROJECT_STATUS.md for clarity

---

## ACCEPTANCE CRITERIA

- [ ] Daily notes with Templater in body (not frontmatter) are processed, not skipped
- [ ] Template files with Templater in frontmatter are still correctly skipped
- [ ] Tags with `topic/`, `tool/`, `skill/` prefixes pass validation without warnings
- [ ] All documentation reflects the tool boundary decision
- [ ] All 119+ tests pass
- [ ] Type checking passes with zero errors
- [ ] `generate-worklist` produces output with ~6 skipped files, not ~280

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual testing confirms feature works
- [ ] Acceptance criteria all met

---

## NOTES

### Research Sources

- [Claude Agent SDK Permissions Docs](https://platform.claude.com/docs/en/agent-sdk/permissions) — Confirms permission evaluation order
- [SDK Issue #115](https://github.com/anthropics/claude-agent-sdk-typescript/issues/115) — Documents `allowedTools` limitation with `bypassPermissions`
- [Templater Issue #1387](https://github.com/SilentVoid13/Templater/issues/1387) — Background on Templater frontmatter challenges
- [gray-matter docs](https://github.com/jonschlinkert/gray-matter) — Frontmatter parsing library

### Design Decisions

1. **Why accept Bash/Read usage?**
   - The verify agent completed faster using Bash for scanning
   - The SDK doesn't provide a way to enforce restrictions with `bypassPermissions`
   - All vault *writes* still go through auditable MCP tools
   - Enforcing via hooks adds complexity without clear benefit

2. **Why check frontmatter only for Templater?**
   - The YAML parser only sees the frontmatter region
   - Body content (including Templater cursor placeholders) is handled separately
   - This matches user expectation: expanded daily notes should be processable

3. **Why add all three new prefixes?**
   - They were discovered during the actual migration
   - Adding them eliminates benign but noisy warnings
   - Keeps the validator in sync with actual usage patterns

### Future Considerations

- If the SDK adds proper `allowedTools` enforcement, revisit the tool boundary
- Consider adding a `--strict-mcp` flag for users who want enforcement via hooks
- The Templater fix could be extracted to a shared utility if needed elsewhere
