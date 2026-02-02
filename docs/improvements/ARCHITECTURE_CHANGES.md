# Architecture Changes: Worklist and Progress Tracking

## Overview

The maiden voyage revealed that the plan→execute data flow is broken. The plan phase produces human-readable output, forcing the execute phase to rediscover work on every batch. This document specifies the new data structures that enable efficient execution.

---

## Data Flow: Before and After

### Current (Inefficient)

```
┌─────────┐    mapping table    ┌──────────┐
│  Plan   │ ──────────────────► │ Execute  │
│  Phase  │    (human-readable) │  Phase   │
└─────────┘                     └──────────┘
                                     │
                                     ▼
                               ┌──────────┐
                               │ search_  │ ◄── 40% of budget
                               │ notes    │     wasted here
                               └──────────┘
                                     │
                                     ▼
                               ┌──────────┐
                               │ read_    │ ◄── redundant
                               │ note     │     per note
                               └──────────┘
```

### Target (Efficient)

```
┌─────────┐    JSON worklist    ┌──────────┐
│  Plan   │ ──────────────────► │ Execute  │
│  Phase  │    (machine-ready)  │  Phase   │
└─────────┘                     └──────────┘
     │                               │
     ▼                               ▼
┌─────────────────┐          ┌─────────────────┐
│ Scans all notes │          │ Reads worklist  │
│ ONCE during     │          │ + progress file │
│ plan phase      │          │ NO searching    │
└─────────────────┘          └─────────────────┘
                                     │
                                     ▼
                             ┌───────────────┐
                             │ apply_tag_    │
                             │ changes only  │
                             └───────────────┘
```

---

## Schema: Migration Worklist

This JSON structure is embedded in `_Tag Migration Plan.md` inside a fenced code block.

```typescript
interface MigrationWorklist {
  // Metadata
  generatedAt: string;        // ISO 8601 timestamp
  schemeVersion: string;      // Version of tagging scheme used
  generatedBy: string;        // "plan-phase-agent"
  
  // Summary stats
  totalNotes: number;         // Total notes in worklist
  totalChanges: number;       // Sum of all individual tag changes
  
  // The worklist itself
  worklist: NoteChanges[];
  
  // Tags that couldn't be mapped (requires user decision)
  unmappedTags: UnmappedTag[];
}

interface NoteChanges {
  path: string;               // Relative path from vault root
  changes: TagChange[];       // All changes for this note
}

interface TagChange {
  oldTag: string;             // Tag as it exists in the note (without #)
  newTag: string | null;      // New tag, or null to remove
  location: "frontmatter" | "inline" | "both";  // Where the old tag was found
}

interface UnmappedTag {
  tag: string;                // The unmapped tag
  occurrences: number;        // How many times it appears
  notePaths: string[];        // Which notes contain it
  suggestedMapping?: string;  // Optional suggestion from agent
}
```

### Example Worklist

```json
{
  "generatedAt": "2026-01-31T10:00:00Z",
  "schemeVersion": "1.0",
  "generatedBy": "plan-phase-agent",
  "totalNotes": 597,
  "totalChanges": 1847,
  "worklist": [
    {
      "path": "Journal/2025-01-15.md",
      "changes": [
        { "oldTag": "daily-reflection", "newTag": "type/daily-note", "location": "inline" },
        { "oldTag": "heading", "newTag": null, "location": "inline" },
        { "oldTag": "todo", "newTag": "status/pending", "location": "frontmatter" }
      ]
    },
    {
      "path": "Projects/Blockfrost API.md",
      "changes": [
        { "oldTag": "project-catalyst", "newTag": "project/catalyst", "location": "frontmatter" },
        { "oldTag": "technical-writing", "newTag": "technical-writing", "location": "both" }
      ]
    },
    {
      "path": "Archive/Old Note.md",
      "changes": [
        { "oldTag": "2", "newTag": null, "location": "inline" }
      ]
    }
  ],
  "unmappedTags": [
    {
      "tag": "complex-query",
      "occurrences": 2,
      "notePaths": ["Research/Query Analysis.md", "Projects/Search.md"],
      "suggestedMapping": "type/research"
    },
    {
      "tag": "code_review",
      "occurrences": 1,
      "notePaths": ["Dev/PR Review.md"],
      "suggestedMapping": "code-review"
    }
  ]
}
```

