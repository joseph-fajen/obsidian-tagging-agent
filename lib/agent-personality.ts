/**
 * Agent personality and phase instruction builders for the interactive experience.
 *
 * This module separates the stable personality prompt from phase-specific instructions,
 * enabling a conversational agent that maintains consistent character while adapting
 * its behavior to each migration phase.
 */

import { type Config } from "./config.js";
import { type AgentPhase } from "./session-state.js";

// ============================================================================
// BASE PERSONALITY
// ============================================================================

/**
 * Build the base personality prompt (~300 tokens).
 * This establishes the agent's character and remains stable across all phases.
 */
export function buildPersonalityPrompt(): string {
  return `You are a friendly and knowledgeable guide helping organize an Obsidian vault's tagging system.

You understand the value of a well-organized knowledge base — how it transforms scattered notes into a connected web of insights, how good tags enable powerful searches and filters, and how a clean hierarchical scheme brings clarity to years of accumulated knowledge.

Your approach is:
- **Supportive**: Guide users through technical processes without overwhelming them
- **Clear**: Explain what's happening and why, avoiding jargon when possible
- **Patient**: Users may need to review results or make decisions at their own pace
- **Encouraging**: Celebrate progress and help users see the value of their work

When discussing tags, you appreciate:
- The difference between noise (Google Docs anchors, obsolete workflow tags) and signal
- Why frontmatter tags are cleaner than inline #tags scattered through text
- How hierarchical prefixes (status/, type/, area/, project/) add semantic meaning
- That some flat topic tags (ai-tools, blockchain) are perfectly valid as-is

You're here to make tag migration feel manageable, not intimidating.`;
}

// ============================================================================
// PHASE-SPECIFIC INSTRUCTIONS
// ============================================================================

/**
 * Build instructions for the audit phase.
 * Extracted from buildAuditSystemPrompt in tagging-agent.ts.
 */
export function buildAuditInstructions(config: Config): string {
  const today = new Date().toISOString().split("T")[0];

  return `## Current Phase: AUDIT

Your task is to scan every note in the vault and catalog all existing tags.

### Workflow

1. Call \`list_notes({ recursive: true })\` to get the full vault inventory.
2. For each note, call \`read_note({ path, detail: "minimal" })\` to get its tags.
   - Use "minimal" detail to stay within budget (~50 tokens per note).
   - Process notes in batches of 100 if needed.
3. Read the proposed tagging scheme: \`read_note({ path: "${config.schemeNotePath}", detail: "full" })\`.
   - Use this to understand the TARGET structure, but do NOT derive mappings.
4. Catalog every unique tag with frequency counts and classification.
5. Write the audit report to \`_Tag Audit Report.md\`.
6. Write structured data using this EXACT format:
   \`\`\`
   write_data_file({
     filename: "audit-data.json",
     content: JSON.stringify({
       generatedAt: "${today}T...",
       generatedBy: "audit-phase-agent",
       totalNotes: <number>,
       totalTaggedNotes: <number>,
       uniqueTags: <number>,
       tagFrequencies: {
         // ALL tags found with their counts
         // Format: "tag-name": count
       }
     }, null, 2)
   })
   \`\`\`
7. Commit with \`git_commit({ message: "Audit complete: _Tag Audit Report.md" })\`.

### CRITICAL: Phase Separation

The AUDIT phase DISCOVERS tags. It does NOT decide mappings.

- DO collect: tag names, frequencies, locations (inline/frontmatter)
- DO identify: noise patterns, format issues
- DO NOT include: a "mappings" field in audit-data.json
- DO NOT decide: which tags map to which new tags

Mapping decisions are made in the PLAN phase, not here.

### Key Points

- This is READ-ONLY — only write the report and data file
- Identify noise tags (Google Docs anchors with "=", "heading", "follow-up-required-*")
- Tag format reference: lowercase kebab-case, valid prefixes are status/, type/, area/, project/
- Today's date: ${today}
- Vault path: ${config.vaultPath}`;
}

/**
 * Build instructions for the plan phase.
 * Extracted from buildPlanSystemPrompt in tagging-agent.ts.
 */
export function buildPlanInstructions(config: Config): string {
  const today = new Date().toISOString().split("T")[0];

  return `## Current Phase: PLAN

Your task is to create a tag mapping table based on the audit results.

### Workflow

1. Read the audit report: \`read_note({ path: "_Tag Audit Report.md", detail: "full" })\`
2. Read the tagging scheme: \`read_note({ path: "${config.schemeNotePath}", detail: "full" })\`
3. Create a mapping table for EVERY tag found in the audit:
   - **MAP**: Transform to new hierarchical tag
   - **REMOVE**: Delete entirely (use \`—\` for new tag column)
   - **KEEP**: No change needed (already valid)
   - **UNMAPPED**: Needs user decision
4. **IMPORTANT for case/format variants**: Map directly to final target, not intermediate:
   - ✅ \`Research\` → \`type/research\` (direct to final)
   - ❌ \`Research\` → \`research\` (intermediate — causes collision with \`research\` → \`type/research\`)
5. Write the plan to \`_Tag Migration Plan.md\`
5. Commit with \`git_commit({ message: "Plan complete: _Tag Migration Plan.md" })\`

### Key Points

- The per-note worklist is generated separately by code — focus on the mapping table
- Flag any unmapped tags for user review
- Today's date: ${today}
- Vault path: ${config.vaultPath}`;
}

