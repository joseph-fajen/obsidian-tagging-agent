---
status: IMPLEMENTED
implemented_date: 2026-02-04
---

# Feature: Move Machine Data to Project Directory

The following plan should be complete, but validate documentation and codebase patterns before implementing.

Pay special attention to naming of existing utils, types, and models. Import from the right files.

## Feature Description

Move all machine-parseable JSON files (worklist, progress, batch, audit data) from the Obsidian vault to the project's `data/` directory. This fixes Obsidian crashes caused by the 139KB `_Tag Migration Plan.md` file with embedded JSON overwhelming the markdown renderer during indexing.

Human-readable markdown reports remain in the vault. Machine data moves to the project directory where it belongs.

## User Story

As an Obsidian vault owner using the tagging agent
I want machine data (JSON worklists, progress files) stored outside my vault
So that Obsidian doesn't crash during indexing and my vault stays clean for human use

## Problem Statement

The `_Tag Migration Plan.md` file contains a 5,439-line embedded JSON block (351 notes, 720 changes) that crashes Obsidian's Electron renderer during startup indexing. Additionally, JSON files in the vault (`_Migration_Worklist.json`, `_Migration_Progress.json`, `_Next_Batch.json`, `_Tag Audit Data.json`) clutter the knowledge base with machine data that doesn't belong there.

## Solution Statement

1. Create new MCP tools (`read_data_file`, `write_data_file`) for the project's `data/` directory
2. Update all system prompts to use these tools for JSON data
3. Update code to read/write from `data/` instead of vault
4. Remove embedded JSON from markdown plan (keep summary + mapping table only)
5. Add backward-compatible fallback to read from vault for existing setups

## Feature Metadata

**Feature Type**: Refactor / Bug Fix
**Estimated Complexity**: Medium
**Primary Systems Affected**: `tagging-agent.ts`, `lib/worklist-generator.ts`, `tools/`, prompts
**Dependencies**: None (uses existing patterns)

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING!

- `tools/vault-tools.ts` (lines 1-72) - Why: Template for new data-tools.ts structure, Zod patterns, error handling
- `tools/git-tools.ts` (lines 1-76) - Why: Simpler tool example, shows factory function pattern
- `lib/config.ts` (lines 1-42) - Why: Config interface to extend with dataPath
- `tagging-agent.ts` (lines 15-71) - Why: Audit prompt that writes JSON (needs update)
- `tagging-agent.ts` (lines 144-251) - Why: Execute prompt that reads JSON (needs update)
- `tagging-agent.ts` (lines 375-397) - Why: MCP server assembly (add data tools)
- `tagging-agent.ts` (lines 418-462) - Why: Pre-flight functions (update paths)
- `lib/worklist-generator.ts` (lines 216-282) - Why: Functions that read/write JSON (update paths)
- `reference/adding_tools_guide.md` - Why: Required docstring format for new tools

### New Files to Create

- `tools/data-tools.ts` - MCP tools for reading/writing to project `data/` directory
- `tests/data-tools.test.ts` - Unit tests for new data tools

### Files to Modify

- `lib/config.ts` - Add `dataPath` to Config interface
- `tagging-agent.ts` - Update prompts, pre-flight, MCP server registration
- `lib/worklist-generator.ts` - Update paths, remove embedded JSON from markdown
- `.gitignore` - Add `data/` directory
- `README.md` - Document `data/` directory
- `tests/worklist-generator.test.ts` - Update for new paths

### Relevant Documentation — READ BEFORE IMPLEMENTING!

- `reference/adding_tools_guide.md` - Required docstring format (Use this when, Do NOT use, Performance notes, Examples)
- `PRD.md` Section 7 - Tool specifications pattern
- `CLAUDE.md` - Project conventions (named exports, kebab-case, Zod validation)

### Patterns to Follow

**MCP Tool Structure** (from `vault-tools.ts`):
```typescript
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

function errorResult(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

export function createDataTools(dataPath: string) {
  const readDataFile = tool(
    "read_data_file",
    `Docstring following adding_tools_guide.md template...`,
    {
      filename: z.string().describe("Filename to read from data/ directory"),
    },
    async ({ filename }) => {
      // implementation
    },
  );
  return [readDataFile];
}
```

**Config Extension** (from `lib/config.ts`):
```typescript
export interface Config {
  vaultPath: string;
  dataPath: string;  // NEW
  // ...existing fields
}
```

**Path Resolution** (Bun-specific):
```typescript
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Get project root (where tagging-agent.ts lives)
const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, "data");
```

**Error Handling Pattern**:
```typescript
function errorResult(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}
```

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — Config and Data Tools

