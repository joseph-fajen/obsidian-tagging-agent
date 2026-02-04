import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig, type Config, type AgentMode } from "./lib/config.js";
import { createVaultTools } from "./tools/vault-tools.js";
import { createTagTools } from "./tools/tag-tools.js";
import { createGitTools } from "./tools/git-tools.js";
import { createDataTools } from "./tools/data-tools.js";
import { SCHEME_NOTE_PATH } from "./tag-scheme.js";
import { generateWorklist, loadAuditMappings, formatWorklistMarkdown, writeWorklistJson, type MigrationWorklist, type NoteChanges, type NextBatch } from "./lib/worklist-generator.js";
import { join } from "path";
import { readFile, writeFile, unlink, mkdir } from "fs/promises";

// ============================================================================
// SYSTEM PROMPTS
// ============================================================================

export function buildAuditSystemPrompt(config: Config): string {
  const today = new Date().toISOString().split("T")[0];

  return `You are an Obsidian vault tagging audit agent. Today's date is ${today}.

Your task is to perform a comprehensive audit of every tag in the vault and produce a structured report.

## Workflow

1. Call list_notes({ recursive: true }) to get the full vault inventory.
2. For each note, call read_note({ path, detail: "minimal" }) to get its tags.
   - IMPORTANT: Use "minimal" detail to stay within budget (~50 tokens per note vs ~2000 for "full").
   - Process notes in batches of 100 if needed to manage context window.
3. Read the proposed tagging scheme: read_note({ path: "${SCHEME_NOTE_PATH}", detail: "full" }).
4. Catalog every unique tag with:
   - Frequency count (how many notes use it)
   - Whether it appears as inline, frontmatter, or both
   - Whether it is a noise tag (Google Docs anchors containing "=", standalone "heading", "follow-up-required-*" prefixed tags)
5. Classify each tag against the proposed scheme:
   - Maps to scheme: tag has a clear mapping to the new hierarchical system
   - Unmapped: tag has no mapping and needs a user decision
   - Noise: tag should be removed (Google Docs anchors, obsolete workflow tags)
6. Write the audit report using write_note({ path: "_Tag Audit Report.md", content: <report>, frontmatter: { tags: ["type/report"], date: "${today}" } }).
   The report must include:
   - Summary statistics (total notes, total unique tags, notes with/without frontmatter)
   - Tag frequency table (tag name, count, inline/frontmatter/both, classification)
   - Noise tags list with counts
   - Unmapped tags list with counts and suggested categorization
   - Classification breakdown (mapped, unmapped, noise counts)
7. Write structured audit data for the worklist generator to the data/ directory:
   write_data_file({
     filename: "audit-data.json",
     content: JSON.stringify({
       generatedAt: "<ISO-8601 timestamp>",
       generatedBy: "audit-phase-agent",
       totalNotes: <number>,
       totalTaggedNotes: <number>,
       uniqueTags: <number>,
       mappings: {
         // Include ONLY tags you have HIGH CONFIDENCE about mapping
         // and that are NOT already in the hardcoded TAG_MAPPINGS table.
         // Format: "old-tag-name": "new-tag-or-null"
       },
       tagFrequencies: {
         // ALL tags found with their counts: "tag-name": count
       }
     }, null, 2)
   })
8. Call git_commit({ message: "Audit complete: _Tag Audit Report.md" }) after writing the report and data file.

## Constraints

- Use ONLY the MCP tools provided — no other tools.
- This audit is READ-ONLY — do NOT modify any notes except writing the report note.
- Tag format reference: lowercase kebab-case, valid prefixes are status/, type/, area/, project/.
- Vault path: ${config.vaultPath}`;
}

