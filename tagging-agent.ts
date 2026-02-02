import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig, type Config, type AgentMode } from "./lib/config.js";
import { createVaultTools } from "./tools/vault-tools.js";
import { createTagTools } from "./tools/tag-tools.js";
import { createGitTools } from "./tools/git-tools.js";
import { SCHEME_NOTE_PATH } from "./tag-scheme.js";

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
7. Call git_commit({ message: "Audit complete: _Tag Audit Report.md" }) after writing the report.

## Constraints

- Use ONLY the MCP tools provided — no other tools.
- This audit is READ-ONLY — do NOT modify any notes except writing the report note.
- Tag format reference: lowercase kebab-case, valid prefixes are status/, type/, area/, project/.
- Vault path: ${config.vaultPath}`;
}

export function buildPlanSystemPrompt(config: Config): string {
  const today = new Date().toISOString().split("T")[0];

  return `You are a tag migration planning agent for an Obsidian vault. Today's date is ${today}.

Your task is to create a complete, machine-executable migration plan. This phase is REVIEW-ONLY — do NOT apply any changes to notes, only write the plan note.

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
| \`technical-writing\` | \`technical-writing\` | CLEAN | Already valid topic tag |
| \`ai-tools\` | \`ai-tools\` | KEEP | Already valid, no change needed |
| \`code_review\` | ? | UNMAPPED | Needs user decision |

Action types:
- **MAP**: Transform to new hierarchical tag
- **REMOVE**: Delete entirely (noise/obsolete)
- **CLEAN**: Remove # prefix only, keep tag name
- **KEEP**: No change needed (already valid)
- **UNMAPPED**: Cannot determine mapping, needs user input

## Phase 3: Generate Per-Note Worklist (CRITICAL)

This is the most important step. You MUST generate a complete worklist of every note that needs changes.

### Algorithm

1. Call \`list_notes({ recursive: true })\` to get all notes
2. For each note where \`tagCount > 0\`:
   - Call \`read_note({ path: note.path, detail: "minimal" })\`
   - For each tag in the note's \`allTags\` and \`noiseTags\`:
     - Look up the tag in your mapping table
     - If action is MAP or REMOVE: add to this note's changes array
     - If action is CLEAN: add change with oldTag → cleaned version
     - If action is KEEP: skip (no change needed)
     - If action is UNMAPPED: add to unmappedTags list
   - If note has any changes, add to worklist
3. Build the JSON worklist structure

### Worklist JSON Schema

\`\`\`json
{
  "generatedAt": "ISO-8601 timestamp",
  "schemeVersion": "1.0",
  "generatedBy": "plan-phase-agent",
  "totalNotes": 597,
  "totalChanges": 1847,
  "worklist": [
    {
      "path": "relative/path/to/note.md",
      "changes": [
        {
          "oldTag": "tag-without-hash",
          "newTag": "new-tag-or-null"
        }
      ]
    }
  ],
  "unmappedTags": [
    {
      "tag": "unmapped-tag-name",
      "occurrences": 3,
      "notePaths": ["note1.md", "note2.md", "note3.md"],
      "suggestedMapping": "optional-suggestion"
    }
  ]
}
\`\`\`

### Important Rules for Worklist

- Include ALL notes that need ANY changes
- For each note, include ALL tag changes (not just one)
- \`oldTag\` should NOT include the # prefix
- \`newTag\` should be the final form (no # prefix)
- \`newTag: null\` means remove the tag entirely
- Do NOT include notes where all tags have action KEEP

## Phase 4: Write the Plan Note

Write the complete plan to \`_Tag Migration Plan.md\` using:
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
3. Unmapped Tags Requiring Decisions
4. Migration Statistics (total notes, changes, unmapped count)
5. **Machine-Parseable Worklist** — a section containing the complete JSON worklist in a fenced code block

Then call \`git_commit({ message: "Plan complete: _Tag Migration Plan.md" })\`.

## Budget Guidance

- Reading all ~600 tagged notes at "minimal" detail: ~30K tokens
- This is expected and necessary
- Do NOT skip the worklist generation to save budget
- The worklist enables 50% cost savings in execute phase

## Constraints

- New tags must conform to lowercase kebab-case with valid prefixes: status/, type/, area/, project/ (or flat topic tags without prefix).
- The migration plan is the input for the execute phase — it must be comprehensive and machine-parseable.
- Execution batch size will be ${config.batchSize} notes per invocation.
- Vault path: ${config.vaultPath}`;
}

