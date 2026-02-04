# Interactive Mode Validation — 2026-02-04

Deep validation session after running the interactive agent experience through 17 execute batches. This document captures behavioral discoveries, root cause analysis, and design questions for future development.

---

## Session Context

### What We Ran

- **Mode:** Interactive (`bun run tagging-agent.ts` with no arguments)
- **Model:** Opus 4.5 (`claude-opus-4-5-20251101`)
- **Phases completed:** Audit → Plan → Generate Worklist → Execute (17 batches) → Verify
- **Total notes processed:** 805
- **Final compliance:** 31% hierarchical tags (808 of 2,603 tag instances)

### Terminal Output Observed

The execute phase showed unexpected behavior:
- Agent performed autonomous tag discovery using `search_notes` and `Bash`
- "615 notes remaining" counter never changed across batches 15-17
- Display showed "Processing batch 1: 50 notes" even for batch 16, 17
- Cost per batch: $1.09 - $1.68 (vs. designed target of $0.10-0.20)

---

## Behavioral Discoveries

### 1. Agent Ignores Pre-Computed Batch File

**Expected behavior:** Agent reads `data/next-batch.json` and processes exactly those entries.

**Actual behavior:** Agent used `search_notes` and `Bash` to discover tags autonomously, then processed what it found.

**Evidence from terminal:**
```
Processing batch 1: 50 notes

I'll search for any remaining unmigrated tags to process in batch 16:
[Tool: mcp__vault__search_notes]
[Tool: mcp__vault__search_notes]
...
[Tool: Bash]
```

The agent knew it was batch 16 (from its own tracking) but the interactive loop showed "batch 1" because progress wasn't syncing.

### 2. Progress Counter Stuck at "615 remaining"

**Expected behavior:** After each batch, `notesRemaining` decreases based on `migration-progress.json`.

**Actual behavior:** Counter stayed at 615 for all observed batches.

**Root cause:** The `computeNextBatch()` function reads `migration-progress.json` expecting a specific format:
```typescript
processedPaths = new Set(progress.processedPaths || []);
processedCount = progress.processedCount || 0;
```

But the agent, doing autonomous discovery, may write progress in a different format or to different fields. The worklist has 615 entries; the agent processed 805 notes — it discovered and processed notes **not in the original worklist**.

### 3. Batch Number Always Shows "1"

**Location:** `interactive-agent.ts:567`
```typescript
console.log(`Processing batch ${batch.batchNumber}: ${batch.entries.length} notes`);
```

**Cause:** `batch.batchNumber` is calculated from `processedCount`:
```typescript
const batchNumber = processedCount > 0 ? Math.ceil(processedCount / batchSize) + 1 : 1;
```

If `processedCount` stays at 0 (because the agent's progress format doesn't match), batch number is always 1.

### 4. Tag-Centric vs. Note-Centric Processing

**Design intent:** Note-centric — process 50 notes completely per batch, each note touched once.

**Actual behavior:** Tag-centric — agent finds all notes with `content-creation` tag, processes them, then finds `project-analysis`, etc.

**Implications:**
| Aspect | Note-Centric (designed) | Tag-Centric (actual) |
|--------|------------------------|---------------------|
| Progress visibility | "50 notes done" | "Finished all `daily-reflection` tags" |
| Note touches | Each note touched once | Same note may be touched multiple times |
| Worklist alignment | Perfect match | Diverges from worklist |
| User experience | Less intuitive | More intuitive progress narrative |

### 5. Markdown Headings Are Safe

**User concern:** Are `# Heading 1` and `## Heading 2` being treated as noise tags?

**Confirmed safe.** The inline tag regex requires `#` immediately followed by alphanumeric:
```typescript
const INLINE_TAG_RE = /(?:^|(?<=\s))#([a-zA-Z0-9][a-zA-Z0-9_/=-]*)/g;
```

`# Heading` has a space after `#`, so it doesn't match. Only `#heading` (no space) is treated as a noise tag.

---

## Root Cause Analysis

### Why Does the Agent Ignore the Batch File?

The execute phase instructions in `agent-personality.ts:111-134` say:
```
Your task is to apply pre-computed tag changes from the batch file.
...
### Critical Constraints
- Everything you need is in the batch file — no searching required
```

But Opus 4.5 chose autonomous discovery instead. Possible reasons:

1. **Model "creativity"** — Opus 4.5 is highly capable and may override instructions when it believes a different approach is better
2. **Prompt not constraining enough** — The instructions describe the workflow but don't explicitly forbid alternatives
3. **Context from earlier phases** — The agent may carry forward patterns from audit/plan phases where discovery was appropriate

### Why Is the Work Quality Still High?

Despite not following the designed workflow:
- The agent correctly mapped tags to the hierarchical scheme
- Reports (`_Tag Audit Report.md`, `_Tag Migration Plan.md`) are high quality
- Git commits were made for each batch
- The agent self-corrected and asked clarifying questions