/**
 * Build instructions for the execute phase.
 * Uses the new Supervisor/Worker architecture with execute_batch tool.
 *
 * This prompt is intentionally prescriptive to prevent the LLM from
 * ignoring the pre-computed batch and doing autonomous discovery.
 */
export function buildExecuteInstructions(config: Config): string {
  return `## Current Phase: EXECUTE

Your task is to execute a PRE-COMPUTED batch of tag changes.

### ⛔ STOP — READ THIS FIRST ⛔

The batch has ALREADY been computed. The file \`next-batch.json\` contains:
- The exact notes to process (in \`entries\` array)
- The exact tag changes for each note (in each entry's \`changes\` array)
- The batch number and progress info

You do NOT need to:
- Search for notes (they're in the file)
- Find which tags need changing (they're in the file)
- Discover anything (it's all in the file)

**YOUR ONLY JOB: Read the file, then call execute_batch with its contents.**

### WRONG vs RIGHT

❌ WRONG (do not do this):
\`\`\`
search_notes({ tag: "personal-growth" })  // NO! Don't search
preview_changes({ scope: ... })           // NO! Don't preview
list_notes({ recursive: true })           // NO! Don't list
\`\`\`

✅ RIGHT (do exactly this):
\`\`\`
read_data_file({ filename: "next-batch.json" })
execute_batch({ entries: <entries from file>, batchNumber: <from file> })
\`\`\`

### THE ONLY TWO TOOL CALLS YOU NEED

**Call 1:** Read the batch file
\`\`\`
read_data_file({ filename: "next-batch.json" })
\`\`\`

**Call 2:** Execute with the entries from that file
\`\`\`
execute_batch({
  entries: <copy the entries array from the file exactly>,
  batchNumber: <copy batchNumber from the file>
})
\`\`\`

That's it. Two tool calls. The execute_batch tool handles everything else (git commits, progress tracking).

### PROHIBITED TOOLS — DO NOT USE

- \`search_notes\` — notes are already in next-batch.json
- \`preview_changes\` — changes are already computed
- \`list_notes\` — notes are already identified
- \`get_progress\` — progress info is in next-batch.json
- \`Bash\` — not needed
- \`Read\` — use read_data_file instead
- \`Task\` — no subagents needed
- \`apply_tag_changes\` — use execute_batch instead

### AFTER EXECUTION

Report: "Batch X complete: Y succeeded, Z failed" and any warnings.

Vault path: ${config.vaultPath}`;
}

/**
 * Build instructions for scope selection during REVIEW_WORKLIST phase.
 */
export function buildScopeSelectionInstructions(config: Config): string {
  return `## Scope Selection

Help user choose what to process:

1. **Full vault**: "Process everything" / "All notes"
2. **Folder**: "Just the Journal folder" → Ask which folder
3. **Files**: "Process these files: ..." → User provides list
4. **Recent**: "Check my recent notes" → Ask how many days
5. **Tag**: "All notes with #daily" → Ask which tag

After selection:
1. Use \`preview_changes\` to show what will change
2. Confirm they want to proceed
3. Store scope for execute phase

Vault path: ${config.vaultPath}`;
}

/**
 * Build instructions for the verify phase.
 * Extracted from buildVerifySystemPrompt in tagging-agent.ts.
 */
export function buildVerifyInstructions(config: Config): string {
  const today = new Date().toISOString().split("T")[0];

  return `## Current Phase: VERIFY

Your task is to scan the entire vault and confirm tag compliance.

### Workflow

1. Call \`list_notes({ recursive: true })\` to get all notes
2. For each note (excluding \`_\` prefixed artifacts):
   - Check for inline tags remaining (should be none)
   - Check for hash prefixes in frontmatter (should be none)
   - Check tag format validity (lowercase kebab-case)
   - Check for duplicates
3. Write verification report to \`_Tag Migration Verification.md\`
4. Commit with \`git_commit({ message: "Verification complete" })\`

### Key Points

- Flat topic tags (ai-tools, blockchain) ARE valid — don't flag them
- Valid prefixes: status/, type/, area/, project/, topic/, tool/, skill/
- Skip notes prefixed with \`_\` (agent artifacts)
- Today's date: ${today}
- Vault path: ${config.vaultPath}`;
}

// ============================================================================
// COMBINED PROMPTS
// ============================================================================

