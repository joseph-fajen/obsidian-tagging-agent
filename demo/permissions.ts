/**
 * DEMO: Permissions
 *
 * Demonstrates the different permission modes that control agent autonomy.
 *
 * Key concepts:
 * - default: Requires explicit approval for each action
 * - acceptEdits: Auto-approves file edits only
 * - bypassPermissions: Full autonomous execution
 * - plan: Read-only analysis, no execution
 * - canUseTool: Custom callback for granular control
 *
 * Run: bun run demo-permissions.ts
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

// ============================================================================
// DEMO CONFIGURATION
// ============================================================================

console.log("\n");
console.log("╔══════════════════════════════════════════════════════════════════╗");
console.log("║          CLAUDE AGENT SDK - PERMISSIONS DEMONSTRATION            ║");
console.log("╚══════════════════════════════════════════════════════════════════╝");
console.log();

console.log("PERMISSION MODES:");
console.log("─".repeat(60));
console.log();
console.log("  🛑 default          - Prompts for EVERY action");
console.log("                        Use: Custom approval workflows");
console.log();
console.log("  📝 acceptEdits      - Auto-approves file edits ONLY");
console.log("                        Use: Trusted dev workflows");
console.log();
console.log("  🚀 bypassPermissions - Full autonomous execution");
console.log("                        Use: CI/CD, proactive agents");
console.log();
console.log("  📋 plan             - Read-only analysis, NO execution");
console.log("                        Use: Safe exploration, planning");
console.log();
console.log("  🎯 canUseTool       - Custom callback for each tool");
console.log("                        Use: Fine-grained control");
console.log();
console.log("─".repeat(60));

// ============================================================================
// TRACK PERMISSION DECISIONS
// ============================================================================

interface PermissionEvent {
  mode: string;
  tool: string;
  decision: "allowed" | "denied" | "prompted";
  timestamp: Date;
}
const permissionEvents: PermissionEvent[] = [];

// ============================================================================
// DEMO FUNCTIONS
// ============================================================================

/**
 * Demo 1: bypassPermissions mode (full autonomy)
 */
async function demoBypassPermissions() {
  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  DEMO 1: bypassPermissions (Full Autonomy)                       ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("  Mode: bypassPermissions");
  console.log("  Effect: All tools execute without prompting");
  console.log();

  let result = "";
  let toolsUsed: string[] = [];

  try {
    for await (const message of query({
      prompt: "List the TypeScript files in this directory and read package.json. Keep your response brief.",
      options: {
        allowedTools: ["Glob", "Read", "Bash"],
        permissionMode: "bypassPermissions",  // <-- FULL AUTONOMY
        maxTurns: 5,
        maxBudgetUsd: 0.15,
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("name" in block) {
            toolsUsed.push(block.name);
            permissionEvents.push({
              mode: "bypassPermissions",
              tool: block.name,
              decision: "allowed",
              timestamp: new Date(),
            });
            console.log(`  ✅ ${block.name} - AUTO-APPROVED (bypass mode)`);
          }
          if ("text" in block) {
            result = block.text;
          }
        }
      }

      if (message.type === "result" && message.subtype === "success") {
        result = message.result || result;
      }
    }

    console.log();
    console.log("  Result: Tools executed without any prompts!");
    console.log(`  Tools used: ${toolsUsed.join(", ")}`);
    return true;
  } catch (error) {
    console.error("  Error:", error);
    return false;
  }
}

/**
 * Demo 2: Hook-based blocking (granular control)
 * Note: canUseTool is for interactive scenarios; hooks work better for headless blocking
 */
async function demoHookBlocking() {
  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  DEMO 2: Hook-Based Blocking (Granular Control)                  ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("  Mode: bypassPermissions + PreToolUse hook");
  console.log("  Effect: Hook intercepts and blocks specific tools");
  console.log("  Policy: Allow Read/Glob, BLOCK Bash via hook");
  console.log();

  let result = "";
  let toolsUsed: string[] = [];
  let toolsBlocked: string[] = [];

  // Hook to block Bash commands
  const blockBashHook = async (input: any) => {
    if (input.hook_event_name === "PreToolUse" && input.tool_name === "Bash") {
      console.log(`  ⛔ ${input.tool_name} - BLOCKED by PreToolUse hook`);
      const command = input.tool_input?.command || "";
      console.log(`     (Command: ${command.substring(0, 40)}...)`);
      toolsBlocked.push("Bash");
      permissionEvents.push({
        mode: "hook-blocking",
        tool: "Bash",
        decision: "denied",
        timestamp: new Date(),
      });
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny" as const,
          permissionDecisionReason: "Bash commands blocked by security policy",
        },
      };
    }
    // Allow other tools
    if (input.hook_event_name === "PreToolUse") {
      console.log(`  ✅ ${input.tool_name} - ALLOWED`);
      permissionEvents.push({
        mode: "hook-blocking",
        tool: input.tool_name,
        decision: "allowed",
        timestamp: new Date(),
      });
    }
    return {};
  };

  try {
    for await (const message of query({
      prompt: "Try to: 1) list files with Glob, 2) read package.json, 3) run 'echo hello' with Bash. Try all three.",
      options: {
        allowedTools: ["Glob", "Read", "Bash"],
        permissionMode: "bypassPermissions",  // Need bypass but hook will block
        maxTurns: 8,
        maxBudgetUsd: 0.15,
        hooks: {
          PreToolUse: [{ hooks: [blockBashHook] }],  // Hook blocks Bash
        },
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("name" in block) {
            if (!toolsBlocked.includes(block.name)) {
              toolsUsed.push(block.name);
            }
          }
          if ("text" in block) {
            result = block.text;
          }
        }
      }

      if (message.type === "result" && message.subtype === "success") {
        result = message.result || result;
      }
    }

    console.log();
    console.log(`  Result: ${toolsUsed.length} tools allowed, ${toolsBlocked.length} blocked`);
    console.log(`  Allowed: ${[...new Set(toolsUsed)].join(", ") || "none"}`);
    console.log(`  Blocked: ${toolsBlocked.join(", ") || "none"}`);
    return toolsBlocked.length > 0;  // Success if we blocked something
  } catch (error) {
    console.error("  Error:", error);
    return false;
  }
}

