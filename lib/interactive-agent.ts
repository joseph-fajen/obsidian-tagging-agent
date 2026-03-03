/**
 * Interactive agent experience for the Obsidian Vault Tagging Agent.
 *
 * Provides a conversational, guided workflow through all migration phases,
 * with session persistence for resuming across terminal sessions.
 */

import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { mkdir } from "fs/promises";

import { type Config, type ModelsByPhase } from "./config.js";
import {
  type AgentPhase,
  type SessionState,
  createInitialState,
  loadSessionState,
  saveSessionState,
  clearSessionState,
  getNextPhase,
  getPhaseName,
} from "./session-state.js";
import {
  buildInteractiveSystemPrompt,
  buildPhaseTransitionPrompt,
  buildWelcomeMessage,
  buildResumeMessage,
} from "./agent-personality.js";
import {
  generateWorklist,
  loadMappings,
  formatWorklistMarkdown,
  writeWorklistJson,
} from "./worklist-generator.js";
import {
  extractMappingsFromPlanFile,
  writePlanMappingsJson,
} from "./plan-extractor.js";
import {
  generateAudit,
  formatAuditMarkdown,
  writeAuditJson,
} from "./audit-generator.js";
import {
  generateVerify,
  formatVerifyMarkdown,
} from "./verify-generator.js";
import { createVaultTools } from "../tools/vault-tools.js";
import { createTagTools } from "../tools/tag-tools.js";
import { createGitTools } from "../tools/git-tools.js";
import { createDataTools } from "../tools/data-tools.js";
import { checkPlanPrerequisites } from "../tagging-agent.js";
import { join } from "path";
import { readFile, writeFile, unlink } from "fs/promises";
import type { MigrationWorklist, NextBatch } from "./worklist-generator.js";

// ============================================================================
// TYPES
// ============================================================================

interface PhaseResult {
  sessionId: string;
  result: string;
  success: boolean;
}

// ============================================================================
// MCP SERVER
// ============================================================================

function buildMcpServer(vaultPath: string, dataPath: string) {
  const vaultTools = createVaultTools(vaultPath);
  const tagTools = createTagTools(vaultPath, dataPath);
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
    "mcp__vault__preview_changes",
    "mcp__vault__execute_batch",
    "mcp__vault__get_progress",
    "mcp__vault__git_commit",
    "mcp__vault__read_data_file",
    "mcp__vault__write_data_file",
  ];
}

/**
 * Get the appropriate model for a given phase.
 */
function getModelForPhase(phase: AgentPhase, config: Config): string {
  switch (phase) {
    case "AUDIT":
      return config.modelsByPhase.AUDIT;
    case "PLAN":
      return config.modelsByPhase.PLAN;
    case "EXECUTE":
      return config.modelsByPhase.EXECUTE;
    case "VERIFY":
      return config.modelsByPhase.VERIFY;
    default:
      return config.modelsByPhase.CONVERSATION;
  }
}

// ============================================================================
// CONSOLE UTILITIES
// ============================================================================

function printDivider(): void {
  console.log("─".repeat(60));
}

function printHeader(text: string): void {
  console.log();
  console.log("═".repeat(60));
  console.log(`  ${text}`);
  console.log("═".repeat(60));
  console.log();
}

function printMessage(text: string): void {
  console.log();
  console.log(text);
  console.log();
}

// ============================================================================
// USER INPUT
// ============================================================================

async function promptUser(
  rl: ReturnType<typeof createInterface>,
  message: string,
  options?: string[]
): Promise<string> {
  console.log();
  console.log(message);

  if (options && options.length > 0) {
    console.log();
    options.forEach((opt, i) => {
      console.log(`  [${i + 1}] ${opt}`);
    });
    console.log();
  }

  const answer = await rl.question("> ");
  return answer.trim();
}

async function promptYesNo(
  rl: ReturnType<typeof createInterface>,
  message: string
): Promise<boolean> {
  const answer = await promptUser(rl, `${message} (y/n)`);
  return answer.toLowerCase().startsWith("y");
}