export function buildPlanSystemPrompt(config: Config): string {
  const today = new Date().toISOString().split("T")[0];

  return `You are a tag migration planning agent for an Obsidian vault. Today's date is ${today}.

Your task is to create a human-readable migration plan with a tag mapping table. This phase is REVIEW-ONLY — do NOT apply any changes to notes, only write the plan note.

IMPORTANT: You do NOT need to generate the per-note worklist. That is done by a separate deterministic code step (generate-worklist) after you write the plan. Your job is to produce the TAG MAPPING TABLE and identify unmapped tags.

## Available Tools

- \`list_notes\`: List all notes in the vault
- \`read_note\`: Read a note's content and tags
- \`write_note\`: Write the migration plan to the vault
- \`search_notes\`: Find notes with specific tags (use sparingly)
- \`git_commit\`: Commit the plan note after writing

## Phase 1: Read Inputs

1. Call \`read_note({ path: "_Tag Audit Report.md", detail: "full" })\` to get the audit data.
   - If not found, stop and report an error. The audit phase must run first.
2. Call \`read_note({ path: "${SCHEME_NOTE_PATH}", detail: "full" })\` to get the target scheme.

## Phase 2: Create Tag Mapping Table

Based on the audit and scheme, create a mapping for EVERY tag found in the audit:

| Old Tag | New Tag | Action | Notes |
|---------|---------|--------|-------|
| \`daily-reflection\` | \`type/daily-note\` | MAP | Move to type hierarchy |
| \`heading\` | (remove) | REMOVE | Noise tag |
| \`technical-writing\` | \`technical-writing\` | KEEP | Already valid topic tag |
| \`ai-tools\` | \`ai-tools\` | KEEP | Already valid, no change needed |
| \`code_review\` | ? | UNMAPPED | Needs user decision |

Action types:
- **MAP**: Transform to new hierarchical tag
- **REMOVE**: Delete entirely (noise/obsolete)
- **KEEP**: No change needed (already valid)
- **UNMAPPED**: Cannot determine mapping, needs user input

## Phase 3: Write the Plan Note

Write the plan to \`_Tag Migration Plan.md\` using:
\`\`\`
write_note({
  path: "_Tag Migration Plan.md",
  content: <plan markdown>,
  frontmatter: { tags: ["type/report"], date: "${today}" }
})
\`\`\`

The plan note must include these sections in order:
1. Executive Summary
2. Tag Mapping Table (human-readable)
3. Unmapped Tags Requiring Decisions (with recommended resolutions)
4. Migration Statistics
5. Next Steps — instruct the user to:
   - Review the mapping table and resolve any unmapped tags
   - Run \`bun run tagging-agent.ts generate-worklist\` to produce the machine-parseable worklist
   - Run \`bun run tagging-agent.ts execute\` to apply changes

Then call \`git_commit({ message: "Plan complete: _Tag Migration Plan.md" })\`.

## Constraints

- New tags must conform to lowercase kebab-case with valid prefixes: status/, type/, area/, project/ (or flat topic tags without prefix).
- REVIEW-ONLY — do NOT modify any vault notes except writing the plan note.
- Vault path: ${config.vaultPath}`;
}