Create the infrastructure for data directory access.

**Tasks:**
- Add `dataPath` to Config interface
- Create `data-tools.ts` with `read_data_file` and `write_data_file`
- Register data tools in MCP server
- Ensure `data/` directory is created on startup

### Phase 2: Update Code Paths

Modify TypeScript code to use `data/` instead of vault.

**Tasks:**
- Update `loadAuditMappings()` to check `dataPath` first, vault as fallback
- Update `writeWorklistJson()` to write to `dataPath`
- Update `formatWorklistMarkdown()` to NOT embed JSON
- Update pre-flight functions to use `dataPath`

### Phase 3: Update System Prompts

Modify LLM prompts to use new data tools.

**Tasks:**
- Update audit prompt to use `write_data_file` for JSON
- Update execute prompt to use `read_data_file` for batch/progress
- Update execute prompt to use `write_data_file` for progress updates

### Phase 4: Cleanup and Documentation

Finalize with tests, gitignore, and docs.

**Tasks:**
- Add `data/` to `.gitignore`
- Update README.md to document `data/` directory
- Create tests for new data tools
- Update existing tests for new paths

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task 1: UPDATE `lib/config.ts` — Add dataPath

- **IMPLEMENT**: Add `dataPath: string` to Config interface
- **IMPLEMENT**: Compute `dataPath` in `loadConfig()` relative to project root
- **PATTERN**: Use `import.meta.dir` (Bun) or fallback to `process.cwd()`
- **IMPORTS**: `import { join } from "path"`
- **GOTCHA**: Bun uses `import.meta.dir`, not `__dirname`
- **VALIDATE**: `bunx tsc --noEmit`

```typescript
// Add to Config interface:
dataPath: string;

// Add to loadConfig():
const projectRoot = import.meta.dir ? join(import.meta.dir, "..") : process.cwd();
const dataPath = join(projectRoot, "data");
```

### Task 2: CREATE `tools/data-tools.ts` — New MCP tools

- **IMPLEMENT**: Create factory function `createDataTools(dataPath: string)`
- **IMPLEMENT**: Create `read_data_file` tool with proper docstring
- **IMPLEMENT**: Create `write_data_file` tool with proper docstring
- **PATTERN**: Mirror `tools/vault-tools.ts` structure
- **IMPORTS**: `tool` from SDK, `z` from zod, `readFile`/`writeFile`/`mkdir` from fs/promises
- **GOTCHA**: Create `data/` directory if it doesn't exist on write
- **GOTCHA**: Validate filename doesn't contain path traversal (`..` or `/`)
- **VALIDATE**: `bunx tsc --noEmit`

Docstring template for `read_data_file`:
```
Read a JSON data file from the project's data/ directory.

Use this when:
- Reading migration worklist, progress, or batch files
- Loading audit data for processing
- Checking current migration state

Do NOT use this for:
- Reading vault notes (use read_note instead)
- Reading markdown reports (use read_note instead)
- Writing data (use write_data_file instead)

Performance notes:
- Fast file read (~5ms)
- Returns raw JSON string for LLM to parse
- Files are typically 1-100KB

Examples:
- read_data_file({ filename: "migration-worklist.json" })
- read_data_file({ filename: "migration-progress.json" })
- read_data_file({ filename: "next-batch.json" })
```

Docstring template for `write_data_file`:
```
Write a JSON data file to the project's data/ directory.

Use this when:
- Writing audit data after scanning vault
- Updating migration progress after processing a batch
- Saving structured data for later processing

Do NOT use this for:
- Writing vault notes (use write_note instead)
- Writing markdown reports (use write_note instead)
- Reading data (use read_data_file instead)

Performance notes:
- Fast file write (~10ms)
- Creates data/ directory if needed
- Overwrites existing file

Examples:
- write_data_file({ filename: "audit-data.json", content: JSON.stringify(auditData, null, 2) })
- write_data_file({ filename: "migration-progress.json", content: JSON.stringify(progress, null, 2) })
```

### Task 3: UPDATE `tagging-agent.ts` — Register data tools in MCP server

- **IMPLEMENT**: Import `createDataTools` from `./tools/data-tools.js`
- **IMPLEMENT**: Update `buildMcpServer()` to accept `dataPath` parameter
- **IMPLEMENT**: Create data tools and add to `allTools` array
- **IMPLEMENT**: Update `getAllowedTools()` to include new tool names
- **PATTERN**: Follow existing tool registration in `buildMcpServer()`
- **VALIDATE**: `bunx tsc --noEmit`