async function promptContinueExitReview(
  rl: ReturnType<typeof createInterface>
): Promise<"continue" | "exit" | "review"> {
  const answer = await promptUser(rl, "What would you like to do?", [
    "Continue to next phase",
    "Exit and save progress",
    "Review current results (stay in this phase)",
  ]);

  if (answer === "1" || answer.toLowerCase().startsWith("c")) {
    return "continue";
  }
  if (answer === "2" || answer.toLowerCase().startsWith("e")) {
    return "exit";
  }
  return "review";
}

// ============================================================================
// EXECUTE PHASE HELPERS
// ============================================================================

async function loadWorklistJson(
  dataPath: string,
  vaultPath: string
): Promise<MigrationWorklist | null> {
  const dataJsonPath = join(dataPath, "migration-worklist.json");
  try {
    const jsonRaw = await readFile(dataJsonPath, "utf-8");
    return JSON.parse(jsonRaw) as MigrationWorklist;
  } catch {
    // Fall through to vault fallback
  }

  const vaultJsonPath = join(vaultPath, "_Migration_Worklist.json");
  try {
    const jsonRaw = await readFile(vaultJsonPath, "utf-8");
    return JSON.parse(jsonRaw) as MigrationWorklist;
  } catch {
    return null;
  }
}

async function computeNextBatch(
  dataPath: string,
  vaultPath: string,
  batchSize: number
): Promise<{ batch: NextBatch | null; remaining: number }> {
  const worklist = await loadWorklistJson(dataPath, vaultPath);
  if (!worklist || worklist.worklist.length === 0) {
    return { batch: null, remaining: 0 };
  }

  // Load progress
  const progressPath = join(dataPath, "migration-progress.json");
  let processedPaths = new Set<string>();
  let processedCount = 0;
  let progressStartedAt: string | undefined;

  try {
    const progressRaw = await readFile(progressPath, "utf-8");
    const progress = JSON.parse(progressRaw);
    processedPaths = new Set(progress.processedPaths || []);
    processedCount = progress.processedCount || 0;
    progressStartedAt = progress.startedAt;
  } catch {
    // No progress file — starting fresh
  }

  // Staleness detection: if worklist was regenerated after migration started, reset progress
  // This handles cases where the vault was reset (e.g., git checkout) but progress file wasn't cleared
  if (progressStartedAt && worklist.generatedAt) {
    const worklistTime = new Date(worklist.generatedAt).getTime();
    const progressTime = new Date(progressStartedAt).getTime();
    if (worklistTime > progressTime) {
      console.log("⚠️  Worklist was regenerated after migration started — resetting progress");
      processedPaths = new Set();
      processedCount = 0;
      try {
        await unlink(progressPath);
      } catch {
        // File doesn't exist — that's fine
      }
    }
  }

  // Check if complete
  if (processedCount >= worklist.totalNotes) {
    return { batch: null, remaining: 0 };
  }

  // Compute next batch
  const unprocessedEntries = worklist.worklist.filter(
    (entry) => !processedPaths.has(entry.path)
  );
  const batchEntries = unprocessedEntries.slice(0, batchSize);
  const batchNumber =
    processedCount > 0 ? Math.ceil(processedCount / batchSize) + 1 : 1;

  const batch: NextBatch = {
    batchNumber,
    totalInWorklist: worklist.totalNotes,
    processedSoFar: processedCount,
    remaining: worklist.totalNotes - processedCount,
    entries: batchEntries,
  };

  return { batch, remaining: batch.remaining };
}

async function writeNextBatchFile(
  dataPath: string,
  batch: NextBatch
): Promise<void> {
  const batchPath = join(dataPath, "next-batch.json");
  await writeFile(batchPath, JSON.stringify(batch, null, 2), "utf-8");
}

async function deleteNextBatchFile(dataPath: string): Promise<void> {
  const batchPath = join(dataPath, "next-batch.json");
  try {
    await unlink(batchPath);
  } catch {
    // File doesn't exist
  }
}