export function buildExecuteSystemPrompt(config: Config): string {
  const today = new Date().toISOString().split("T")[0];

  return `You are a tag migration execution agent. Today's date is ${today}.

Your task is to apply pre-computed tag changes. The batch has already been computed — just process what's in next-batch.json.

## Critical Constraints

- Do NOT use search_notes or Bash — everything you need is in the batch file
- Do NOT skip notes or change the processing order
- Do NOT modify anything beyond what the batch specifies

## Available Tools

- \`read_data_file\`: Read next-batch.json and migration-progress.json from data/ directory
- \`write_data_file\`: Update progress file in data/ directory
- \`apply_tag_changes\`: Apply tag changes to a note
- \`git_commit\`: Create checkpoint commits

## Execution Algorithm

### Step 1: Read Batch File

\`\`\`
read_data_file({ filename: "next-batch.json" })
\`\`\`

Parse the JSON. It contains:
- \`batchNumber\`: Which batch this is
- \`totalInWorklist\`: Total notes in migration
- \`processedSoFar\`: Notes already processed
- \`remaining\`: Notes left after this batch
- \`entries\`: Array of { path, changes } — the notes to process NOW

If entries is empty, report "Migration complete!" and stop.

### Step 2: Read Progress File (if exists)

\`\`\`
read_data_file({ filename: "migration-progress.json" })
\`\`\`

If it exists, you'll update it. If not, you'll create it.

### Step 3: Pre-Batch Commit

\`\`\`
git_commit({ message: "Pre-batch <batchNumber> checkpoint" })
\`\`\`

### Step 4: Process Each Entry

For each entry in \`entries\`, in order:

\`\`\`
apply_tag_changes({
  path: entry.path,
  changes: entry.changes
})
\`\`\`

Log each result. If warnings occur, note them but continue. If a note fails, log and skip it.

### Step 5: Update Progress File

\`\`\`
write_data_file({
  filename: "migration-progress.json",
  content: JSON.stringify({
    migrationId: "tag-migration-${today}",
    worklistSource: "migration-worklist.json",
    startedAt: "<from existing or now>",
    lastUpdatedAt: "<now>",
    totalInWorklist: <from batch file>,
    processedCount: <processedSoFar + entries.length>,
    remainingCount: <remaining - entries.length>,
    processedPaths: [...existingPaths, ...newPaths],
    batchHistory: [...existing, {
      batchNumber: <N>,
      startedAt: "<batch start>",
      completedAt: "<now>",
      notesProcessed: <count>,
      warnings: [<any>]
    }],
    errors: [<any>]
  }, null, 2)
})
\`\`\`

### Step 6: Post-Batch Commit

\`\`\`
git_commit({ message: "Tag migration batch <N>: <count> notes processed" })
\`\`\`

### Step 7: Report Results

Output a summary:
- Batch number
- Notes processed this batch
- Total processed so far
- Notes remaining
- Any warnings
- Whether more invocations needed

## Vault path: ${config.vaultPath}`;
}

export function buildVerifySystemPrompt(config: Config): string {
  const today = new Date().toISOString().split("T")[0];

  return `You are a tag migration verification agent. Today's date is ${today}.

Your task is to perform a READ-ONLY verification scan of the entire vault, checking for full tag compliance and writing a verification report.

## Available Tools

- \`list_notes\`: List all notes in the vault
- \`read_note\`: Read a note's content and tags
- \`write_note\`: Write the verification report
- \`git_commit\`: Commit the verification report

## Verification Algorithm

1. Call \`list_notes({ recursive: true })\` to get the full vault inventory.
2. Read the proposed tagging scheme for reference: \`read_note({ path: "${SCHEME_NOTE_PATH}", detail: "full" })\`.
3. For each note (excluding those prefixed with _ — agent artifacts like reports):
   - Call \`read_note({ path, detail: "minimal" })\` to get tag data.
   - Use "minimal" detail to stay within budget (~50 tokens per note).
   - Process notes in batches of 100 if needed to manage context window.
4. For each note, run all verification checks (see below).
5. Compile results and write the verification report.

## Verification Checks

For each note, verify:

### 1. No Inline Tags Remaining

All tags should be in YAML frontmatter, not inline in the body.
- Pass: Note has tags only in frontmatter (\`inlineTags\` array is empty)
- Fail: Note has \`#tag\` in body text (outside code blocks)

### 2. No Hash Prefixes in Frontmatter

Frontmatter tags should not have \`#\` prefix.
- Pass: \`tags: [daily-note, ai-tools]\`
- Fail: \`tags: [#daily-note, #ai-tools]\`

### 3. Valid Tag Formats

Tags must be lowercase kebab-case. Two formats are BOTH valid:

**Prefixed tags** (hierarchical):
- \`status/pending\`, \`status/completed\`, \`status/archived\`
- \`type/daily-note\`, \`type/meeting\`, \`type/research\`
- \`area/career\`, \`area/learning\`, \`area/health\`
- \`project/isee\`, \`project/blockfrost\`

**Flat topic tags** (no prefix):
- \`ai-tools\`, \`technical-writing\`, \`meditation\`
- \`blockchain\`, \`prompting\`, \`spirituality\`
- Any lowercase kebab-case string without a prefix

BOTH formats are VALID. Flat topic tags are NOT violations.

Only flag tags that:
- Contain uppercase letters: \`Daily-Note\` — invalid
- Contain underscores: \`ai_tools\` — invalid
- Contain \`#\` prefix: \`#topic\` — invalid
- Are purely numeric: \`123\` — invalid (noise)
- Are known noise patterns: \`heading\`, \`follow-up-required-*\`

### 4. No Duplicate Tags

A note should not have the same tag twice (even with different casing).

## Write Verification Report

Write the report using:
\`\`\`
write_note({
  path: "_Tag Migration Verification.md",
  content: <report>,
  frontmatter: { tags: ["type/report"], date: "${today}", "generated-by": "verify-phase-agent" }
})
\`\`\`

Report structure:
1. Executive Summary — overall pass/fail verdict and compliance percentage
2. Compliance Statistics — notes scanned, fully compliant, with violations
3. Violations Found — grouped by type (inline tags, invalid formats, hash prefixes, duplicates)
4. Tag Usage Summary — breakdown by prefix category
5. Recommendations — any suggested follow-up actions

Then call \`git_commit({ message: "Verification complete: _Tag Migration Verification.md" })\`.

## Important Notes

- Flat topic tags (no prefix, lowercase kebab-case) are VALID — do not flag them
- Code blocks may contain \`#\` that looks like tags — ignore these
- Agent artifact notes (prefixed with _) should be excluded from the scan
- Focus on actionable violations, not stylistic preferences
- This is a READ-ONLY verification — do NOT modify any notes except writing the report
- Vault path: ${config.vaultPath}`;
}