---

## Schema: Progress Tracking

This JSON is stored in `_Migration_Progress.json` at the vault root.

```typescript
interface MigrationProgress {
  // Identity
  migrationId: string;        // Unique ID for this migration run
  worklistSource: string;     // Path to the plan note containing worklist
  
  // Timestamps
  startedAt: string;          // When migration started
  lastUpdatedAt: string;      // When progress was last saved
  
  // Counts
  totalInWorklist: number;    // Total notes to process
  processedCount: number;     // Notes completed so far
  remainingCount: number;     // Notes still to do
  
  // Processed paths (for deduplication)
  processedPaths: string[];   // Paths of completed notes
  
  // Batch history (for auditing)
  batchHistory: BatchRecord[];
  
  // Error tracking
  errors: ErrorRecord[];
}

interface BatchRecord {
  batchNumber: number;
  startedAt: string;
  completedAt: string;
  notesProcessed: number;
  commitHash: string;
  warnings: string[];
}

interface ErrorRecord {
  timestamp: string;
  notePath: string;
  error: string;
  recoverable: boolean;
}
```

### Example Progress File

```json
{
  "migrationId": "2026-01-31-tagging-v1",
  "worklistSource": "_Tag Migration Plan.md",
  "startedAt": "2026-01-31T10:30:00Z",
  "lastUpdatedAt": "2026-01-31T12:15:00Z",
  "totalInWorklist": 597,
  "processedCount": 150,
  "remainingCount": 447,
  "processedPaths": [
    "Journal/2025-01-15.md",
    "Journal/2025-01-16.md",
    "Journal/2025-01-17.md",
    "Projects/Blockfrost API.md"
  ],
  "batchHistory": [
    {
      "batchNumber": 1,
      "startedAt": "2026-01-31T10:30:00Z",
      "completedAt": "2026-01-31T10:45:00Z",
      "notesProcessed": 50,
      "commitHash": "a7d6925",
      "warnings": []
    },
    {
      "batchNumber": 2,
      "startedAt": "2026-01-31T10:50:00Z",
      "completedAt": "2026-01-31T11:05:00Z",
      "notesProcessed": 50,
      "commitHash": "b8e7036",
      "warnings": ["Note 'Old Draft.md' had duplicate tags after mapping"]
    },
    {
      "batchNumber": 3,
      "startedAt": "2026-01-31T11:10:00Z",
      "completedAt": "2026-01-31T11:25:00Z",
      "notesProcessed": 50,
      "commitHash": "c9f8147",
      "warnings": []
    }
  ],
  "errors": []
}
```

---

## Plan Phase: Worklist Generation Algorithm

The plan phase agent must follow this algorithm after creating the mapping table:

```
1. READ ALL NOTES
   notes = list_notes({ recursive: true })
   
2. FILTER TO TAGGED NOTES
   taggedNotes = notes.filter(n => n.tagCount > 0)
   
3. FOR EACH TAGGED NOTE
   for note in taggedNotes:
       noteData = read_note({ path: note.path, detail: "minimal" })
       changes = []
       
       for tag in noteData.allTags:
           # Look up in mapping table
           mapping = lookupMapping(tag)
           
           if mapping.action == "REMOVE":
               changes.push({ oldTag: tag, newTag: null, location: ... })
           elif mapping.action == "MAP":
               changes.push({ oldTag: tag, newTag: mapping.newTag, location: ... })
           elif mapping.action == "UNMAPPED":
               addToUnmappedList(tag, note.path)
           # "KEEP" action = no change needed, don't add to changes
       
       if changes.length > 0:
           worklist.push({ path: note.path, changes })

4. WRITE WORKLIST TO PLAN NOTE
   Append JSON block to _Tag Migration Plan.md
```