```typescript
// In buildMcpServer():
function buildMcpServer(vaultPath: string, dataPath: string) {
  const vaultTools = createVaultTools(vaultPath);
  const tagTools = createTagTools(vaultPath);
  const gitTools = createGitTools(vaultPath);
  const dataTools = createDataTools(dataPath);  // NEW
  const allTools = [...vaultTools, ...tagTools, ...gitTools, ...dataTools];
  // ...
}

// In getAllowedTools():
"mcp__vault__read_data_file",
"mcp__vault__write_data_file",
```

### Task 4: UPDATE `tagging-agent.ts` — Ensure data directory exists

- **IMPLEMENT**: Add `ensureDataDirectory()` function
- **IMPLEMENT**: Call it at startup before running agent
- **IMPORTS**: `mkdir` from fs/promises
- **VALIDATE**: `bunx tsc --noEmit`

```typescript
async function ensureDataDirectory(dataPath: string): Promise<void> {
  await mkdir(dataPath, { recursive: true });
}
```

### Task 5: UPDATE `tagging-agent.ts` — Update audit system prompt

- **IMPLEMENT**: Change step 7 to use `write_data_file` instead of `write_note`
- **IMPLEMENT**: Update filename from `_Tag Audit Data.json` to `audit-data.json`
- **GOTCHA**: Keep the JSON structure the same
- **VALIDATE**: `bun test tests/agent-prompts.test.ts`

```typescript
// In buildAuditSystemPrompt(), replace step 7:
7. Write structured audit data for the worklist generator:
   write_data_file({
     filename: "audit-data.json",
     content: JSON.stringify({
       generatedAt: "<ISO-8601 timestamp>",
       // ... same structure
     }, null, 2)
   })
```

### Task 6: UPDATE `tagging-agent.ts` — Update execute system prompt

- **IMPLEMENT**: Change step 1 to use `read_data_file` for batch file
- **IMPLEMENT**: Change step 2 to use `read_data_file` for progress file
- **IMPLEMENT**: Change step 5 to use `write_data_file` for progress file
- **IMPLEMENT**: Update all filenames to kebab-case without underscore prefix
- **VALIDATE**: `bun test tests/agent-prompts.test.ts`

Filename mappings:
- `_Next_Batch.json` → `next-batch.json`
- `_Migration_Progress.json` → `migration-progress.json`
- `_Migration_Worklist.json` → `migration-worklist.json`

### Task 7: UPDATE `tagging-agent.ts` — Update pre-flight functions

- **IMPLEMENT**: Update `loadWorklistJson()` to use `dataPath` parameter
- **IMPLEMENT**: Update `writeNextBatch()` to use `dataPath` parameter
- **IMPLEMENT**: Update `deleteNextBatch()` to use `dataPath` parameter
- **IMPLEMENT**: Update `checkExecutePrerequisites()` to use `dataPath`
- **IMPLEMENT**: Add backward-compatible fallback: check `dataPath` first, then vault
- **VALIDATE**: `bun test tests/preflight.test.ts`

```typescript
async function loadWorklistJson(dataPath: string, vaultPath: string): Promise<MigrationWorklist | null> {
  // Try data/ first (new location)
  const dataJsonPath = join(dataPath, "migration-worklist.json");
  try {
    const jsonRaw = await readFile(dataJsonPath, "utf-8");
    return JSON.parse(jsonRaw) as MigrationWorklist;
  } catch {
    // Fall through to vault fallback
  }

  // Fallback: try vault (old location)
  const vaultJsonPath = join(vaultPath, "_Migration_Worklist.json");
  try {
    const jsonRaw = await readFile(vaultJsonPath, "utf-8");
    return JSON.parse(jsonRaw) as MigrationWorklist;
  } catch {
    // Fall through to markdown fallback
  }

  // Final fallback: extract from markdown
  // ... existing markdown extraction code
}
```

### Task 8: UPDATE `lib/worklist-generator.ts` — Update loadAuditMappings

- **IMPLEMENT**: Add `dataPath` parameter to `loadAuditMappings()`
- **IMPLEMENT**: Check `dataPath` first, then vault as fallback
- **IMPORTS**: None new needed
- **VALIDATE**: `bun test tests/worklist-generator.test.ts`

```typescript
export async function loadAuditMappings(
  dataPath: string,
  vaultPath: string,
): Promise<AuditMappings | undefined> {
  // Try data/ first (new location)
  try {
    const raw = await readFile(join(dataPath, "audit-data.json"), "utf-8");
    const data = JSON.parse(raw);
    if (data && typeof data.mappings === "object") {
      return data as AuditMappings;
    }
  } catch {
    // Fall through to vault
  }

  // Fallback: try vault (old location)
  try {
    const raw = await readFile(join(vaultPath, "_Tag Audit Data.json"), "utf-8");
    const data = JSON.parse(raw);
    if (data && typeof data.mappings === "object") {
      return data as AuditMappings;
    }
  } catch {
    // No audit data found
  }

  return undefined;
}
```

