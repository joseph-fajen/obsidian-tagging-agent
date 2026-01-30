/**
 * DEMO: Hooks
 *
 * Demonstrates the lifecycle hooks that let you intercept agent behavior.
 *
 * Key concepts:
 * - PreToolUse: Fires BEFORE a tool executes (can modify/block)
 * - PostToolUse: Fires AFTER a tool executes (for logging/chaining)
 * - Stop: Fires when the agent session ends
 * - Hooks enable: logging, validation, blocking, notifications
 *
 * Run: bun run demo-hooks.ts
 */

import {
  query,
  type HookCallback,
  type PreToolUseHookInput,
  type PostToolUseHookInput,
  type StopHookInput,
} from "@anthropic-ai/claude-agent-sdk";

// ============================================================================
// DEMO CONFIGURATION
// ============================================================================

console.log("\n");
console.log("╔══════════════════════════════════════════════════════════════════╗");
console.log("║            CLAUDE AGENT SDK - HOOKS DEMONSTRATION                ║");
console.log("╚══════════════════════════════════════════════════════════════════╝");
console.log();

// Track all hook events for visibility
interface HookEvent {
  type: string;
  tool?: string;
  timestamp: Date;
  details: any;
}
const hookEvents: HookEvent[] = [];

// ============================================================================
// HOOK DEFINITIONS
// ============================================================================

/**
 * PreToolUse Hook - Fires BEFORE each tool execution
 * Use cases: logging, input validation, permission checks, modifying inputs
 */
const preToolUseHook: HookCallback = async (input, toolUseId, { signal }) => {
  if (input.hook_event_name === "PreToolUse") {
    const preInput = input as PreToolUseHookInput;

    const event: HookEvent = {
      type: "PreToolUse",
      tool: preInput.tool_name,
      timestamp: new Date(),
      details: {
        cwd: preInput.cwd,
        toolInput: preInput.tool_input ? JSON.stringify(preInput.tool_input).substring(0, 100) : "N/A",
      },
    };
    hookEvents.push(event);

    // Visual output for demo
    console.log();
    console.log("┌" + "─".repeat(58) + "┐");
    console.log(`│ 🔵 PRE-TOOL HOOK: ${preInput.tool_name.padEnd(39)}│`);
    console.log("└" + "─".repeat(58) + "┘");
    console.log(`   Tool ID: ${toolUseId}`);
    console.log(`   Time: ${event.timestamp.toISOString()}`);
    if (preInput.tool_input) {
      const inputPreview = JSON.stringify(preInput.tool_input).substring(0, 80);
      console.log(`   Input: ${inputPreview}...`);
    }
  }

  // Return empty object to allow execution to continue
  return {};
};

/**
 * PostToolUse Hook - Fires AFTER each tool execution
 * Use cases: logging results, triggering follow-up actions, metrics
 */
const postToolUseHook: HookCallback = async (input, toolUseId, { signal }) => {
  if (input.hook_event_name === "PostToolUse") {
    const postInput = input as PostToolUseHookInput;

    const event: HookEvent = {
      type: "PostToolUse",
      tool: postInput.tool_name,
      timestamp: new Date(),
      details: {
        hasResponse: !!postInput.tool_response,
        responsePreview: postInput.tool_response
          ? JSON.stringify(postInput.tool_response).substring(0, 100)
          : "N/A",
      },
    };
    hookEvents.push(event);

    // Visual output for demo
    console.log();
    console.log("┌" + "─".repeat(58) + "┐");
    console.log(`│ 🟢 POST-TOOL HOOK: ${postInput.tool_name.padEnd(38)}│`);
    console.log("└" + "─".repeat(58) + "┘");
    console.log(`   Tool ID: ${toolUseId}`);
    console.log(`   Has Response: ${!!postInput.tool_response}`);
    if (postInput.tool_response) {
      const responseStr = JSON.stringify(postInput.tool_response);
      console.log(`   Response Preview: ${responseStr.substring(0, 60)}...`);
    }
  }

  return {};
};