export function buildUserPrompt(mode: AgentMode, config: Config): string {
  if (mode === "audit") {
    return `Audit all tags in the vault at ${config.vaultPath}. Write the report to _Tag Audit Report.md.`;
  }
  if (mode === "plan") {
    return `Generate a tag migration plan based on the audit report. Write the plan to _Tag Migration Plan.md. The per-note worklist will be generated separately by the generate-worklist command. Batch size for execution will be ${config.batchSize}.`;
  }
  if (mode === "execute") {
    return `Apply the tag migration plan to the vault at ${config.vaultPath}. Process up to ${config.batchSize} notes in this batch.`;
  }
  if (mode === "generate-worklist") {
    return `Generate the migration worklist for the vault at ${config.vaultPath}.`;
  }
  if (mode === "verify") {
    return `Verify the tag migration in the vault at ${config.vaultPath}. Write the verification report to _Tag Migration Verification.md.`;
  }
  throw new Error(`Unknown mode: "${mode}"`);
}

// ============================================================================
// MCP SERVER ASSEMBLY
// ============================================================================

function buildMcpServer(vaultPath: string, dataPath: string) {
  const vaultTools = createVaultTools(vaultPath);
  const tagTools = createTagTools(vaultPath);
  const gitTools = createGitTools(vaultPath);
  const dataTools = createDataTools(dataPath);
  const allTools = [...vaultTools, ...tagTools, ...gitTools, ...dataTools];

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
    "mcp__vault__read_data_file",
    "mcp__vault__write_data_file",
  ];
}

// ============================================================================
// PRE-FLIGHT CHECKS
// ============================================================================

interface ProgressFile {
  totalInWorklist: number;
  processedCount: number;
  processedPaths: string[];
}

interface WorklistData {
  totalNotes: number;
  worklist: Array<{ path: string }>;
}

/**
 * Load worklist from JSON file, checking data/ first then vault for backward compatibility.
 * Returns null if neither source is available.
 */
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
  const planPath = join(vaultPath, "_Tag Migration Plan.md");
  try {
    const planRaw = await readFile(planPath, "utf-8");
    const jsonMatch = planRaw.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]) as MigrationWorklist;
    }
  } catch {
    // Markdown file doesn't exist or parse failed
  }

  return null;
}