// ============================================================================
// PHASE EXECUTION
// ============================================================================

async function runLLMPhase(
  phase: AgentPhase,
  sessionId: string | null,
  config: Config,
  batchData?: NextBatch | null
): Promise<PhaseResult> {
  const systemPrompt = buildInteractiveSystemPrompt(phase, config);
  const mcpServer = buildMcpServer(config.vaultPath, config.dataPath);

  // Build user prompt based on phase
  let userPrompt: string;
  switch (phase) {
    case "AUDIT":
      userPrompt = `Please audit all tags in the vault at ${config.vaultPath}. Write the report to _Tag Audit Report.md.`;
      break;
    case "PLAN":
      userPrompt = `Please generate a tag migration plan based on the audit report. Write the plan to _Tag Migration Plan.md.`;
      break;
    case "EXECUTE":
      if (batchData && batchData.entries.length > 0) {
        // Include batch data directly in the prompt so the agent can't ignore it
        userPrompt = `Execute this batch of tag changes. Call execute_batch with EXACTLY these parameters:

\`\`\`json
{
  "entries": ${JSON.stringify(batchData.entries, null, 2)},
  "batchNumber": ${batchData.batchNumber}
}
\`\`\`

This is batch ${batchData.batchNumber}. There are ${batchData.entries.length} notes to process.
After this batch: ${batchData.remaining - batchData.entries.length} notes will remain.

DO NOT search for notes. DO NOT read any files. Just call execute_batch with the JSON above.`;
      } else {
        userPrompt = `Please apply the tag migration plan. Process up to ${config.batchSize} notes in this batch.`;
      }
      break;
    case "VERIFY":
      userPrompt = `Please verify the tag migration. Write the verification report to _Tag Migration Verification.md.`;
      break;
    default:
      throw new Error(`Cannot run LLM phase for: ${phase}`);
  }

  let capturedSessionId = sessionId || "";
  let result = "";
  let success = true;

  // Use phase-specific model for cost optimization
  const model = getModelForPhase(phase, config);

  try {
    for await (const message of query({
      prompt: (async function* () {
        yield {
          type: "user" as const,
          message: {
            role: "user" as const,
            content: [{ type: "text" as const, text: userPrompt }],
          },
          parent_tool_use_id: null as string | null,
          session_id: "",
        };
      })(),
      options: {
        mcpServers: { vault: mcpServer },
        allowedTools: getAllowedTools(),
        permissionMode: "bypassPermissions",
        maxBudgetUsd: config.maxBudgetUsd,
        model,
        systemPrompt,
        ...(sessionId ? { resume: sessionId } : {}),
      },
    })) {
      // Capture session ID from init message
      if (
        message.type === "system" &&
        "subtype" in message &&
        message.subtype === "init"
      ) {
        capturedSessionId = message.session_id;
      }

      // Process assistant messages
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block) {
            console.log(block.text);
            result = block.text;
          } else if ("name" in block) {
            console.log(`[Tool: ${block.name}]`);
          }
        }
      }

      // Process result
      if (message.type === "result") {
        if (message.subtype === "success") {
          result = message.result || result;
          console.log();
          console.log(`Cost: $${(message.total_cost_usd || 0).toFixed(4)}`);
        } else {
          success = false;
          console.error(`Phase error: ${message.subtype}`);
          if ("errors" in message) {
            console.error(message.errors);
          }
        }
      }
    }
  } catch (error) {
    success = false;
    console.error("Error running phase:", error);
  }

  return { sessionId: capturedSessionId, result, success };
}

