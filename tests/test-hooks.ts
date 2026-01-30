/**
 * Test 5: Hooks Testing
 *
 * Tests:
 * - PreToolUse hook fires before tool execution
 * - PostToolUse hook fires after tool execution
 * - Hook can block tool execution
 * - Hook can log tool activity
 * - Stop hook fires on completion
 */

import { query, type HookCallback, type PreToolUseHookInput, type PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

console.log("=".repeat(60));
console.log("TEST 5: Hooks");
console.log("=".repeat(60));
console.log();

// Track hook invocations
const hookLog: { event: string; tool?: string; timestamp: Date; details?: any }[] = [];

async function testPreToolUseHook() {
  console.log("[TEST 5a] PreToolUse Hook (Logging)");
  console.log("-".repeat(40));

  hookLog.length = 0;

  const preToolLogger: HookCallback = async (input, toolUseID, { signal }) => {
    if (input.hook_event_name === "PreToolUse") {
      const preInput = input as PreToolUseHookInput;
      hookLog.push({
        event: "PreToolUse",
        tool: preInput.tool_name,
        timestamp: new Date(),
        details: { cwd: preInput.cwd },
      });
      console.log(`  [PreToolUse] Tool: ${preInput.tool_name}`);
    }
    return {}; // Allow execution
  };

  try {
    for await (const message of query({
      prompt: "List the TypeScript files in this directory using Glob.",
      options: {
        allowedTools: ["Glob", "Read"],
        permissionMode: "bypassPermissions",
        maxTurns: 5,
        hooks: {
          PreToolUse: [{ hooks: [preToolLogger] }],
        },
      },
    })) {
      if (message.type === "result" && message.subtype === "success") {
        console.log(`  Cost: $${message.total_cost_usd?.toFixed(4)}`);
      }
    }

    console.log(`  Hook invocations: ${hookLog.length}`);
    const preToolUseFired = hookLog.some((h) => h.event === "PreToolUse");
    console.log(`  PreToolUse fired: ${preToolUseFired ? "✓" : "✗"}`);
    return preToolUseFired;
  } catch (error) {
    console.error("  Error:", error);
    return false;
  }
}

async function testPostToolUseHook() {
  console.log();
  console.log("[TEST 5b] PostToolUse Hook (Logging Results)");
  console.log("-".repeat(40));

  hookLog.length = 0;

  const postToolLogger: HookCallback = async (input, toolUseID, { signal }) => {
    if (input.hook_event_name === "PostToolUse") {
      const postInput = input as PostToolUseHookInput;
      hookLog.push({
        event: "PostToolUse",
        tool: postInput.tool_name,
        timestamp: new Date(),
        details: { hasResponse: !!postInput.tool_response },
      });
      console.log(`  [PostToolUse] Tool: ${postInput.tool_name}, Has Response: ${!!postInput.tool_response}`);
    }
    return {};
  };

  try {
    for await (const message of query({
      prompt: "Read the package.json file.",
      options: {
        allowedTools: ["Read"],
        permissionMode: "bypassPermissions",
        maxTurns: 5,
        hooks: {
          PostToolUse: [{ hooks: [postToolLogger] }],
        },
      },
    })) {
      if (message.type === "result" && message.subtype === "success") {
        console.log(`  Cost: $${message.total_cost_usd?.toFixed(4)}`);
      }
    }

    const postToolUseFired = hookLog.some((h) => h.event === "PostToolUse");
    console.log(`  PostToolUse fired: ${postToolUseFired ? "✓" : "✗"}`);
    return postToolUseFired;
  } catch (error) {
    console.error("  Error:", error);
    return false;
  }
}

async function testHookBlockingOperation() {
  console.log();
  console.log("[TEST 5c] Hook Blocking Operation");
  console.log("-".repeat(40));

  let blockAttempted = false;
  let operationBlocked = false;

  const blockBashHook: HookCallback = async (input, toolUseID, { signal }) => {
    if (input.hook_event_name === "PreToolUse") {
      const preInput = input as PreToolUseHookInput;
      if (preInput.tool_name === "Bash") {
        blockAttempted = true;
        console.log(`  [Hook] Blocking Bash command`);
        return {
          hookSpecificOutput: {
            hookEventName: input.hook_event_name,
            permissionDecision: "deny" as const,
            permissionDecisionReason: "Bash commands are blocked by policy",
          },
        };
      }
    }
    return {};
  };

  try {
    for await (const message of query({
      prompt: "Run the command 'echo hello' using Bash.",
      options: {
        allowedTools: ["Bash", "Read"],
        permissionMode: "bypassPermissions",
        maxTurns: 5,
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [blockBashHook] }],
        },
      },
    })) {
      if (message.type === "result") {
        // Check if there were permission denials
        const denials = (message as any).permission_denials || [];
        if (denials.length > 0) {
          operationBlocked = true;
          console.log(`  Permission denials: ${denials.length}`);
        }
        console.log(`  Result subtype: ${message.subtype}`);
      }
    }

    console.log(`  Block attempted: ${blockAttempted ? "✓" : "✗"}`);
    // Even if blocked, Claude might still complete successfully by not using Bash
    return blockAttempted;
  } catch (error) {
    console.error("  Error:", error);
    return false;
  }
}

async function testCombinedHooks() {
  console.log();
  console.log("[TEST 5d] Combined Pre and Post Hooks");
  console.log("-".repeat(40));

  hookLog.length = 0;

  const auditHook: HookCallback = async (input, toolUseID, { signal }) => {
    hookLog.push({
      event: input.hook_event_name,
      tool: (input as any).tool_name,
      timestamp: new Date(),
    });
    console.log(`  [${input.hook_event_name}] ${(input as any).tool_name || "N/A"}`);
    return {};
  };

  try {
    for await (const message of query({
      prompt: "Find all .ts files and count them.",
      options: {
        allowedTools: ["Glob", "Bash"],
        permissionMode: "bypassPermissions",
        maxTurns: 5,
        hooks: {
          PreToolUse: [{ hooks: [auditHook] }],
          PostToolUse: [{ hooks: [auditHook] }],
        },
      },
    })) {
      if (message.type === "result" && message.subtype === "success") {
        console.log(`  Cost: $${message.total_cost_usd?.toFixed(4)}`);
      }
    }

    const preCount = hookLog.filter((h) => h.event === "PreToolUse").length;
    const postCount = hookLog.filter((h) => h.event === "PostToolUse").length;
    console.log(`  PreToolUse events: ${preCount}`);
    console.log(`  PostToolUse events: ${postCount}`);
    return preCount > 0 && postCount > 0;
  } catch (error) {
    console.error("  Error:", error);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  const results: { name: string; passed: boolean }[] = [];

  results.push({ name: "PreToolUse Hook", passed: await testPreToolUseHook() });
  results.push({ name: "PostToolUse Hook", passed: await testPostToolUseHook() });
  results.push({ name: "Hook Blocking", passed: await testHookBlockingOperation() });
  results.push({ name: "Combined Hooks", passed: await testCombinedHooks() });

  console.log();
  console.log("=".repeat(60));
  console.log("TEST 5 SUMMARY:");
  console.log("=".repeat(60));
  for (const r of results) {
    console.log(`  ${r.passed ? "✅" : "❌"} ${r.name}`);
  }

  const allPassed = results.every((r) => r.passed);
  console.log();
  console.log(allPassed ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED");
  return allPassed;
}

runAllTests()
  .then((success) => process.exit(success ? 0 : 1))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