/**
 * Demo 3: plan mode (read-only)
 */
async function demoPlanMode() {
  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  DEMO 3: plan Mode (Read-Only Analysis)                          ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("  Mode: plan");
  console.log("  Effect: Agent can only read/analyze, NOT execute");
  console.log("  Good for: Safe exploration, generating plans");
  console.log();

  let result = "";
  let toolsUsed: string[] = [];

  try {
    for await (const message of query({
      prompt: "Read the package.json and create a plan for how you would add a new feature. Don't actually make changes.",
      options: {
        allowedTools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash"],
        permissionMode: "plan",  // <-- READ-ONLY MODE
        maxTurns: 5,
        maxBudgetUsd: 0.15,
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("name" in block) {
            toolsUsed.push(block.name);
            permissionEvents.push({
              mode: "plan",
              tool: block.name,
              decision: "allowed",
              timestamp: new Date(),
            });
            console.log(`  📖 ${block.name} - READ-ONLY (plan mode)`);
          }
          if ("text" in block) {
            result = block.text;
          }
        }
      }

      if (message.type === "result" && message.subtype === "success") {
        result = message.result || result;
      }
    }

    console.log();
    console.log("  Result: Agent analyzed but did NOT execute any changes");
    console.log(`  Tools used (read-only): ${toolsUsed.join(", ") || "none"}`);

    // In plan mode, Write/Edit/Bash should NOT have actually executed
    const safeTools = toolsUsed.every(t => ["Read", "Glob", "Grep"].includes(t));
    console.log(`  Only safe tools used: ${safeTools ? "✅" : "⚠️"}`);

    return true;
  } catch (error) {
    console.error("  Error:", error);
    return false;
  }
}

/**
 * Demo 4: acceptEdits mode
 */
async function demoAcceptEdits() {
  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║  DEMO 4: acceptEdits Mode                                        ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("  Mode: acceptEdits");
  console.log("  Effect: Auto-approve file edits (Read/Write/Edit)");
  console.log("  Note: Other tools (Bash) would still prompt in interactive mode");
  console.log();

  let result = "";
  let toolsUsed: string[] = [];

  try {
    for await (const message of query({
      prompt: "Read the README.md file if it exists. Keep your response brief.",
      options: {
        allowedTools: ["Read", "Glob", "Write", "Edit"],
        permissionMode: "acceptEdits",  // <-- AUTO-APPROVE EDITS
        maxTurns: 5,
        maxBudgetUsd: 0.15,
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("name" in block) {
            toolsUsed.push(block.name);
            permissionEvents.push({
              mode: "acceptEdits",
              tool: block.name,
              decision: "allowed",
              timestamp: new Date(),
            });
            console.log(`  📝 ${block.name} - AUTO-APPROVED (acceptEdits mode)`);
          }
          if ("text" in block) {
            result = block.text;
          }
        }
      }

      if (message.type === "result" && message.subtype === "success") {
        result = message.result || result;
      }
    }

    console.log();
    console.log("  Result: File operations auto-approved!");
    console.log(`  Tools used: ${toolsUsed.join(", ") || "none"}`);
    return true;
  } catch (error) {
    console.error("  Error:", error);
    return false;
  }
}

// ============================================================================
// RUN ALL DEMOS
// ============================================================================

async function runPermissionsDemo() {
  console.log("\n🚀 STARTING PERMISSIONS DEMONSTRATION\n");

  const startTime = Date.now();
  const results: { name: string; passed: boolean }[] = [];

  // Run each demo
  results.push({ name: "bypassPermissions", passed: await demoBypassPermissions() });
  results.push({ name: "Hook-based blocking", passed: await demoHookBlocking() });
  results.push({ name: "plan mode", passed: await demoPlanMode() });
  results.push({ name: "acceptEdits", passed: await demoAcceptEdits() });

  // ============================================================================
  // RESULTS SUMMARY
  // ============================================================================

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║                        DEMO RESULTS                              ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`  ⏱️  Duration: ${duration} seconds`);
  console.log(`  📊 Total Permission Events: ${permissionEvents.length}`);
  console.log();

  console.log("  DEMO RESULTS:");
  console.log("  " + "─".repeat(40));
  for (const r of results) {
    console.log(`  ${r.passed ? "✅" : "❌"} ${r.name}`);
  }
  console.log();

  console.log("  PERMISSION EVENT SUMMARY:");
  console.log("  " + "─".repeat(40));

  const byMode = permissionEvents.reduce((acc, e) => {
    if (!acc[e.mode]) acc[e.mode] = { allowed: 0, denied: 0 };
    acc[e.mode][e.decision === "allowed" ? "allowed" : "denied"]++;
    return acc;
  }, {} as Record<string, { allowed: number; denied: number }>);

  for (const [mode, counts] of Object.entries(byMode)) {
    console.log(`  ${mode}: ${counts.allowed} allowed, ${counts.denied} denied`);
  }
  console.log();

  // ============================================================================
  // KEY TAKEAWAYS
  // ============================================================================

  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║                      KEY TAKEAWAYS                               ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("  Permission Mode Comparison:");
  console.log();
  console.log("  ┌──────────────────┬───────────────┬────────────────────────────┐");
  console.log("  │ Mode             │ Autonomy      │ Use Case                   │");
  console.log("  ├──────────────────┼───────────────┼────────────────────────────┤");
  console.log("  │ default          │ Low           │ Interactive workflows      │");
  console.log("  │ acceptEdits      │ Medium        │ Trusted file operations    │");
  console.log("  │ bypassPermissions│ HIGH          │ CI/CD, proactive agents    │");
  console.log("  │ plan             │ Read-only     │ Safe exploration           │");
  console.log("  └──────────────────┴───────────────┴────────────────────────────┘");
  console.log();
  console.log("  Configuration examples:");
  console.log("  ```typescript");
  console.log('  // Full autonomy (proactive agents)');
  console.log('  permissionMode: "bypassPermissions"');
  console.log();
  console.log('  // Block specific tools with hooks');
  console.log('  permissionMode: "bypassPermissions",');
  console.log("  hooks: {");
  console.log('    PreToolUse: [{ matcher: "Bash", hooks: [blockHook] }]');
  console.log("  }");
  console.log("  ```");
  console.log();
  console.log("  ⚠️  SECURITY WARNING:");
  console.log("  bypassPermissions grants FULL autonomous access.");
  console.log("  Only use for trusted code in isolated environments!");
  console.log();
}

// Run the demo
runPermissionsDemo().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