/**
 * Write the next batch to next-batch.json in data/ for the execute agent.
 */
async function writeNextBatch(dataPath: string, batch: NextBatch): Promise<void> {
  const batchPath = join(dataPath, "next-batch.json");
  await writeFile(batchPath, JSON.stringify(batch, null, 2), "utf-8");
}

/**
 * Delete next-batch.json if it exists (cleanup from previous run).
 */
async function deleteNextBatch(dataPath: string): Promise<void> {
  const batchPath = join(dataPath, "next-batch.json");
  try {
    await unlink(batchPath);
  } catch {
    // File doesn't exist, that's fine
  }
}

/**
 * Pre-flight check for execute mode:
 * 1. Load worklist (data/ first, then vault for backward compatibility)
 * 2. Load progress (if exists)
 * 3. Validate worklist hasn't changed
 * 4. Compute next batch
 * 5. Write next-batch.json to data/
 *
 * Returns true if migration should proceed, false if blocking issue or already complete.
 */
async function checkExecutePrerequisites(dataPath: string, vaultPath: string, batchSize: number): Promise<boolean> {
  // Progress file now in data/ directory
  const progressPath = join(dataPath, "migration-progress.json");

  // Clean up stale batch file from previous run
  await deleteNextBatch(dataPath);

  // Load worklist (checks data/ first, then vault for backward compatibility)
  const worklist = await loadWorklistJson(dataPath, vaultPath);
  if (!worklist) {
    console.error("Could not find worklist. Run 'bun run tagging-agent.ts generate-worklist' first.\n");
    return false;
  }

  if (worklist.worklist.length === 0) {
    console.error("Worklist is empty. Run 'bun run tagging-agent.ts generate-worklist' first.\n");
    return false;
  }

  // Load progress file (if exists) - check data/ first, then vault for backward compatibility
  let progress: ProgressFile | null = null;
  try {
    const progressRaw = await readFile(progressPath, "utf-8");
    progress = JSON.parse(progressRaw) as ProgressFile;
  } catch {
    // Try vault location for backward compatibility
    const vaultProgressPath = join(vaultPath, "_Migration_Progress.json");
    try {
      const progressRaw = await readFile(vaultProgressPath, "utf-8");
      progress = JSON.parse(progressRaw) as ProgressFile;
    } catch {
      // No progress file — first run
      console.log("No existing progress file — starting fresh migration.\n");
    }
  }

  // Check if worklist changed since last run
  if (progress && progress.totalInWorklist !== worklist.totalNotes) {
    console.log("⚠️  Worklist changed since last run!");
    console.log(`   Progress file: ${progress.totalInWorklist} notes`);
    console.log(`   Current worklist: ${worklist.totalNotes} notes`);
    console.log("");
    console.log("Resetting progress file to start fresh migration...");
    try { await unlink(progressPath); } catch { /* ignore */ }
    try { await unlink(join(vaultPath, "_Migration_Progress.json")); } catch { /* ignore */ }
    console.log("Progress file deleted. Migration will start from the beginning.\n");
    progress = null;
  }

  // Compute processed paths set
  const processedPaths = new Set(progress?.processedPaths || []);
  const processedCount = progress?.processedCount || 0;

  // Check if already complete
  if (processedCount >= worklist.totalNotes) {
    console.log("✅ Migration already complete!");
    console.log(`   ${processedCount}/${worklist.totalNotes} notes processed.`);
    console.log("");
    console.log("To re-run the migration, delete data/migration-progress.json and run again.\n");
    return false;
  }

  // Compute next batch
  const unprocessedEntries = worklist.worklist.filter(entry => !processedPaths.has(entry.path));
  const batchEntries = unprocessedEntries.slice(0, batchSize);
  const batchNumber = (progress?.processedPaths?.length || 0) > 0
    ? Math.ceil(processedCount / batchSize) + 1
    : 1;

  const nextBatch: NextBatch = {
    batchNumber,
    totalInWorklist: worklist.totalNotes,
    processedSoFar: processedCount,
    remaining: worklist.totalNotes - processedCount,
    entries: batchEntries,
  };

  // Write batch file to data/ directory
  await writeNextBatch(dataPath, nextBatch);

  // Report status
  const remaining = worklist.totalNotes - processedCount;
  if (processedCount > 0) {
    console.log(`Resuming migration: ${processedCount}/${worklist.totalNotes} done, ${remaining} remaining.`);
  }
  console.log(`Next batch prepared: ${batchEntries.length} entries written to data/next-batch.json\n`);

  return true;
}