async function runGenerateWorklistPhase(config: Config): Promise<boolean> {
  console.log("Generating worklist deterministically (no LLM)...");
  console.log();

  try {
    // Step 1: Extract mappings from plan markdown (code-driven)
    console.log("Extracting mappings from _Tag Migration Plan.md...");
    const extraction = await extractMappingsFromPlanFile(config.vaultPath);

    if (extraction && extraction.success) {
      console.log(`  Found ${extraction.stats.totalMappings} mappings:`);
      console.log(`    MAP: ${extraction.stats.mapActions}`);
      if (extraction.stats.fixActions > 0) {
        console.log(`    FIX: ${extraction.stats.fixActions} (format/case corrections)`);
      }
      console.log(`    REMOVE: ${extraction.stats.removeActions}`);
      console.log(`    KEEP: ${extraction.stats.keepActions}`);
      if (extraction.stats.unmappedActions > 0) {
        console.log(`    UNMAPPED: ${extraction.stats.unmappedActions} (need user decision)`);
      }
      if (extraction.warnings.length > 0) {
        console.log(`  Warnings:`);
        for (const w of extraction.warnings) console.log(`    - ${w}`);
      }

      // Write plan-mappings.json
      await writePlanMappingsJson(config.dataPath, extraction.mappings, config.schemeNotePath);
      console.log(`  Written to data/plan-mappings.json`);

      // Validate extraction count against audit data
      try {
        const auditDataPath = join(config.dataPath, "audit-data.json");
        const auditRaw = await readFile(auditDataPath, "utf-8");
        const auditData = JSON.parse(auditRaw);
        if (auditData.tagFrequencies) {
          const auditTagCount = Object.keys(auditData.tagFrequencies).length;
          const extractedCount = extraction.stats.totalMappings;
          if (extractedCount < auditTagCount) {
            const missing = auditTagCount - extractedCount;
            console.log(`  ⚠️  Mapping count mismatch: extracted ${extractedCount}, audit found ${auditTagCount}`);
            console.log(`     ${missing} tags may not have been included in the plan table`);
          }
        }
      } catch {
        // audit-data.json not found — skip validation
      }
      console.log();
    } else {
      console.log("Could not extract mappings from plan markdown.");
      console.log("Checking for existing plan-mappings.json...\n");
    }

    // Step 2: Load mappings (now should include extracted mappings)
    const planMappings = await loadMappings(config.dataPath, config.vaultPath);
    if (planMappings) {
      console.log(`Loaded ${Object.keys(planMappings.mappings).length} mappings from plan-mappings.json`);
    } else {
      console.log("No plan-mappings.json found — using hardcoded mappings only");
    }

    const result = await generateWorklist(config.vaultPath, planMappings);

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

    // Write worklist to plan note
    const worklistMarkdown = formatWorklistMarkdown(result);
    const planPath = join(config.vaultPath, "_Tag Migration Plan.md");

    let planContent: string;
    try {
      const existing = await readFile(planPath, "utf-8");
      const cutoff = existing.indexOf("## Worklist Generation Summary");
      if (cutoff !== -1) {
        planContent = existing.slice(0, cutoff) + worklistMarkdown;
      } else {
        planContent = existing + "\n\n" + worklistMarkdown;
      }
    } catch {
      planContent = `---\ntags:\n  - type/report\ndate: '${new Date().toISOString().split("T")[0]}'\n---\n# Tag Migration Plan\n\n${worklistMarkdown}`;
    }

    await writeFile(planPath, planContent, "utf-8");
    console.log(`\nWorklist written to _Tag Migration Plan.md`);

    // Write JSON for machine access
    await writeWorklistJson(config.dataPath, result.worklist);
    console.log(`Worklist JSON written to data/migration-worklist.json`);
    console.log(`  ${result.worklist.worklist.length} notes in worklist`);
    console.log(`  ${result.worklist.totalChanges} total tag changes`);

    if (result.worklist.unmappedTags.length > 0) {
      console.log(
        `\n${result.worklist.unmappedTags.length} unmapped tags need decisions before executing.`
      );
    }

    return true;
  } catch (error) {
    console.error("Error generating worklist:", error);
    return false;
  }
}