/**
 * Stop Hook - Fires when the agent session ends
 * Use cases: cleanup, notifications, saving state, final logging
 */
const stopHook: HookCallback = async (input, toolUseId, { signal }) => {
  if (input.hook_event_name === "Stop") {
    const stopInput = input as StopHookInput;

    const event: HookEvent = {
      type: "Stop",
      timestamp: new Date(),
      details: {
        reason: stopInput.stop_reason,
      },
    };
    hookEvents.push(event);

    // Visual output for demo
    console.log();
    console.log("┌" + "─".repeat(58) + "┐");
    console.log(`│ 🔴 STOP HOOK FIRED                                       │`);
    console.log("└" + "─".repeat(58) + "┘");
    console.log(`   Reason: ${stopInput.stop_reason}`);
    console.log(`   Time: ${event.timestamp.toISOString()}`);
  }

  return {};
};

/**
 * Blocking Hook Example - Can prevent tool execution
 * This hook blocks any Bash commands containing "rm" (safety demo)
 */
const safetyHook: HookCallback = async (input, toolUseId, { signal }) => {
  if (input.hook_event_name === "PreToolUse") {
    const preInput = input as PreToolUseHookInput;

    // Example: Block dangerous Bash commands
    if (preInput.tool_name === "Bash") {
      const command = (preInput.tool_input as any)?.command || "";
      if (command.includes("rm ") || command.includes("rm -")) {
        console.log();
        console.log("┌" + "─".repeat(58) + "┐");
        console.log(`│ ⛔ HOOK BLOCKED: Dangerous Bash command                   │`);
        console.log("└" + "─".repeat(58) + "┘");
        console.log(`   Blocked command: ${command.substring(0, 50)}`);

        hookEvents.push({
          type: "Blocked",
          tool: "Bash",
          timestamp: new Date(),
          details: { command, reason: "rm command blocked by policy" },
        });

        // Return deny decision to block the tool
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny" as const,
            permissionDecisionReason: "rm commands are blocked by security policy",
          },
        };
      }
    }
  }
  return {};
};

// ============================================================================
// DISPLAY HOOK CONFIGURATION
// ============================================================================

console.log("HOOKS CONFIGURED:");
console.log("─".repeat(60));
console.log();
console.log("  1. 🔵 PreToolUse Hook");
console.log("     - Fires BEFORE each tool executes");
console.log("     - Logs tool name, input, and timestamp");
console.log("     - Can modify inputs or block execution");
console.log();
console.log("  2. 🟢 PostToolUse Hook");
console.log("     - Fires AFTER each tool completes");
console.log("     - Logs results and can trigger follow-up actions");
console.log();
console.log("  3. 🔴 Stop Hook");
console.log("     - Fires when the agent session ends");
console.log("     - Used for cleanup and notifications");
console.log();
console.log("  4. ⛔ Safety Hook (Bash matcher)");
console.log("     - Only runs on Bash tool");
console.log("     - Blocks any command containing 'rm'");
console.log();
console.log("─".repeat(60));

// ============================================================================
// RUN THE DEMO
// ============================================================================

