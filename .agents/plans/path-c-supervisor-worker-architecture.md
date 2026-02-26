---
status: SUPERSEDED
created: 2026-02-05
superseded_by: 12-supervisor-worker-implementation.md
note: Design document — implementation tracked in separate plan
---

# Design: Path C — Supervisor/Worker Architecture

## Vision

Transform the tagging agent from a rigid phase-based CLI into a **collaborative automation assistant**. The user converses naturally with an agent that understands intent, helps scope work, previews changes, and executes reliably.

**Core principle:** The agent supervises and advises; code executes deterministically.

---

## Interaction Model

### Design Philosophy

An agentic experience means:
- Natural language interaction, not config files
- The agent understands *intent*, not just *commands*
- The agent can adapt, suggest, and negotiate scope
- The user feels like they're collaborating, not configuring
- Execution is predictable and cost-controlled

### Conversation Examples

#### Example 1: Full Migration

```
User: I want to migrate all my tags to the new scheme

Agent: I'll scan your vault to understand the current state.

       [Scans 884 notes]

       Here's what I found:
       - 627 notes need tag changes
       - 257 are already compliant or have no tags
       - 7 are Templater templates (will skip)

       Estimated: 627 notes across ~13 batches
       Estimated cost: $1.50-2.00 (using Sonnet)

       How would you like to proceed?
       1. Start full migration
       2. Focus on a specific folder first
       3. Preview sample changes before deciding

User: Preview some changes first

Agent: Here are changes for 5 representative notes:

       1. Journal/2025-01-15.md
          - #daily-reflection → type/daily-note
          - #gratitude → remove (not in scheme)

       2. Projects/Blockfrost API.md
          - #blockchain → keep (valid flat tag)
          - Add: project/blockfrost

       [shows 3 more...]

       These follow your tagging scheme. Ready to proceed?

User: Yes, start the migration

Agent: Starting migration. I'll process 50 notes per batch and commit after each.

       [Batch 1: 50 notes processed, committed]
       Progress: 50/627 (8%)

       [Batch 2: 50 notes processed, committed]
       Progress: 100/627 (16%)

       Continue with next batch?
```

#### Example 2: Targeted Tune-Up

```
User: Check my recent notes for tagging issues

Agent: Looking for notes modified in the last 7 days...

       Found 12 recent notes:
       - 8 have proper tags
       - 3 need migration
       - 1 has no tags

       Would you like me to:
       1. Fix the 3 that need migration
       2. Also suggest tags for the untagged note
       3. Show details first

User: Fix the 3 and suggest for the other

Agent: Processing 3 notes...

       Done. Changes committed.

       For "Ideas/Content Strategy.md" (currently untagged), I suggest:
       - type/brainstorm
       - area/career
       - content-creation

       Apply these tags?
```

#### Example 3: Specific File List

```
User: Process these notes:
      - Projects/ISEE Migration.md
      - Archive/Old Meeting Notes.md

Agent: Analyzing 2 notes...

       1. Projects/ISEE Migration.md
          #project → project/isee
          #technical → keep (valid)

       2. Archive/Old Meeting Notes.md
          #meeting-notes → type/meeting
          #iog → area/iog

       Apply these changes?

User: Yes

Agent: Done. 2 notes updated, changes committed.
```

#### Example 4: Folder-Scoped Work

```
User: Just process my Journal folder

Agent: Scanning Journal/...

       Found 245 notes:
       - 180 need tag migration (mostly #daily-reflection → type/daily-note)
       - 65 already compliant

       This will take ~4 batches. Proceed?
```

---

## Architecture

