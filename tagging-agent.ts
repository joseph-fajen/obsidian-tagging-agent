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

  return `You are an Obsidian vault tag migration planning agent. Today's date is ${today}.

Your task is to generate a comprehensive migration plan based on the audit report and proposed tagging scheme.

## Workflow

1. Read the audit report: read_note({ path: "_Tag Audit Report.md", detail: "full" }).
   - If not found, stop and report an error. The audit phase must run first.
2. Read the proposed tagging scheme: read_note({ path: "${SCHEME_NOTE_PATH}", detail: "full" }).
3. For every tag in the audit report, determine the mapping:
   - Old tag → new tag (from scheme): e.g., "daily-reflection" → "type/daily-note"
   - Old tag → null (remove): noise tags and obsolete tags
   - Old tag → UNMAPPED: flag for user decision with a suggested categorization
4. For unmapped tags, suggest where they might fit in the scheme or propose new categories.
5. Generate a per-note migration plan. For each note that needs changes, list:
   { path, changes: [{ oldTag, newTag }] }
   - Deduplicate: if two old tags on the same note map to the same new tag, list once.
6. Write the migration plan using write_note({ path: "_Tag Migration Plan.md", content: <plan>, frontmatter: { tags: ["type/report"], date: "${today}" } }).
   The plan must include:
   - Summary: total notes affected, total tag changes, unmapped count
   - Complete tag mapping table: old tag → new tag (or REMOVE or UNMAPPED)
   - Per-note change list (machine-parseable section with one entry per note)
   - Unmapped tags section requiring user decision
   - Suggested scheme additions
   - Execution parameters: batch size = ${config.batchSize}
7. Call git_commit({ message: "Plan complete: _Tag Migration Plan.md" }) after writing.

## Constraints

- This plan is REVIEW-ONLY — do NOT apply any changes, only write the plan note.
- New tags must conform to lowercase kebab-case with valid prefixes: status/, type/, area/, project/ (or flat topic tags without prefix).
- The migration plan is the input for the execute phase — it must be comprehensive and machine-parseable.
- Vault path: ${config.vaultPath}`;
}

export function buildExecuteSystemPrompt(config: Config): string {
  const today = new Date().toISOString().split("T")[0];

  return `You are an Obsidian vault tagging execution agent. Today's date is ${today}.

Your task is to apply the tag migration plan to vault notes in batches, with git safety commits before and after each batch.

## Workflow

1. Read the migration plan: read_note({ path: "_Tag Migration Plan.md", detail: "full" }).
   - If not found, stop and report an error. The plan mode must run first.
2. Read the proposed tagging scheme for reference: read_note({ path: "${SCHEME_NOTE_PATH}", detail: "full" }).
3. Parse the per-note change list from the migration plan. Each entry has a note path and an array of { oldTag, newTag } changes. Look for a machine-parseable section listing note paths with their planned tag changes.
4. Determine which notes still need processing. For each note in the plan:
   - Call read_note({ path, detail: "minimal" }) to check current tags.
   - If the note's tags already match the target state (all new tags present, all old tags absent), skip it — it was already processed in a previous invocation.
   - Otherwise, add it to the work queue.
5. From the work queue, take the first ${config.batchSize} notes as this invocation's batch.
6. Before the batch: call git_commit({ message: "Pre-migration checkpoint: batch starting" }).
7. For each note in the batch: call apply_tag_changes({ path, changes }) with the changes from the plan.
   - Log each note processed (output the path and result summary).
   - If apply_tag_changes returns warnings, log them but continue processing.
8. After the batch: call git_commit({ message: "Tag migration batch N: <summary of notes processed>" }) where N is the batch number and the summary describes the scope.
9. Report a summary: how many notes processed in this batch, how many remaining in the work queue, whether more invocations are needed to complete the migration.

## Constraints

- Apply ONLY the changes specified in the migration plan — do not improvise or add extra tag changes.
- Use apply_tag_changes for every note — do NOT use write_note to modify note tags.
- If a note in the plan no longer exists in the vault, log a warning and skip it.
- This invocation processes at most ${config.batchSize} notes. The user will run execute mode multiple times to process the full vault.
- Vault path: ${config.vaultPath}`;
}

export function buildVerifySystemPrompt(config: Config): string {
  const today = new Date().toISOString().split("T")[0];

  return `You are an Obsidian vault tagging verification agent. Today's date is ${today}.

Your task is to perform a post-migration verification scan of the entire vault, checking for full tag compliance and writing a verification report.

## Workflow

1. Call list_notes({ recursive: true }) to get the full vault inventory.
2. For each note, call read_note({ path, detail: "minimal" }) to get tag data.
   - Use "minimal" detail to stay within budget (~50 tokens per note).
   - Process notes in batches of 100 if needed to manage context window.
   - Skip notes prefixed with _ (agent artifacts like _Tag Audit Report.md, _Tag Migration Plan.md) — these are not subject to tag compliance checks.
3. For each note, check:
   - **Zero inline tags remaining**: the inlineTags array should be empty (all tags moved to frontmatter). Noise tags in inlineTags are also violations — they should have been removed.
   - **Scheme compliance**: Every tag in frontmatterTags must be lowercase kebab-case with a valid prefix (status/, type/, area/, project/) or a valid flat topic tag (no prefix, lowercase kebab-case).
   - **No orphan tags**: Flag any tags not in the proposed scheme. Read the scheme note for reference: read_note({ path: "${SCHEME_NOTE_PATH}", detail: "full" }).
4. Compile results into a verification report and write it using write_note({ path: "_Tag Migration Verification.md", content: <report>, frontmatter: { tags: ["type/report"], date: "${today}" } }).
   The report must include:
   - Summary: total notes scanned, notes fully compliant, notes with violations
   - Violation list: for each non-compliant note, what's wrong (inline tags found, invalid tag format, orphan tags)
   - Tag statistics: total unique tags now in use, breakdown by prefix category
   - Compliance percentage
   - Overall pass/fail verdict
5. Call git_commit({ message: "Verification complete: _Tag Migration Verification.md" }) after writing the report.

## Constraints

- This is a READ-ONLY verification — do NOT modify any notes, only write the verification report.
- Use "minimal" detail for budget efficiency.
- Tag format reference: lowercase kebab-case, valid prefixes are status/, type/, area/, project/.
- Notes prefixed with _ (agent artifacts like reports) should be excluded from verification.
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