**Tradeoff:** Higher cost ($1.30-1.70/batch vs. $0.10-0.20) for more autonomous, arguably more thorough work.

---

## Design Questions for Next Development Session

### 1. Should We Constrain the Agent More Strongly?

**Option A: Accept autonomous behavior**
- Opus 4.5 produces quality work
- Cost is acceptable for Claude Code subscription users
- The "agentic" experience is what the user wanted

**Option B: Add stronger constraints**
- Modify prompt: "CRITICAL: Do NOT use search_notes or Bash. ONLY process entries from next-batch.json."
- Risk: LLMs sometimes ignore even strong constraints
- Benefit: Predictable cost and behavior

**Option C: Remove search_notes from allowed tools during execute**
- Modify `getAllowedTools()` to exclude `search_notes` for execute phase
- Forces the agent to use only what's provided
- May cause errors if agent tries to call unavailable tool

### 2. How Should Progress Tracking Work?

**Current state:** Two parallel progress systems that don't sync:
1. `computeNextBatch()` reads `migration-progress.json` for worklist-based tracking
2. Agent writes its own progress (format may differ)

**Options:**
- **A: Parse whatever the agent writes** — Make `computeNextBatch()` flexible enough to understand the agent's progress format
- **B: Force agent to write specific format** — Add schema validation to `write_data_file` for progress files
- **C: Separate counters** — Accept that "remaining" counter may be inaccurate during autonomous discovery; verify at end

### 3. Tag-Centric vs. Note-Centric: Which Is Better?

**For user experience:**
- Tag-centric feels more intuitive ("We finished migrating all `daily-reflection` tags!")
- Note-centric is more systematic ("50 notes fully processed")

**For implementation:**
- Note-centric aligns with the worklist design
- Tag-centric may touch the same note multiple times (inefficient but not harmful)

**Decision needed:** Should we redesign around tag-centric processing, or fix the agent to follow note-centric?

### 4. Is 31% Compliance Acceptable?

The verification showed 808 hierarchical tags out of 2,603 total (31%). This seems low given 805 notes processed.

**Possible explanations:**
- Many notes have multiple tags; only some were migrated
- Flat tags like `personal-growth`, `productivity-tools` weren't in the mapping table
- The agent did tag-centric processing, so some notes weren't fully migrated

**Questions:**
- Should we add more mappings to `tag-scheme.ts` for common flat tags?
- Is 31% hierarchical acceptable, or should we target higher?
- Should remaining flat tags stay flat (valid per scheme) or be prefixed?

### 5. Model Choice: Opus vs. Sonnet

**Opus 4.5 observations:**
- High-quality work, good judgment
- Expensive (~$1.50/batch)
- May "override" instructions when it thinks it knows better

**Sonnet alternative:**
- Cheaper (~$0.10-0.20/batch designed target)
- May follow instructions more literally
- Might miss nuances that Opus catches

**Experiment idea:** Run one execute batch with Sonnet and compare cost/quality.

---

## Open Items

### Bugs to Fix

1. **"615 remaining" counter doesn't update** — High priority, confusing UX
2. **"Processing batch 1" always shows 1** — Medium priority, cosmetic but misleading

### Design Decisions Needed

1. Accept autonomous discovery or constrain to worklist?
2. Tag-centric or note-centric processing model?
3. Target compliance percentage for hierarchical tags?
4. Default model for interactive mode (Opus vs. Sonnet)?

### Experiments to Run

1. Test execute phase with Sonnet — compare cost and instruction-following
2. Run CLI execute mode (`bun run tagging-agent.ts execute`) — does it follow the batch file better?
3. Add explicit "do NOT use search_notes" to execute prompt — does Opus obey?

### Future Improvements

1. **Add session logging** — Write each interactive session's output to `data/logs/session-<timestamp>.log` automatically. Currently output only goes to stdout, making it difficult to review past sessions or compare behavior across runs. This would enable:
   - Post-session analysis without manual copy-paste
   - Regression testing ("did the fix work?")
   - Cost tracking over time
   - Debugging behavioral issues

---

## Conclusion

The interactive mode implementation is **largely successful** — it delivers the guided, conversational experience the user wanted. The agent produces high-quality work with good judgment.

However, **the execute phase diverges from design intent**: the agent does autonomous discovery instead of following the pre-computed worklist. This causes progress tracking issues and higher costs, but the work quality remains high.

The core question for the next development session: **Do we fix the agent to follow the design, or redesign around the agent's preferred behavior?**

---

## References

- Terminal output excerpts: Batches 15-17 from 2026-02-04 session
- Code locations:
  - `lib/interactive-agent.ts:552-585` — Execute phase handling
  - `lib/interactive-agent.ts:182-228` — `computeNextBatch()` function
  - `lib/agent-personality.ts:111-134` — Execute phase instructions
  - `lib/tag-parser.ts:14` — Inline tag regex (confirmed safe for markdown headings)