// ============================================================================
// DATA DIRECTORY SETUP
// ============================================================================

async function ensureDataDirectory(dataPath: string): Promise<void> {
  await mkdir(dataPath, { recursive: true });
}

// ============================================================================
// AGENT RUNNER
// ============================================================================

async function runAgent(config: Config) {
  const modeArg = process.argv[2] as AgentMode | undefined;
  const mode =
    modeArg && ["audit", "plan", "generate-worklist", "execute", "verify"].includes(modeArg)
      ? (modeArg as AgentMode)
      : config.agentMode;

  console.log("=".repeat(60));
  console.log("Obsidian Vault Tagging Agent");
  console.log("=".repeat(60));
  console.log(`Mode: ${mode}`);
  console.log(`Vault: ${config.vaultPath}`);
  console.log(`Data: ${config.dataPath}`);
  console.log(`Budget: $${config.maxBudgetUsd}`);
  console.log(`Model: ${config.agentModel}`);
  console.log("=".repeat(60));
  console.log();

  // Ensure data directory exists
  await ensureDataDirectory(config.dataPath);

  const startTime = Date.now();

  // generate-worklist mode: pure code, no LLM
  if (mode === "generate-worklist") {
    console.log("Generating worklist deterministically (no LLM)...\n");

    const auditMappings = await loadAuditMappings(config.dataPath, config.vaultPath);
    if (auditMappings) {
      console.log("Loaded audit-discovered mappings from data/audit-data.json");
    } else {
      console.log("No audit-data.json found — using hardcoded mappings only");
    }

    const result = await generateWorklist(config.vaultPath, auditMappings);

    // Print stats
    console.log(`Notes scanned: ${result.stats.totalNotesScanned}`);
    console.log(`Notes with tags: ${result.stats.notesWithTags}`);
    console.log(`Notes requiring changes: ${result.stats.notesWithChanges}`);
    console.log(`Total tag changes: ${result.stats.totalChanges}`);
    console.log(`Unmapped tags: ${result.stats.unmappedTagCount}`);
    if (result.stats.inlineMigrations > 0) {
      console.log(`Inline tag migrations: ${result.stats.inlineMigrations}`);
    }
    if (result.warnings.length > 0) {
      console.log(`\nWarnings:`);
      for (const w of result.warnings) console.log(`  - ${w}`);
    }

    // Format and write the worklist to the plan note
    const worklistMarkdown = formatWorklistMarkdown(result);

    // Read existing plan note if it exists, append/replace worklist section
    const planPath = join(config.vaultPath, "_Tag Migration Plan.md");
    let planContent: string;
    try {
      const existing = await readFile(planPath, "utf-8");
      // Replace everything from "## Worklist Generation Summary" onward
      const cutoff = existing.indexOf("## Worklist Generation Summary");
      if (cutoff !== -1) {
        planContent = existing.slice(0, cutoff) + worklistMarkdown;
      } else {
        // Append after existing content
        planContent = existing + "\n\n" + worklistMarkdown;
      }
    } catch {
      // No existing plan — create a minimal one
      planContent = `---\ntags:\n  - type/report\ndate: '${new Date().toISOString().split("T")[0]}'\n---\n# Tag Migration Plan\n\n${worklistMarkdown}`;
    }

    await writeFile(planPath, planContent, "utf-8");
    console.log(`\nWorklist written to _Tag Migration Plan.md`);

    // Also write pure JSON for fast machine access
    await writeWorklistJson(config.dataPath, result.worklist);
    console.log(`Worklist JSON written to data/migration-worklist.json`);

    console.log(`  ${result.worklist.worklist.length} notes in worklist`);
    console.log(`  ${result.worklist.totalChanges} total tag changes`);

    if (result.worklist.unmappedTags.length > 0) {
      console.log(`\n${result.worklist.unmappedTags.length} unmapped tags need decisions before executing.`);
      console.log("  Review the 'Unmapped Tags' section in _Tag Migration Plan.md");
    }

    console.log();
    console.log("=".repeat(60));
    console.log(`Mode: generate-worklist complete`);
    console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    console.log(`Cost: $0.0000 (no LLM used)`);
    console.log("=".repeat(60));
    return;
  }

  // Pre-flight check for execute mode
  if (mode === "execute") {
    const canProceed = await checkExecutePrerequisites(config.dataPath, config.vaultPath, config.batchSize);
    if (!canProceed) {
      console.log("=".repeat(60));
      console.log(`Mode: ${mode} — no work to do`);
      console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      console.log(`Cost: $0.0000 (pre-flight check only)`);
      console.log("=".repeat(60));
      return;
    }
  }

  let systemPrompt: string;
  if (mode === "audit") {
    systemPrompt = buildAuditSystemPrompt(config);
  } else if (mode === "plan") {
    systemPrompt = buildPlanSystemPrompt(config);
  } else if (mode === "execute") {
    systemPrompt = buildExecuteSystemPrompt(config);
  } else if (mode === "verify") {
    systemPrompt = buildVerifySystemPrompt(config);
  } else {
    throw new Error(`Unknown mode: "${mode}"`);
  }

  const userPrompt = buildUserPrompt(mode, config);
  const server = buildMcpServer(config.vaultPath, config.dataPath);

  async function* streamPrompt() {
    yield {
      type: "user" as const,
      message: {
        role: "user" as const,
        content: [{ type: "text" as const, text: userPrompt }],
      },
      parent_tool_use_id: null as string | null,
      session_id: "",
    };
  }

  let finalResult = "";
  let totalCost = 0;

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

// ============================================================================
// RECOVERY AGENT — Self-reflection on errors
// ============================================================================

interface RecoveryAnalysis {
  strategy: "retry" | "skip" | "ask_user" | "abort";
  explanation: string;
  suggestedFix?: string;
  userQuestion?: string;
}

function buildRecoverySystemPrompt(mode: AgentMode, errorMessage: string, context: string): string {
  return `You are an error recovery agent for the Obsidian Vault Tagging Agent.

The agent was running in "${mode}" mode and encountered an error. Your job is to analyze the error and recommend a recovery strategy.

## Error Details

\`\`\`
${errorMessage}
\`\`\`

## Context

${context}

## Your Task

Analyze this error and respond with a JSON object containing your recovery recommendation:

\`\`\`json
{
  "strategy": "retry" | "skip" | "ask_user" | "abort",
  "explanation": "Brief explanation of what went wrong and why you recommend this strategy",
  "suggestedFix": "If strategy is retry, explain what should be different",
  "userQuestion": "If strategy is ask_user, the question to ask"
}
\`\`\`

## Strategy Guidelines

- **retry**: Use when the error is transient or a simple fix is available (e.g., retry with different parameters)
- **skip**: Use when one item failed but others can proceed (e.g., one unparseable file in a batch)
- **ask_user**: Use when you need human judgment (e.g., ambiguous requirements, multiple valid approaches)
- **abort**: Use when the error is fundamental and cannot be recovered (e.g., missing required files, invalid configuration)

Respond ONLY with the JSON object, no other text.`;
}

async function analyzeErrorWithLLM(
  mode: AgentMode,
  error: Error,
  context: string,
  config: Config,
): Promise<RecoveryAnalysis> {
  const systemPrompt = buildRecoverySystemPrompt(mode, error.message, context);

  try {
    let result = "";
    for await (const message of query({
      prompt: (async function* () {
        yield {
          type: "user" as const,
          message: {
            role: "user" as const,
            content: [{ type: "text" as const, text: "Analyze this error and recommend a recovery strategy." }],
          },
          parent_tool_use_id: null as string | null,
          session_id: "",
        };
      })(),
      options: {
        model: "claude-sonnet-4-20250514",
        systemPrompt,
        maxBudgetUsd: 0.05, // Small budget for recovery analysis
        permissionMode: "bypassPermissions",
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block) {
            result = block.text;
          }
        }
      }
    }

    // Parse JSON response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]) as RecoveryAnalysis;
      return analysis;
    }

    // Fallback if parsing fails
    return {
      strategy: "abort",
      explanation: `Could not parse recovery analysis. Original error: ${error.message}`,
    };
  } catch (recoveryError) {
    // If recovery analysis itself fails, abort
    return {
      strategy: "abort",
      explanation: `Recovery analysis failed: ${recoveryError}. Original error: ${error.message}`,
    };
  }
}