### Task 9: UPDATE `lib/worklist-generator.ts` — Update writeWorklistJson

- **IMPLEMENT**: Change parameter from `vaultPath` to `dataPath`
- **IMPLEMENT**: Update filename to `migration-worklist.json`
- **VALIDATE**: `bun test tests/worklist-generator.test.ts`

```typescript
export async function writeWorklistJson(
  dataPath: string,
  worklist: MigrationWorklist,
): Promise<void> {
  const jsonPath = join(dataPath, "migration-worklist.json");
  await writeFile(jsonPath, JSON.stringify(worklist, null, 2), "utf-8");
}
```

### Task 10: UPDATE `lib/worklist-generator.ts` — Remove embedded JSON from markdown

- **IMPLEMENT**: Modify `formatWorklistMarkdown()` to NOT include the JSON block
- **IMPLEMENT**: Replace with a note pointing to the JSON file location
- **GOTCHA**: Keep the summary section and unmapped tags table
- **VALIDATE**: `bun test tests/worklist-generator.test.ts`

```typescript
export function formatWorklistMarkdown(result: WorklistGeneratorResult): string {
  const { worklist, stats } = result;
  const sections: string[] = [];

  // ... existing summary section (keep as-is)

  // ... existing unmapped tags section (keep as-is)

  // REPLACE the embedded JSON with a reference
  sections.push("## Machine-Parseable Worklist\n");
  sections.push("The full worklist is stored in the project's `data/` directory:");
  sections.push("- `data/migration-worklist.json` — Complete worklist for execute mode");
  sections.push("");
  sections.push("This file is not embedded here to prevent Obsidian indexing issues.");

  return sections.join("\n");
}
```

### Task 11: UPDATE `tagging-agent.ts` — Update generate-worklist mode

- **IMPLEMENT**: Pass `dataPath` to `loadAuditMappings()`
- **IMPLEMENT**: Pass `dataPath` to `writeWorklistJson()`
- **IMPLEMENT**: Update console output to show new path
- **VALIDATE**: `bun test`

### Task 12: UPDATE `.gitignore` — Add data directory

- **IMPLEMENT**: Add `data/` to .gitignore
- **VALIDATE**: `git status` should not show data/ files

```
# Agent runtime data
data/
```

### Task 13: UPDATE `README.md` — Document data directory

- **IMPLEMENT**: Add section explaining `data/` directory
- **IMPLEMENT**: List files stored there and their purpose
- **IMPLEMENT**: Explain why data is separate from vault

Add after "Project Structure" section:
```markdown
## Data Directory

The `data/` directory (git-ignored) contains machine-readable JSON files used during migration:

| File | Purpose |
|------|---------|
| `audit-data.json` | Tag frequencies and mappings from audit phase |
| `migration-worklist.json` | Full worklist of notes and tag changes |
| `migration-progress.json` | Tracks which notes have been processed |
| `next-batch.json` | Pre-computed batch for current execute run |

These files are stored outside the vault to:
1. Prevent Obsidian from indexing large JSON files (which can cause crashes)
2. Keep machine data separate from human knowledge
3. Allow the vault to remain clean for normal Obsidian use

Human-readable reports (`_Tag Audit Report.md`, `_Tag Migration Plan.md`, `_Tag Migration Verification.md`) remain in the vault.
```

### Task 14: CREATE `tests/data-tools.test.ts` — Test new tools

- **IMPLEMENT**: Test `read_data_file` with valid file
- **IMPLEMENT**: Test `read_data_file` with missing file (error case)
- **IMPLEMENT**: Test `write_data_file` creates file
- **IMPLEMENT**: Test `write_data_file` creates directory if needed
- **IMPLEMENT**: Test path traversal rejection (`../` in filename)
- **PATTERN**: Follow `tests/tools-smoke.test.ts` structure
- **VALIDATE**: `bun test tests/data-tools.test.ts`

### Task 15: UPDATE `tests/worklist-generator.test.ts` — Update paths

- **IMPLEMENT**: Update tests to use new function signatures
- **IMPLEMENT**: Add tests for backward-compatible fallback behavior
- **VALIDATE**: `bun test tests/worklist-generator.test.ts`

### Task 16: UPDATE `tests/preflight.test.ts` — Update paths

