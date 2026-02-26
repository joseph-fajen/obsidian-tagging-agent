---
date: 2026-02-25
feature: Dynamic Plan Mappings
status: VALIDATED_WITH_GAPS
---

# Retrospective: Dynamic Plan Mappings Validation

## Session Context

Tested the new "generalization for any vault" implementation that removes hardcoded tag mappings in favor of user-defined schema notes. The goal was to validate that a new user could run the full migration workflow without editing source code.

## Test Setup

- **Test vault**: `/Users/josephfajen/git/tagging-agent-test-vault` (copy of test-vault, isolated from repo)
- **Notes**: 55 markdown files across 10 folders
- **Schema note**: `Proposed Tagging System.md` created with generalized categories and migration rules
- **Config**: `VAULT_PATH` pointed to test vault, default `SCHEME_NOTE_PATH`

## Results Summary

| Metric | Value |
|--------|-------|
| Total cost | $0.93 |
| Notes processed | 51/55 (1 templater, 3 reports) |
| Success rate | 100% of processable notes |
| Compliance | 98% |

### Phase Breakdown

| Phase | Cost | Duration | Outcome |
|-------|------|----------|---------|
| Audit | $0.35 | ~2 min | 65 unique tags cataloged |
| Plan | $0.17 | ~1 min | Mapping table created |
| Generate Worklist | $0.00 | <1s | 190 changes across 51 notes |
| Execute | $0.10 | ~30s | 51/51 notes migrated |
| Verify | $0.31 | ~1 min | 98% compliance confirmed |

## What Worked Well

### 1. Schema Note Discovery
The pre-flight check correctly found the schema note and provided clear error messaging when tested without one.

### 2. Interactive Flow
All phases transitioned smoothly. The guided experience with review checkpoints worked as designed.

### 3. Fallback Mapping Loading
`loadMappings()` successfully fell back to `audit-data.json` when `plan-mappings.json` was missing, allowing the migration to complete.

### 4. Templater Handling
The templater note (`Edge Cases/templater-note.md`) was correctly skipped with an appropriate warning about unparseable YAML in frontmatter.

### 5. Git Checkpoints
Commits were created at each phase boundary, providing rollback points.

### 6. Cost Efficiency
Total cost of $0.93 for a 55-note vault is reasonable. Execute phase at $0.10 confirms the prompt injection optimization is working.

## What Didn't Work As Intended

### 1. `plan-mappings.json` Not Created

**Expected**: Plan phase writes `plan-mappings.json` with user-approved mappings.

**Actual**: Plan phase did NOT write this file. The agent wrote mappings to the markdown plan but skipped the JSON output step despite explicit instructions in the prompt.

**Impact**: Low — migration succeeded via fallback to `audit-data.json`.

**Evidence**:
```
$ ls data/
audit-data.json
migration-progress.json
migration-worklist.json
# plan-mappings.json is MISSING
```

**Root Cause Hypothesis**: The plan phase prompt includes the `write_data_file` instruction in "Phase 4", but the agent may have considered the task complete after writing the markdown and committing. The instruction may not be prominent enough.

### 2. Audit Phase Wrote Mappings

**Expected**: Audit discovers tags and writes frequencies; mappings come from plan phase.

**Actual**: Audit phase read the schema note and derived mappings, writing them to `audit-data.json`.

**Impact**: Neutral — this actually helped since plan-mappings.json wasn't created. But it blurs the separation of concerns.

**Evidence**:
```json
// audit-data.json contains 37 mappings
"mappings": {
  "research": "type/research",
  "career": "area/career",
  ...
}
```

## Recommendations

### Short-term Fixes

1. **Strengthen plan phase prompt** — Move the `write_data_file` instruction earlier and make it more explicit:
   ```
   CRITICAL: After writing the plan note, you MUST also write plan-mappings.json.
   This is required for the worklist generator.
   ```

2. **Add validation** — The `checkPlanPrerequisites` or a new check could verify `plan-mappings.json` exists before generate-worklist.

### Medium-term Improvements

3. **Code-driven JSON extraction** — Have the plan phase code parse the markdown mapping table and write JSON, rather than relying on the LLM to do it.

4. **Clearer phase responsibilities** — Update audit prompt to NOT read the schema note or derive mappings. Reserve that for plan phase.

### Long-term Considerations

5. **Vault-namespaced data** — Store data in `data/<vault-hash>/` to support multiple vaults without manual backup/restore.

6. **Schema note validation** — Parse the schema note and validate its structure before starting audit.

## Files Changed in This Feature

| File | Change |
|------|--------|
| `lib/config.ts` | Added `schemeNotePath` to Config |
| `tag-scheme.ts` | Minimized `TAG_MAPPINGS` to noise patterns only |
| `lib/worklist-generator.ts` | `loadMappings()` with plan-mappings.json priority |
| `tagging-agent.ts` | Updated prompts, added `checkSchemeNoteExists()` |
| `.env.example` | Documented `SCHEME_NOTE_PATH` |
| `README.md` | Added "Getting Started with Your Vault" section |
| Tests | Updated for new behavior |

## Conclusion

**Verdict**: The generalization implementation is **functional but incomplete**.

The core goal was achieved — a new user CAN run the full migration with their own schema note, without editing code. The missing `plan-mappings.json` is a gap in the intended architecture, but the fallback behavior ensured the migration succeeded.

Priority for follow-up: **Medium** — The system works, but the plan phase should be fixed to write the JSON file as designed. This maintains the intended separation between audit-discovered mappings and user-approved mappings.

## Test Artifacts

- Test vault: `/Users/josephfajen/git/tagging-agent-test-vault`
- Git commits in test vault:
  - `12c31f7` Initial test vault state
  - `30b5b0d` Audit checkpoint
  - `0e6c348` Plan checkpoint
  - `e5c3c47` Execute batch 1
  - `2321a67` Verification checkpoint