async function runWithRecovery(config: Config): Promise<void> {
  const modeArg = process.argv[2] as AgentMode | undefined;
  const mode =
    modeArg && ["audit", "plan", "generate-worklist", "execute", "verify"].includes(modeArg)
      ? (modeArg as AgentMode)
      : config.agentMode;

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;

    try {
      await runAgent(config);
      return; // Success — exit the recovery loop
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      console.log();
      console.log("=".repeat(60));
      console.log("ERROR ENCOUNTERED — Analyzing for recovery...");
      console.log("=".repeat(60));
      console.log();

      // Build context for recovery agent
      const context = [
        `Mode: ${mode}`,
        `Vault: ${config.vaultPath}`,
        `Attempt: ${attempts}/${maxAttempts}`,
        `Error type: ${err.name}`,
        `Stack trace (first 500 chars): ${err.stack?.slice(0, 500) || "N/A"}`,
      ].join("\n");

      // Analyze with LLM
      const analysis = await analyzeErrorWithLLM(mode, err, context, config);

      console.log("Recovery Analysis:");
      console.log(`  Strategy: ${analysis.strategy}`);
      console.log(`  Explanation: ${analysis.explanation}`);
      if (analysis.suggestedFix) {
        console.log(`  Suggested Fix: ${analysis.suggestedFix}`);
      }
      console.log();

      switch (analysis.strategy) {
        case "retry":
          console.log(`Retrying (attempt ${attempts + 1}/${maxAttempts})...`);
          console.log();
          continue; // Loop back and retry

        case "skip":
          console.log("Skipping problematic item and continuing...");
          console.log("Note: The skip strategy requires manual intervention to identify what to skip.");
          console.log("Please review the error, fix or skip the problematic file, and re-run.");
          console.log();
          console.log("=".repeat(60));
          console.log("Recovery suggestion: skip (requires manual action)");
          console.log("=".repeat(60));
          process.exit(1);

        case "ask_user":
          console.log("User input needed:");
          console.log(`  ${analysis.userQuestion || "How would you like to proceed?"}`);
          console.log();
          console.log("Please address the question and re-run the command.");
          console.log();
          console.log("=".repeat(60));
          console.log("Recovery suggestion: user input required");
          console.log("=".repeat(60));
          process.exit(1);

        case "abort":
        default:
          console.log("Cannot recover from this error. Please fix the issue and re-run.");
          console.log();
          console.log("=".repeat(60));
          console.log("Recovery suggestion: abort");
          console.log("=".repeat(60));
          process.exit(1);
      }
    }
  }

  console.error(`Max retry attempts (${maxAttempts}) exceeded. Aborting.`);
  process.exit(1);
}

// Main — only run when executed directly, not when imported for testing
const isMainModule = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("tagging-agent.ts");
if (isMainModule) {
  runWithRecovery(loadConfig()).catch((err) => {
    console.error("Unhandled fatal error:", err);
    process.exit(1);
  });
}