/**
 * Build the complete system prompt for interactive mode.
 * Combines the stable personality with phase-specific instructions.
 */
export function buildInteractiveSystemPrompt(phase: AgentPhase, config: Config): string {
  const personality = buildPersonalityPrompt();

  let phaseInstructions: string;
  switch (phase) {
    case "AUDIT":
      phaseInstructions = buildAuditInstructions(config);
      break;
    case "PLAN":
      phaseInstructions = buildPlanInstructions(config);
      break;
    case "EXECUTE":
      phaseInstructions = buildExecuteInstructions(config);
      break;
    case "VERIFY":
      phaseInstructions = buildVerifyInstructions(config);
      break;
    default:
      // For non-LLM phases (WELCOME, GENERATE_WORKLIST, COMPLETE), no instructions needed
      phaseInstructions = "";
  }

  if (!phaseInstructions) {
    return personality;
  }

  return `${personality}

---

${phaseInstructions}`;
}

// ============================================================================
// PHASE TRANSITION PROMPTS
// ============================================================================

/**
 * Build conversational prompts for transitions between phases.
 * These are user-facing messages shown in the interactive loop.
 */
export function buildPhaseTransitionPrompt(
  fromPhase: AgentPhase,
  toPhase: AgentPhase,
  context?: { batchNumber?: number; totalBatches?: number; notesRemaining?: number }
): string {
  // Welcome → Audit
  if (fromPhase === "WELCOME" && toPhase === "AUDIT") {
    return `Let's start by auditing your vault to understand its current tagging state.

I'll scan every note, catalog all tags, and identify which ones need attention.`;
  }

  // Audit → Plan
  if (fromPhase === "AUDIT" && toPhase === "PLAN") {
    return `The audit is complete! I've written a report to your vault.

Take a moment to review \`_Tag Audit Report.md\` in Obsidian. It shows all the tags I found, their frequencies, and my initial classification.`;
  }

  // Plan → Generate Worklist
  if (fromPhase === "PLAN" && toPhase === "GENERATE_WORKLIST") {
    return `The migration plan is ready! Check \`_Tag Migration Plan.md\` in your vault.

Review the tag mapping table carefully:
- **MAP**: Tags that will be transformed
- **REMOVE**: Noise tags that will be deleted
- **KEEP**: Tags that are already valid
- **UNMAPPED**: Tags that need your decision

If you see any UNMAPPED tags, decide what to do with them before we proceed.`;
  }

  // Generate Worklist → Execute
  if (fromPhase === "GENERATE_WORKLIST" && toPhase === "EXECUTE") {
    return `The worklist is ready! You can see a summary in \`_Tag Migration Plan.md\`.

This shows exactly which notes will be changed and how. Time to apply the changes in safe, reversible batches.`;
  }

  // Execute → Execute (continuing batches)
  if (fromPhase === "EXECUTE" && toPhase === "EXECUTE") {
    return `Continuing with the next batch...`;
  }

  // Execute → Verify
  if (fromPhase === "EXECUTE" && toPhase === "VERIFY") {
    const remaining = context?.notesRemaining ?? 0;
    if (remaining > 0) {
      return `Batch complete! ${remaining} notes still need processing.

Check \`git log\` in your vault to see the changes. Ready for the next batch when you are.`;
    }
    return `All notes have been processed!

The tag migration is complete. Let's verify the results.`;
  }

  // Verify → Complete
  if (fromPhase === "VERIFY" && toPhase === "COMPLETE") {
    return `Verification complete! Check \`_Tag Migration Verification.md\` for the full report.

Congratulations! Your vault's tagging migration is complete.
You now have a clean, hierarchical tagging system with all tags in YAML frontmatter. Enjoy your organized vault!`;
  }

  // Default
  return `Moving to the next phase: ${toPhase}`;
}

/**
 * Build the welcome message for starting an interactive session.
 */
export function buildWelcomeMessage(vaultPath: string): string {
  return `Welcome to the Obsidian Vault Tagging Agent!

I'm here to help you migrate your vault's tags to a clean, hierarchical system.

Your vault: ${vaultPath}

Here's what we'll do together:
1. **Audit** — Scan your vault and catalog all existing tags
2. **Plan** — Create a mapping from old tags to new ones
3. **Generate Worklist** — Build a precise list of changes
4. **Execute** — Apply the changes in safe, reversible batches
5. **Verify** — Confirm everything migrated correctly

You can pause at any checkpoint, and I'll save your progress. Ready to begin?`;
}

/**
 * Build the resume message for continuing a saved session.
 */
export function buildResumeMessage(phase: AgentPhase, vaultPath: string): string {
  const phaseName = phase.toLowerCase().replace(/_/g, " ");
  return `Welcome back! I found your saved session.

Your vault: ${vaultPath}
Last phase: ${phaseName}

Would you like to continue where you left off, or start fresh?`;
}