### Token Budget Estimate for Plan Phase

- `list_notes` for 884 notes: ~17K tokens output
- `read_note` minimal for 597 tagged notes: ~50 tokens each = ~30K tokens
- Writing plan note with worklist: ~20K tokens
- **Total: ~70K tokens ≈ $0.50-0.80**

This is more expensive than the original plan phase ($0.10) but eliminates $4+ of execute overhead.

---

## Execute Phase: Processing Algorithm

The execute phase agent must follow this exact algorithm:

```
1. READ PROGRESS
   try:
       progress = read_note("_Migration_Progress.json")
       processedPaths = Set(progress.processedPaths)
       batchNumber = progress.batchHistory.length + 1
   catch FileNotFound:
       processedPaths = Set()
       batchNumber = 1
       progress = createInitialProgress()

2. READ WORKLIST
   planNote = read_note("_Tag Migration Plan.md", detail: "full")
   worklist = parseJsonFromPlanNote(planNote)

3. COMPUTE THIS BATCH
   remaining = worklist.filter(item => !processedPaths.has(item.path))
   batch = remaining.slice(0, batchSize)
   
   if batch.length == 0:
       report("Migration complete! All notes processed.")
       exit

4. PRE-COMMIT
   git_commit({ message: f"Pre-batch {batchNumber} checkpoint" })

5. PROCESS BATCH
   results = []
   for item in batch:
       result = apply_tag_changes({ path: item.path, changes: item.changes })
       results.push(result)
       processedPaths.add(item.path)

6. UPDATE PROGRESS
   progress.processedPaths = Array.from(processedPaths)
   progress.processedCount = processedPaths.size
   progress.remainingCount = worklist.length - processedPaths.size
   progress.lastUpdatedAt = now()
   progress.batchHistory.push({
       batchNumber,
       notesProcessed: batch.length,
       ...
   })
   write_note("_Migration_Progress.json", JSON.stringify(progress))

7. POST-COMMIT
   git_commit({ message: f"Tag migration batch {batchNumber}: {batch.length} notes" })

8. REPORT
   print(f"Batch {batchNumber} complete: {batch.length} notes processed")
   print(f"Remaining: {progress.remainingCount} notes")
   print(f"Warnings: {results.filter(r => r.warnings.length > 0)}")
```

---

## Integration with Existing Tools

### No New Tools Required

The existing MCP tools are sufficient:

| Tool | Used For |
|------|----------|
| `list_notes` | Plan phase: enumerate all notes |
| `read_note` | Plan phase: get tags for each note |
| `read_note` | Execute phase: read progress file and plan note |
| `write_note` | Plan phase: write plan with worklist |
| `write_note` | Execute phase: update progress file |
| `apply_tag_changes` | Execute phase: apply changes per note |
| `git_commit` | Execute phase: checkpoint commits |

### Tool NOT to Use in Execute Phase

| Tool | Why Forbidden |
|------|---------------|
| `search_notes` | Worklist already contains all info |
| Bash | Violates MCP boundary |

---

## Migration from Old to New Architecture

### For Existing Migration Plans

If a migration plan exists without a worklist:
1. Re-run plan phase to generate worklist
2. Or: manually create worklist JSON based on mapping table (tedious)

### For In-Progress Migrations

If migration is partially complete:
1. Generate new plan with worklist
2. Create progress file with already-processed notes listed
3. Continue with new architecture

### Backward Compatibility

The new plan note format is backward compatible:
- Human-readable sections remain unchanged
- JSON worklist is appended in a new section
- Old plans still work (but execute phase will fall back to searching)