### Layer Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    CONVERSATION LAYER                        │
│                    (Interactive REPL)                        │
│                                                              │
│  • Reads user input                                         │
│  • Displays agent responses                                 │
│  • Handles Ctrl+C gracefully                                │
│  • Manages session state                                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    SUPERVISOR AGENT (LLM)                    │
│                                                              │
│  Responsibilities:                                          │
│  • Parse user intent (what do they want?)                   │
│  • Negotiate scope (which files? how many?)                 │
│  • Generate previews (show before doing)                    │
│  • Narrate progress (meaningful updates)                    │
│  • Handle exceptions (judgment calls)                       │
│                                                              │
│  Model: Sonnet (good reasoning, reasonable cost)            │
│                                                              │
│  Tools available:                                           │
│  • list_notes, read_note, search_notes (discovery)          │
│  • execute_batch (triggers worker)                          │
│  • preview_changes (shows without applying)                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ work plan (JSON)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    EXECUTION ENGINE (Code)                   │
│                                                              │
│  Responsibilities:                                          │
│  • Apply tag changes deterministically                      │
│  • Track progress in migration-progress.json                │
│  • Create git commits after batches                         │
│  • Report results back to supervisor                        │
│                                                              │
│  NO LLM calls — pure TypeScript                             │
│                                                              │
│  Functions:                                                 │
│  • computeChanges(scope) → NoteChanges[]                    │
│  • applyBatch(changes) → BatchResult                        │
│  • previewBatch(changes) → PreviewResult                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Key Interfaces

```typescript
// Scope selection — what the user wants to process
type WorkScope =
  | { type: 'full' }                           // All notes
  | { type: 'folder', path: string }           // Specific folder
  | { type: 'files', paths: string[] }         // Specific files
  | { type: 'recent', days: number }           // Recently modified
  | { type: 'tag', tagName: string }           // Notes with specific tag

// What the supervisor asks the worker to do
interface WorkPlan {
  scope: WorkScope;
  changes: NoteChanges[];
  batchSize: number;
}

// What the worker reports back
interface BatchResult {
  processed: number;
  succeeded: number;
  warnings: Array<{ path: string; message: string }>;
  errors: Array<{ path: string; error: string }>;
  commitHash: string;
}

// Preview without applying
interface PreviewResult {
  changes: Array<{
    path: string;
    removals: string[];
    additions: string[];
    keeps: string[];
  }>;
  totalNotes: number;
  totalChanges: number;
}
```

### New MCP Tools for Supervisor

```typescript
// Preview changes without applying
preview_changes: {
  input: { scope: WorkScope, limit?: number }
  output: PreviewResult
}

// Execute a batch of changes (calls worker code)
execute_batch: {
  input: { changes: NoteChanges[], commitMessage?: string }
  output: BatchResult
}

// Get current progress
get_progress: {
  input: {}
  output: {
    totalInScope: number,
    processed: number,
    remaining: number,
    lastBatchAt: string
  }
}
```

---

## MVP Scope

### In Scope (Build Now)

1. **Scope Selection**
   - Full vault (existing)
   - Specific folder
   - Specific file list
   - Recent changes (last N days)

2. **Preview Mode**
   - Show changes before applying
   - Configurable sample size
   - Clear formatting of add/remove/keep

3. **Code-Driven Execution**
   - Supervisor calls `execute_batch` tool
   - Tool runs deterministic code (no LLM)
   - Returns structured result to supervisor

4. **Conversational Flow**
   - Natural language scope selection
   - Confirmation before destructive actions
   - Meaningful progress narration

5. **Model Optimization**
   - Sonnet 4.5 for supervisor (good judgment, reasonable cost)
   - No LLM for execution (code only)

### Out of Scope (Defer for Later)

1. **Complex Query Syntax**
   - "Notes with tag X but not tag Y"
   - "Notes older than 6 months"
   - Can add later as scope types

2. **Automatic Tag Suggestions**
   - Suggesting tags for untagged notes based on content
   - Requires content analysis, separate feature

3. **Scheduled Tune-Ups**
   - Cron-style "check weekly for new notes"
   - Nice-to-have, not essential for MVP

4. **Undo/Revert via Agent**
   - "Undo the last batch"
   - Git revert exists; agent integration later

5. **Multi-Vault Support**
   - Processing multiple vaults
   - Different schemes per vault

6. **Tag Scheme Editor**
   - Modifying TAG_MAPPINGS via conversation
   - Currently edit tag-scheme.ts directly

---

## Staged Refactoring Plan

### Stage 1: Scope Selection (Foundation)

**Goal:** User can specify what to process instead of "everything or nothing"

**Changes:**
- Add `WorkScope` type to `lib/types.ts`
- Add `scopeToNotes(scope: WorkScope): string[]` function
- Update `computeNextBatch` to accept scope parameter
- Update interactive agent to ask about scope

**Files affected:**
- `lib/worklist-generator.ts` — Add scope filtering
- `lib/interactive-agent.ts` — Add scope conversation
- `lib/session-state.ts` — Persist selected scope