export function buildExecuteSystemPrompt(config: Config): string {
  const today = new Date().toISOString().split("T")[0];

  return `You are a tag migration execution agent. Today's date is ${today}.

Your task is to apply pre-computed tag changes from the migration plan. You are executing a DETERMINISTIC plan — apply ONLY the changes specified in the worklist. Do NOT improvise or add extra tag changes.

## Critical Constraints

- Do NOT use search_notes — the worklist tells you exactly what to process
- Do NOT use Bash or shell commands — all vault access goes through MCP tools
- Do NOT skip notes or change the processing order
- Do NOT modify anything beyond what the worklist specifies

## Available Tools

- \`read_note\`: Read notes (for progress file and plan)
- \`write_note\`: Write progress file
- \`apply_tag_changes\`: Apply tag changes to a note
- \`git_commit\`: Create checkpoint commits

## Execution Algorithm

Follow these steps EXACTLY:

### Step 1: Read Progress File

\`\`\`
read_note({ path: "_Migration_Progress.json", detail: "full" })
\`\`\`

- If file exists: Parse JSON, extract \`processedPaths\` array and determine batch number from \`batchHistory.length + 1\`
- If file doesn't exist (first batch): Initialize empty progress — processedPaths = [], batchNumber = 1

### Step 2: Read Migration Plan

\`\`\`
read_note({ path: "_Tag Migration Plan.md", detail: "full" })
\`\`\`

Find the JSON code block in the "Machine-Parseable Worklist" section. Parse it to get:
- \`worklist\`: Array of { path, changes } objects
- \`totalNotes\`: Total notes to process

### Step 3: Compute This Batch

Filter to unprocessed notes and take the next batch:
- remaining = worklist entries where path is NOT in processedPaths
- batch = first ${config.batchSize} entries from remaining
- If batch is empty: report "Migration complete! All notes processed." and skip to Step 8

### Step 4: Pre-Batch Commit

\`\`\`
git_commit({ message: "Pre-batch <N> checkpoint" })
\`\`\`

### Step 5: Process Each Note

For each item in the batch, in order:

\`\`\`
apply_tag_changes({
  path: item.path,
  changes: item.changes
})
\`\`\`

Log the result (path + success/warnings). If there are warnings, note them but continue.
If apply_tag_changes fails for a note, log the error and skip that note — continue with the rest of the batch.

### Step 6: Update Progress File

Create or update the progress JSON and write it:

\`\`\`
write_note({
  path: "_Migration_Progress.json",
  content: JSON.stringify({
    migrationId: "<descriptive-id>",
    worklistSource: "_Tag Migration Plan.md",
    startedAt: "<timestamp from batch 1 or existing>",
    lastUpdatedAt: "<now>",
    totalInWorklist: <total>,
    processedCount: <previous + this batch>,
    remainingCount: <total - processedCount>,
    processedPaths: [...previousPaths, ...batchPaths],
    batchHistory: [...previousBatches, {
      batchNumber: <N>,
      startedAt: "<batch start>",
      completedAt: "<now>",
      notesProcessed: <count>,
      commitHash: "<from step 7>",
      warnings: [<any warnings>]
    }],
    errors: [<any errors>]
  }, null, 2)
})
\`\`\`

### Step 7: Post-Batch Commit

\`\`\`
git_commit({ message: "Tag migration batch <N>: <count> notes processed" })
\`\`\`

### Step 8: Report Results

Output a summary:
- Batch number
- Notes processed this batch
- Total processed so far
- Notes remaining
- Any warnings encountered
- Whether more invocations are needed

## Error Handling

- If apply_tag_changes returns warnings: Log them, continue processing
- If apply_tag_changes fails completely for a note: Log error, skip that note, continue batch
- If progress file is corrupted: Report error, stop (don't risk losing progress data)

## Forbidden Actions

These actions will cause problems — DO NOT DO THEM:
- search_notes — The worklist already has everything needed
- Bash/shell commands — Violates MCP boundary
- Skipping notes — Process in worklist order
- Re-ordering notes — Process in worklist order
- Modifying note content beyond tags — Only change tags
- Processing notes not in worklist — Only process listed notes

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
    return `Generate a tag migration plan based on the audit report. Write the plan to _Tag Migration Plan.md. Batch size for execution will be ${config.batchSize}.`;
  }
  if (mode === "execute") {
    return `Apply the tag migration plan to the vault at ${config.vaultPath}. Process up to ${config.batchSize} notes in this batch.`;
  }
  if (mode === "verify") {
    return `Verify the tag migration in the vault at ${config.vaultPath}. Write the verification report to _Tag Migration Verification.md.`;
  }
  throw new Error(`Unknown mode: "${mode}"`);
}

// ============================================================================
// MCP SERVER ASSEMBLY
// ============================================================================

function buildMcpServer(vaultPath: string) {
  const vaultTools = createVaultTools(vaultPath);
  const tagTools = createTagTools(vaultPath);
  const gitTools = createGitTools(vaultPath);
  const allTools = [...vaultTools, ...tagTools, ...gitTools];

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
  ];
}

// ============================================================================
// AGENT RUNNER
// ============================================================================

async function runAgent(config: Config) {
  const modeArg = process.argv[2] as AgentMode | undefined;
  const mode =
    modeArg && ["audit", "plan", "execute", "verify"].includes(modeArg)
      ? (modeArg as AgentMode)
      : config.agentMode;

  console.log("=".repeat(60));
  console.log("Obsidian Vault Tagging Agent");
  console.log("=".repeat(60));
  console.log(`Mode: ${mode}`);
  console.log(`Vault: ${config.vaultPath}`);
  console.log(`Budget: $${config.maxBudgetUsd}`);
  console.log(`Model: ${config.agentModel}`);
  console.log("=".repeat(60));
  console.log();

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
  const server = buildMcpServer(config.vaultPath);

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

  const startTime = Date.now();
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

// Main — only run when executed directly, not when imported for testing
const isMainModule = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("tagging-agent.ts");
if (isMainModule) {
  runAgent(loadConfig()).catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