async function runGenerateAuditPhase(config: Config): Promise<boolean> {
  console.log("Auditing deterministically (no LLM)...\n");

  try {
    const result = await generateAudit(config.vaultPath);

    // Print stats
    console.log(`Notes scanned: ${result.stats.totalNotesScanned}`);
    console.log(`Notes with tags: ${result.stats.notesWithTags}`);
    console.log(`Unique tags found: ${result.stats.uniqueTags}`);
    console.log(`Format issues: ${result.stats.formatIssues}`);
    console.log(`Noise tags: ${result.stats.noiseTags}`);

    if (result.warnings.length > 0) {
      console.log(`\nWarnings:`);
      for (const w of result.warnings.slice(0, 10)) console.log(`  - ${w}`);
      if (result.warnings.length > 10) {
        console.log(`  ... and ${result.warnings.length - 10} more`);
      }
    }

    // Write JSON
    await writeAuditJson(config.dataPath, result.data);
    console.log(`\nAudit data written to data/audit-data.json`);

    // Write markdown report
    const reportMarkdown = formatAuditMarkdown(result);
    const reportPath = join(config.vaultPath, "_Tag Audit Report.md");
    await writeFile(reportPath, reportMarkdown, "utf-8");
    console.log(`Audit report written to _Tag Audit Report.md`);

    return true;
  } catch (error) {
    console.error("Error running audit:", error);
    return false;
  }
}

async function runGenerateVerifyPhase(config: Config): Promise<boolean> {
  console.log("Verifying deterministically (no LLM)...\n");

  try {
    const result = await generateVerify(config.vaultPath);

    // Print stats
    console.log(`Notes scanned: ${result.stats.totalNotesScanned}`);
    console.log(`Notes compliant: ${result.stats.notesCompliant}`);
    console.log(`Notes with violations: ${result.stats.notesWithViolations}`);

    if (result.stats.notesWithViolations > 0) {
      console.log(`\nViolation breakdown:`);
      if (result.stats.inlineTagViolations > 0) {
        console.log(`  - Inline tags: ${result.stats.inlineTagViolations} notes`);
      }
      if (result.stats.formatViolations > 0) {
        console.log(`  - Format issues: ${result.stats.formatViolations} notes`);
      }
      if (result.stats.duplicateViolations > 0) {
        console.log(`  - Duplicates: ${result.stats.duplicateViolations} notes`);
      }
      if (result.stats.noiseTagViolations > 0) {
        console.log(`  - Noise tags: ${result.stats.noiseTagViolations} notes`);
      }
    }

    // Write markdown report
    const reportMarkdown = formatVerifyMarkdown(result);
    const reportPath = join(config.vaultPath, "_Tag Migration Verification.md");
    await writeFile(reportPath, reportMarkdown, "utf-8");
    console.log(`\nVerification report written to _Tag Migration Verification.md`);

    // Summary
    const compliance = (result.stats.notesCompliant / result.stats.totalNotesScanned * 100).toFixed(1);
    if (result.stats.notesWithViolations === 0) {
      console.log(`\n✅ ${compliance}% compliance — all notes pass verification!`);
    } else {
      console.log(`\n⚠️  ${compliance}% compliance — ${result.stats.notesWithViolations} notes need attention`);
    }

    // Show suggestions if any
    if (result.stats.suggestionsCount > 0) {
      console.log(`\n💡 ${result.stats.suggestionsCount} potential improvements detected`);
      console.log(`   See "_Tag Migration Verification.md" for details`);

      // Show a few examples
      const examples = result.data.suggestions.slice(0, 5);
      if (examples.length > 0) {
        console.log(`\n   Examples:`);
        for (const s of examples) {
          console.log(`     ${s.currentTag} → ${s.suggestedTag} (${s.path})`);
        }
        if (result.data.suggestions.length > 5) {
          console.log(`     ... and ${result.data.suggestions.length - 5} more`);
        }
      }
    }

    return true;
  } catch (error) {
    console.error("Error running verification:", error);
    return false;
  }
}

// ============================================================================
// STATE TRANSITIONS
// ============================================================================