**Validation:**
- User can say "just the Journal folder" and only those notes are processed
- Scope persists across session resume

### Stage 2: Preview Mode

**Goal:** User can see changes before applying them

**Changes:**
- Add `preview_changes` MCP tool
- Add preview conversation flow to supervisor
- Format preview output clearly

**Files affected:**
- `tools/tag-tools.ts` — Add `preview_changes` tool
- `lib/interactive-agent.ts` — Add preview state/flow
- `lib/agent-personality.ts` — Update prompts for preview

**Validation:**
- User can say "preview first" and see sample changes
- Preview shows clear add/remove/keep formatting
- User can proceed or cancel after preview

### Stage 3: Code-Driven Execution

**Goal:** Execution is deterministic code triggered by supervisor

**Changes:**
- Add `execute_batch` MCP tool that runs code, not LLM
- Supervisor agent uses this tool instead of calling `apply_tag_changes` directly
- Remove `search_notes` from execute-phase allowed tools

**Files affected:**
- `tools/tag-tools.ts` — Add `execute_batch` tool
- `lib/interactive-agent.ts` — Simplify execute phase
- `lib/agent-personality.ts` — Simplify execute instructions

**Validation:**
- Execute phase cost drops to ~$0.10-0.20 per batch
- No autonomous discovery behavior
- Progress tracking works correctly

### Stage 4: Polish & Model Optimization

**Goal:** Smooth conversation flow, optimized costs

**Changes:**
- Add phase-specific model selection
- Improve conversation transitions
- Add session cost tracking
- Better error messages

**Files affected:**
- `lib/config.ts` — Add `PHASE_MODELS` config
- `lib/interactive-agent.ts` — Use phase models
- `tagging-agent.ts` — Pass model config through

**Validation:**
- Full migration costs ~$1.50-2.00 total (vs current ~$20+)
- Conversation feels natural and helpful
- User understands what's happening at each step

---

## Success Criteria

### Functional

- [ ] User can scope work to: full vault, folder, file list, recent changes
- [ ] User can preview changes before applying
- [ ] Execute phase is code-driven (no LLM reasoning during apply)
- [ ] Progress tracking works accurately
- [ ] Session can be paused and resumed with scope preserved

### Experience

- [ ] Conversation feels collaborative, not transactional
- [ ] User always knows what will happen before it happens
- [ ] Error messages are helpful, not cryptic
- [ ] Agent asks clarifying questions when intent is ambiguous

### Cost

- [ ] Full vault migration (627 notes): < $2.50 total
- [ ] Targeted tune-up (10-20 notes): < $0.30
- [ ] Preview-only (no apply): < $0.10

### Reliability

- [ ] Execute phase follows the work plan exactly
- [ ] No "autonomous discovery" behavior
- [ ] Git commits happen after every batch
- [ ] Errors don't crash the session; supervisor handles them

---

## Model Selection Strategy

| Phase/Task | Model | Rationale |
|------------|-------|-----------|
| Supervisor (conversation) | Sonnet 4.5 | Good reasoning, understands intent |
| Audit (if re-run) | Sonnet 4.5 | Classification judgment |
| Preview generation | Sonnet 4.5 | Formatting, explanation |
| Execute batch | None (code) | Deterministic, no LLM needed |
| Error recovery | Sonnet 4.5 | Judgment on how to proceed |
| Tag suggestions (future) | Sonnet 4.5 or Opus 4.5 | Content analysis |

**Cost projection:**
- Supervisor turn: ~$0.02-0.05
- Full migration conversation (20 turns): ~$0.50-1.00
- Execute batches (13 x $0.00): $0.00
- Total: ~$0.50-1.00 (down from $15-25)

**Batch size configurability:** User should be able to say "smaller batches please"?
- Keep default at 50

---

## Open Questions

2. **Dry-run mode:** Separate from preview?
   - Preview shows samples; dry-run could write full report without applying
   - Defer decision until Stage 2

3. **Conversation persistence:** Save just state
   - State is sufficient for resume
   - Full history nice for debugging, but adds complexity
   - Add "session logging" now or for a future improvement?

---

## References

- Current architecture: `tagging-agent.ts`, `lib/interactive-agent.ts`
- Retrospective with behavioral observations: `.agents/retrospectives/interactive-mode-validation-2026-02-04.md`
- Original PRD: `PRD.md`
