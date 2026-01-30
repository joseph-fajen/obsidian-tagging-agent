/**
 * DEMO: Sessions
 *
 * Demonstrates session management for context persistence across queries.
 *
 * Key concepts:
 * - Sessions persist conversation context
 * - Capture session_id from the init message
 * - Resume: Continue a previous session with full context
 * - Fork: Create a new branch from a session's state
 *
 * Run: bun run demo-sessions.ts
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

// ============================================================================
// DEMO CONFIGURATION
// ============================================================================

console.log("\n");
console.log("╔══════════════════════════════════════════════════════════════════╗");
console.log("║           CLAUDE AGENT SDK - SESSIONS DEMONSTRATION              ║");
console.log("╚══════════════════════════════════════════════════════════════════╝");
console.log();

console.log("SESSION CONCEPTS:");
console.log("─".repeat(60));
console.log();
console.log("  📦 Sessions persist conversation context");
console.log("  🔑 Each session has a unique session_id");
console.log("  ▶️  RESUME: Continue a session with the same context");
console.log("  🔀 FORK: Branch off a new session from an existing one");
console.log();
console.log("  This demo will:");
console.log("  1. Create an initial session and capture the session_id");
console.log("  2. Resume that session to continue the conversation");
console.log("  3. Fork the session to explore an alternative path");
console.log();
console.log("─".repeat(60));

// ============================================================================
// DEMO: THREE-PHASE SESSION WORKFLOW
// ============================================================================

async function runSessionsDemo() {
  console.log("\n🚀 STARTING SESSIONS DEMONSTRATION\n");

  let sessionId: string | undefined;
  const startTime = Date.now();
  let totalCost = 0;

  // ========================================================================
  // PHASE 1: Create initial session
  // ========================================================================

  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  PHASE 1: Create Initial Session                                 ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log();

  let phase1Result = "";

  try {
    for await (const message of query({
      prompt: `Let's analyze this project together. First, tell me what type of project this is based on the package.json. Remember your analysis - we'll continue in the next message.

Important: Keep your response to 2-3 sentences.`,
      options: {
        allowedTools: ["Read", "Glob"],
        permissionMode: "bypassPermissions",
        maxTurns: 5,
        maxBudgetUsd: 0.20,
        systemPrompt: "You are a helpful code analyst. Remember details from our conversation.",
      },
    })) {
      // IMPORTANT: Capture session_id from init message
      if (message.type === "system" && "subtype" in message && message.subtype === "init") {
        sessionId = message.session_id;
        console.log("┌" + "─".repeat(58) + "┐");
        console.log(`│ 🔑 SESSION CREATED                                         │`);
        console.log("└" + "─".repeat(58) + "┘");
        console.log(`   Session ID: ${sessionId}`);
        console.log();
      }

      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block) {
            phase1Result = block.text;
          }
        }
      }

      if (message.type === "result" && message.subtype === "success") {
        phase1Result = message.result || phase1Result;
        totalCost += message.total_cost_usd || 0;
      }
    }

    console.log("📝 Phase 1 Result:");
    console.log("─".repeat(40));
    console.log(phase1Result);
    console.log();

  } catch (error) {
    console.error("Phase 1 failed:", error);
    process.exit(1);
  }

  if (!sessionId) {
    console.error("❌ Failed to capture session ID!");
    process.exit(1);
  }

  // Brief pause for visual clarity
  await new Promise(resolve => setTimeout(resolve, 1000));

  // ========================================================================
  // PHASE 2: Resume the session
  // ========================================================================

  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  PHASE 2: Resume Session (Continue Context)                      ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("┌" + "─".repeat(58) + "┐");
  console.log(`│ ▶️  RESUMING SESSION                                        │`);
  console.log("└" + "─".repeat(58) + "┘");
  console.log(`   Using: resume: "${sessionId}"`);
  console.log();

  let phase2Result = "";
  let phase2SessionId = "";

  try {
    for await (const message of query({
      // Reference previous context - Claude remembers!
      prompt: `Based on your analysis of the project type, what would be a good next step for improving this project? Keep it to 2-3 sentences.`,
      options: {
        // RESUME: Pass the session_id to continue
        resume: sessionId,

        allowedTools: ["Read", "Glob"],
        permissionMode: "bypassPermissions",
        maxTurns: 5,
        maxBudgetUsd: 0.20,
      },
    })) {
      if (message.type === "system" && "subtype" in message && message.subtype === "init") {
        phase2SessionId = message.session_id;
        console.log(`   Resumed Session ID: ${phase2SessionId}`);
        console.log(`   Same as original: ${phase2SessionId === sessionId ? "✅ YES" : "❌ NO"}`);
        console.log();
      }

      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block) {
            phase2Result = block.text;
          }
        }
      }

      if (message.type === "result" && message.subtype === "success") {
        phase2Result = message.result || phase2Result;
        totalCost += message.total_cost_usd || 0;
      }
    }

    console.log("📝 Phase 2 Result (with context from Phase 1):");
    console.log("─".repeat(40));
    console.log(phase2Result);
    console.log();

  } catch (error) {
    console.error("Phase 2 failed:", error);
    process.exit(1);
  }

  // Brief pause
  await new Promise(resolve => setTimeout(resolve, 1000));

  // ========================================================================
  // PHASE 3: Fork the session
  // ========================================================================

  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  PHASE 3: Fork Session (Branch Off)                              ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("┌" + "─".repeat(58) + "┐");
  console.log(`│ 🔀 FORKING SESSION                                          │`);
  console.log("└" + "─".repeat(58) + "┘");
  console.log(`   Using: resume: "${sessionId}", forkSession: true`);
  console.log();

  let phase3Result = "";
  let forkedSessionId = "";

  try {
    for await (const message of query({
      // Same context, but exploring an alternative direction
      prompt: `Actually, let's take a different approach. What would be the WORST thing to do to this project? (Just for fun - keep it to 2-3 sentences.)`,
      options: {
        // FORK: Creates new session from the original state
        resume: sessionId,
        forkSession: true,

        allowedTools: ["Read", "Glob"],
        permissionMode: "bypassPermissions",
        maxTurns: 5,
        maxBudgetUsd: 0.20,
      },
    })) {
      if (message.type === "system" && "subtype" in message && message.subtype === "init") {
        forkedSessionId = message.session_id;
        console.log(`   Forked Session ID: ${forkedSessionId}`);
        console.log(`   Different from original: ${forkedSessionId !== sessionId ? "✅ YES (new branch!)" : "❌ NO"}`);
        console.log();
      }

      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block) {
            phase3Result = block.text;
          }
        }
      }

      if (message.type === "result" && message.subtype === "success") {
        phase3Result = message.result || phase3Result;
        totalCost += message.total_cost_usd || 0;
      }
    }

    console.log("📝 Phase 3 Result (forked branch - alternative path):");
    console.log("─".repeat(40));
    console.log(phase3Result);
    console.log();

  } catch (error) {
    console.error("Phase 3 failed:", error);
    process.exit(1);
  }

  // ============================================================================
  // RESULTS SUMMARY
  // ============================================================================

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║                        DEMO RESULTS                              ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`  ⏱️  Duration: ${duration} seconds`);
  console.log(`  💰 Total Cost: $${totalCost.toFixed(4)}`);
  console.log();
  console.log("  SESSION TIMELINE:");
  console.log("  " + "─".repeat(56));
  console.log();
  console.log(`  Phase 1: Created       │ ${sessionId}`);
  console.log("           ↓");
  console.log(`  Phase 2: Resumed       │ ${phase2SessionId}`);
  console.log(`           (same ID)     │ Context preserved: ✅`);
  console.log("           ↓");
  console.log(`  Phase 3: Forked        │ ${forkedSessionId}`);
  console.log(`           (new ID!)     │ Branched off: ✅`);
  console.log();

  // ============================================================================
  // KEY TAKEAWAYS
  // ============================================================================

  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║                      KEY TAKEAWAYS                               ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("  1. Sessions persist conversation context across queries");
  console.log("  2. Capture session_id from the init message");
  console.log("  3. RESUME: Continue with `options: { resume: sessionId }`");
  console.log("  4. FORK: Branch with `options: { resume: sessionId, forkSession: true }`");
  console.log("  5. Forking creates a NEW session ID from the original state");
  console.log();
  console.log("  Session capture code:");
  console.log("  ```typescript");
  console.log("  let sessionId: string;");
  console.log("  for await (const msg of query({ prompt })) {");
  console.log('    if (msg.type === "system" && msg.subtype === "init") {');
  console.log("      sessionId = msg.session_id;  // Capture it!");
  console.log("    }");
  console.log("  }");
  console.log("  ```");
  console.log();
  console.log("  Resume vs Fork:");
  console.log("  ```typescript");
  console.log("  // Continue same session");
  console.log("  options: { resume: sessionId }");
  console.log();
  console.log("  // Branch to new session");
  console.log("  options: { resume: sessionId, forkSession: true }");
  console.log("  ```");
  console.log();
}

// Run the demo
runSessionsDemo().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