/**
 * Determine the next phase based on user input and current state.
 */
export function transitionState(
  currentState: SessionState,
  userChoice: "continue" | "exit" | "review",
  phaseSuccess: boolean
): SessionState {
  if (userChoice === "exit") {
    // Save current state as-is (user will resume later)
    return currentState;
  }

  if (userChoice === "review") {
    // Stay in current phase
    return currentState;
  }

  // userChoice === "continue"
  if (!phaseSuccess) {
    // Phase failed — stay in current phase
    return currentState;
  }

  const next = getNextPhase(currentState.currentPhase);
  if (!next) {
    return { ...currentState, currentPhase: "COMPLETE" };
  }

  // Update completion flags based on phase that just completed
  const updated = { ...currentState, currentPhase: next };

  switch (currentState.currentPhase) {
    case "AUDIT":
      updated.auditComplete = true;
      break;
    case "PLAN":
      updated.planComplete = true;
      break;
    case "GENERATE_WORKLIST":
      updated.worklistGenerated = true;
      break;
    case "VERIFY":
      updated.verifyComplete = true;
      break;
  }

  return updated;
}

// ============================================================================
// MAIN INTERACTIVE LOOP
// ============================================================================

export async function runInteractiveAgent(config: Config): Promise<void> {
  printHeader("Obsidian Vault Tagging Agent — Interactive Mode");

  // Ensure data directory exists
  await mkdir(config.dataPath, { recursive: true });

  // Set up readline
  const rl = createInterface({ input, output });

  // Handle Ctrl+C gracefully
  let state: SessionState | null = null;
  const cleanup = async () => {
    if (state) {
      console.log("\n\nSaving progress before exit...");
      await saveSessionState(config.dataPath, state);
      console.log("Progress saved. Run again to resume.");
    }
    rl.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);

  try {
    // Check for existing session
    const existingState = await loadSessionState(config.dataPath);

    if (existingState && existingState.currentPhase !== "COMPLETE") {
      // Offer to resume
      printMessage(buildResumeMessage(existingState.currentPhase, existingState.vaultPath));
      const resume = await promptYesNo(rl, "Continue where you left off?");

      if (resume) {
        state = existingState;
        console.log(`\nResuming from phase: ${getPhaseName(state.currentPhase)}`);
      } else {
        // Clear old state and start fresh
        await clearSessionState(config.dataPath);
        state = createInitialState(config.vaultPath);
        console.log("\nStarting fresh session.");
      }
    } else {
      // No existing session or completed — start fresh
      state = createInitialState(config.vaultPath);
    }

    // Show welcome if starting fresh
    if (state.currentPhase === "WELCOME") {
      printMessage(buildWelcomeMessage(config.vaultPath));
      const ready = await promptYesNo(rl, "Ready to begin?");
      if (!ready) {
        console.log("\nNo problem! Run this command again when you're ready.");
        rl.close();
        return;
      }
      state = transitionState(state, "continue", true);
      await saveSessionState(config.dataPath, state);
    }

    // Main loop
    while (state.currentPhase !== "COMPLETE") {
      const phase = state.currentPhase;
      printDivider();
      console.log(`Phase: ${getPhaseName(phase)}`);
      printDivider();

      let phaseSuccess = true;
      let notesRemaining = 0;

      // Handle different phase types
      if (phase === "AUDIT") {
        // Code-driven audit (no LLM)
        phaseSuccess = await runGenerateAuditPhase(config);
      } else if (phase === "VERIFY") {
        // Code-driven verify (no LLM)
        phaseSuccess = await runGenerateVerifyPhase(config);
      } else if (phase === "PLAN") {
        // Plan phase with pre-flight check
        const prerequisitesMet = await checkPlanPrerequisites(config.dataPath, config.vaultPath);
        if (!prerequisitesMet) {
          console.log("\nPlease run the audit phase first to generate the required data.");
          phaseSuccess = false;
        } else {
          const result = await runLLMPhase(phase, state.sessionId, config);
          state.sessionId = result.sessionId;
          phaseSuccess = result.success;
        }
      } else if (phase === "EXECUTE") {
        // Execute phase with batch handling
        const { batch, remaining } = await computeNextBatch(
          config.dataPath,
          config.vaultPath,
          config.batchSize
        );

        if (!batch || batch.entries.length === 0) {
          console.log("No more notes to process — migration complete!");
          phaseSuccess = true;
          notesRemaining = 0;
        } else {
          // Write batch file for the agent (kept for debugging, but data is now in prompt)
          await writeNextBatchFile(config.dataPath, batch);
          console.log(`Processing batch ${batch.batchNumber}: ${batch.entries.length} notes`);
          console.log();

          // Run the execute LLM phase with batch data included directly in prompt
          const result = await runLLMPhase(phase, state.sessionId, config, batch);
          state.sessionId = result.sessionId;
          phaseSuccess = result.success;

          // Recompute remaining after batch
          const afterBatch = await computeNextBatch(
            config.dataPath,
            config.vaultPath,
            config.batchSize
          );
          notesRemaining = afterBatch.remaining;

          // Clean up batch file
          await deleteNextBatchFile(config.dataPath);
        }
      } else if (phase === "GENERATE_WORKLIST") {
        // Deterministic code phase (no LLM)
        phaseSuccess = await runGenerateWorklistPhase(config);
      }

      // Save state after each phase
      await saveSessionState(config.dataPath, state);

      // Determine next action
      if (phaseSuccess) {
        // Show transition message
        const nextPhase = getNextPhase(phase);
        if (nextPhase) {
          printMessage(
            buildPhaseTransitionPrompt(phase, nextPhase, { notesRemaining })
          );
        }

        // For EXECUTE with remaining notes, offer to continue batch or move on
        if (phase === "EXECUTE" && notesRemaining > 0) {
          const choice = await promptUser(
            rl,
            `${notesRemaining} notes remaining. What would you like to do?`,
            [
              "Process next batch",
              "Move to verification (skip remaining)",
              "Exit and save progress",
            ]
          );

          if (choice === "1" || choice.toLowerCase().startsWith("p")) {
            // Stay in EXECUTE phase
            continue;
          } else if (choice === "2" || choice.toLowerCase().startsWith("m")) {
            // Skip to VERIFY
            state.currentPhase = "VERIFY";
            await saveSessionState(config.dataPath, state);
            continue;
          } else {
            // Exit
            console.log("\nProgress saved. Run again to resume.");
            break;
          }
        }

        // For EXECUTE with no remaining, transition to VERIFY
        if (phase === "EXECUTE" && notesRemaining === 0) {
          state = transitionState(state, "continue", true);
          await saveSessionState(config.dataPath, state);
          continue;
        }

        // Standard continue/exit/review prompt
        const choice = await promptContinueExitReview(rl);

        if (choice === "exit") {
          console.log("\nProgress saved. Run again to resume.");
          break;
        }

        if (choice === "review") {
          console.log("\nTake your time reviewing. Press Enter when ready to continue.");
          await rl.question("");
          continue;
        }

        // Continue to next phase
        state = transitionState(state, "continue", phaseSuccess);
        await saveSessionState(config.dataPath, state);
      } else {
        // Phase failed
        console.log("\nPhase encountered an error. Would you like to retry or exit?");
        const retry = await promptYesNo(rl, "Retry this phase?");
        if (!retry) {
          console.log("\nProgress saved. Run again to resume.");
          break;
        }
        // Stay in current phase and retry
      }
    }

    // Completion
    if (state.currentPhase === "COMPLETE") {
      printHeader("Migration Complete!");
      printMessage(buildPhaseTransitionPrompt("VERIFY", "COMPLETE"));

      // Clear session state since we're done
      await clearSessionState(config.dataPath);
    }
  } finally {
    rl.close();
    process.removeListener("SIGINT", cleanup);
  }
}