async function runHooksDemo() {
  console.log("\n🚀 STARTING HOOKS DEMONSTRATION\n");
  console.log("Watch as hooks fire at each lifecycle point...\n");

  const startTime = Date.now();
  let finalResult = "";
  let totalCost = 0;

  try {
    for await (const message of query({
      prompt: `Please do these tasks to demonstrate the hook lifecycle:

1. Use Glob to find TypeScript files in the current directory
2. Use Read to read the package.json file
3. Then provide a 2-sentence summary of what you found

This will trigger PreToolUse and PostToolUse hooks for each tool.`,
      options: {
        allowedTools: ["Glob", "Read", "Bash"],
        permissionMode: "bypassPermissions",
        maxTurns: 8,
        maxBudgetUsd: 0.30,

        // Hook configuration
        hooks: {
          // PreToolUse runs for all tools
          PreToolUse: [
            { hooks: [preToolUseHook] },
            // Safety hook only matches Bash
            { matcher: "Bash", hooks: [safetyHook] },
          ],
          // PostToolUse runs for all tools
          PostToolUse: [{ hooks: [postToolUseHook] }],
          // Stop runs when session ends
          Stop: [{ hooks: [stopHook] }],
        },

        systemPrompt: "You are a helpful assistant demonstrating the hooks lifecycle. Execute tools to trigger the hooks.",
      },
    })) {
      // Track session info
      if (message.type === "system" && "subtype" in message && message.subtype === "init") {
        console.log(`📍 Session ID: ${message.session_id}`);
        console.log();
      }

      // Capture final output
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block && block.text.length > 50) {
            finalResult = block.text;
          }
        }
      }

      // Capture result
      if (message.type === "result") {
        if (message.subtype === "success") {
          finalResult = message.result || finalResult;
          totalCost = message.total_cost_usd || 0;
          console.log(`\n✅ Completed successfully`);
        } else {
          console.log(`\n❌ Ended: ${message.subtype}`);
        }
      }
    }
  } catch (error) {
    console.error("\n❌ Demo failed:", error);
    process.exit(1);
  }

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
  console.log(`  💰 Total Cost: $${totalCost.toFixed(4)}`);
  console.log(`  📊 Total Hook Events: ${hookEvents.length}`);
  console.log();

  // Summarize hook events by type
  const preCount = hookEvents.filter(e => e.type === "PreToolUse").length;
  const postCount = hookEvents.filter(e => e.type === "PostToolUse").length;
  const stopCount = hookEvents.filter(e => e.type === "Stop").length;
  const blockedCount = hookEvents.filter(e => e.type === "Blocked").length;

  console.log("  HOOK EVENT SUMMARY:");
  console.log("  " + "─".repeat(40));
  console.log(`  🔵 PreToolUse events:  ${preCount}`);
  console.log(`  🟢 PostToolUse events: ${postCount}`);
  console.log(`  🔴 Stop events:        ${stopCount}`);
  console.log(`  ⛔ Blocked events:     ${blockedCount}`);
  console.log();

  console.log("  DETAILED HOOK TIMELINE:");
  console.log("  " + "─".repeat(56));
  for (const event of hookEvents) {
    const timeStr = event.timestamp.toISOString().split("T")[1].split(".")[0];
    const toolStr = event.tool ? ` (${event.tool})` : "";
    console.log(`  ${timeStr} | ${event.type}${toolStr}`);
  }
  console.log();

  console.log("─".repeat(60));
  console.log("FINAL OUTPUT:");
  console.log("─".repeat(60));
  console.log(finalResult || "(No final output captured)");
  console.log();

  // ============================================================================
  // KEY TAKEAWAYS
  // ============================================================================

  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║                      KEY TAKEAWAYS                               ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("  1. Hooks intercept agent behavior at key lifecycle points");
  console.log("  2. PreToolUse fires BEFORE tool execution (can block/modify)");
  console.log("  3. PostToolUse fires AFTER tool execution (for logging)");
  console.log("  4. Stop fires when the session ends (cleanup)");
  console.log("  5. Use `matcher` to target specific tools (e.g., 'Bash')");
  console.log();
  console.log("  Configuration used:");
  console.log("  ```typescript");
  console.log("  hooks: {");
  console.log("    PreToolUse: [");
  console.log("      { hooks: [loggingHook] },");
  console.log('      { matcher: "Bash", hooks: [safetyHook] }');
  console.log("    ],");
  console.log("    PostToolUse: [{ hooks: [auditHook] }],");
  console.log("    Stop: [{ hooks: [cleanupHook] }]");
  console.log("  }");
  console.log("  ```");
  console.log();
  console.log("  Available hook events:");
  console.log("  - PreToolUse, PostToolUse, PostToolUseFailure");
  console.log("  - SessionStart, SessionEnd, Stop");
  console.log("  - SubagentStart, SubagentStop");
  console.log("  - Notification, PermissionRequest");
  console.log();
}

// Run the demo
runHooksDemo().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