- **IMPLEMENT**: Update tests for new `dataPath` parameter
- **IMPLEMENT**: Test fallback from data/ to vault
- **VALIDATE**: `bun test tests/preflight.test.ts`

### Task 17: Run full test suite and type check

- **VALIDATE**: `bun test` — all 133+ tests should pass
- **VALIDATE**: `bunx tsc --noEmit` — no type errors (except pre-existing workshop errors)

### Task 18: Manual validation — Generate worklist

- **VALIDATE**: `bun run tagging-agent.ts generate-worklist`
- **VALIDATE**: Verify `data/migration-worklist.json` is created
- **VALIDATE**: Verify `_Tag Migration Plan.md` does NOT contain embedded JSON
- **VALIDATE**: Open Obsidian and verify no crash

---

## TESTING STRATEGY

### Unit Tests

Based on existing test patterns in `tests/`:

1. **`tests/data-tools.test.ts`** (NEW)
   - Test `read_data_file` returns file content
   - Test `read_data_file` returns error for missing file
   - Test `write_data_file` creates file with content
   - Test `write_data_file` creates parent directory
   - Test path traversal rejection (`..`, absolute paths)

2. **`tests/worklist-generator.test.ts`** (UPDATE)
   - Test `loadAuditMappings()` with dataPath first, vault fallback
   - Test `writeWorklistJson()` writes to dataPath
   - Test `formatWorklistMarkdown()` does NOT contain JSON block

3. **`tests/preflight.test.ts`** (UPDATE)
   - Test `loadWorklistJson()` checks dataPath first
   - Test `loadWorklistJson()` falls back to vault
   - Test `writeNextBatch()` writes to dataPath

### Integration Tests

- Run `generate-worklist` mode and verify output locations
- Verify Obsidian can open vault without crashing

### Edge Cases

- Empty data directory (first run)
- Missing audit data (should use hardcoded mappings)
- Existing vault JSON files (backward compatibility)
- Path traversal attempts in filenames

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
# No linter configured, skip
```

### Level 2: Type Checking

```bash
bunx tsc --noEmit
# Expected: No errors (pre-existing workshop errors are OK)
```

### Level 3: Unit Tests

```bash
bun test
# Expected: All tests pass (133+ tests)
```

### Level 4: Integration Tests

```bash
# Test generate-worklist mode
bun run tagging-agent.ts generate-worklist

# Verify output
ls -la data/
cat data/migration-worklist.json | head -20
grep -c "```json" /path/to/vault/_Tag\ Migration\ Plan.md
# Expected: 0 (no JSON block)
```

### Level 5: Manual Validation

1. Open Obsidian pointing to vault
2. Wait for indexing notification to complete
3. Verify NO crash occurs
4. Verify `_Tag Migration Plan.md` renders correctly (summary + table, no huge JSON)

---

## ACCEPTANCE CRITERIA

- [ ] New `data/` directory created at project root
- [ ] `data-tools.ts` provides `read_data_file` and `write_data_file` MCP tools
- [ ] Audit prompt writes JSON to `data/audit-data.json`
- [ ] Execute prompt reads/writes JSON from `data/`
- [ ] `generate-worklist` writes to `data/migration-worklist.json`
- [ ] `_Tag Migration Plan.md` does NOT contain embedded JSON
- [ ] Backward compatibility: code checks `data/` first, vault as fallback
- [ ] `data/` added to `.gitignore`
- [ ] README documents `data/` directory
- [ ] All tests pass (unit + integration)
- [ ] Obsidian opens vault without crashing

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual testing confirms feature works
- [ ] Acceptance criteria all met
- [ ] CHANGELOG.md updated
- [ ] PROJECT_STATUS.md updated

---

## NOTES

### Design Decisions

1. **Kebab-case filenames**: Changed from `_Migration_Worklist.json` to `migration-worklist.json` for consistency with project conventions.

2. **No env var for dataPath**: The data directory is always `data/` relative to project root. No need for configuration—it's an implementation detail, not user-configurable.

3. **Backward compatibility**: Functions check `data/` first, then vault. This allows gradual migration and supports users who haven't re-run generate-worklist yet.

4. **MCP tool naming**: Tools are named `read_data_file` and `write_data_file` (not `read_data` / `write_data`) to be explicit about file operations.

### Trade-offs

- **Slightly more complex code** (fallback logic) vs. **better user experience** (no manual migration needed)
- **New MCP tools** vs. **could have used Bash** — MCP tools are cleaner and match the architectural pattern

### Future Considerations

- If more runtime state files are needed, they go in `data/`
- Consider adding a cleanup command to remove stale data files
- The fallback logic can be removed in a future major version once all users have migrated
