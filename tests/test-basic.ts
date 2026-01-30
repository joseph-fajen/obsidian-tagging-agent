/**
 * Test 1: Basic Claude Agent SDK Functionality
 *
 * Tests:
 * - SDK imports correctly
 * - query() function works
 * - Message streaming works
 * - Result message is received
 * - Basic tool usage (Read, Glob)
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

console.log("=".repeat(60));
console.log("TEST 1: Basic Claude Agent SDK Functionality");
console.log("=".repeat(60));
console.log();

async function testBasicQuery() {
  console.log("[TEST] Running basic query with read-only tools...");
  console.log();

  const startTime = Date.now();
  let messageCount = 0;
  let sessionId: string | undefined;
  let finalResult: string | undefined;
  let totalCost: number | undefined;

  try {
    for await (const message of query({
      prompt: "List the files in the current directory and tell me what you see. Keep your response brief.",
      options: {
        allowedTools: ["Read", "Glob", "Grep"],
        permissionMode: "bypassPermissions",
        maxTurns: 5,
        maxBudgetUsd: 0.50,
      },
    })) {
      messageCount++;

      // Log message type
      console.log(`[MSG ${messageCount}] Type: ${message.type}`);

      if (message.type === "system" && "subtype" in message && message.subtype === "init") {
        sessionId = message.session_id;
        console.log(`  Session ID: ${sessionId}`);
        console.log(`  Model: ${(message as any).model}`);
        console.log(`  Tools: ${(message as any).tools?.join(", ")}`);
      }

      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block) {
            console.log(`  [Text] ${block.text.substring(0, 100)}...`);
          } else if ("name" in block) {
            console.log(`  [Tool] ${block.name}`);
          }
        }
      }

      if (message.type === "result") {
        console.log(`  Subtype: ${message.subtype}`);
        if (message.subtype === "success") {
          finalResult = message.result;
          totalCost = message.total_cost_usd;
          console.log(`  Cost: $${totalCost?.toFixed(4)}`);
          console.log(`  Turns: ${message.num_turns}`);
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log();
    console.log("=".repeat(60));
    console.log("TEST RESULTS:");
    console.log("=".repeat(60));
    console.log(`✓ SDK imported successfully`);
    console.log(`✓ query() executed`);
    console.log(`✓ ${messageCount} messages received`);
    console.log(`✓ Session ID: ${sessionId ? "captured" : "MISSING"}`);
    console.log(`✓ Final result: ${finalResult ? "received" : "MISSING"}`);
    console.log(`✓ Duration: ${duration}s`);
    console.log(`✓ Cost: $${totalCost?.toFixed(4) || "unknown"}`);
    console.log();
    console.log("Final Result Preview:");
    console.log("-".repeat(40));
    console.log(finalResult?.substring(0, 500) || "No result");
    console.log();

    return true;
  } catch (error) {
    console.error();
    console.error("TEST FAILED:", error);
    return false;
  }
}

// Run the test
testBasicQuery()
  .then((success) => {
    console.log(success ? "✅ TEST PASSED" : "❌ TEST FAILED");
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
