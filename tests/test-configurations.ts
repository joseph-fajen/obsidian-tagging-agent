/**
 * Test 2: Configuration Options Testing
 *
 * Tests:
 * - allowedTools restrictions
 * - Custom system prompts
 * - Model selection (Opus 4.5)
 * - maxTurns limit
 * - maxBudgetUsd limit
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

console.log("=".repeat(60));
console.log("TEST 2: Configuration Options");
console.log("=".repeat(60));
console.log();

async function testCustomSystemPrompt() {
  console.log("[TEST 2a] Custom System Prompt");
  console.log("-".repeat(40));

  try {
    let result = "";
    for await (const message of query({
      prompt: "What is your name and role?",
      options: {
        allowedTools: [],  // No tools - just conversation
        permissionMode: "bypassPermissions",
        maxTurns: 1,
        systemPrompt: "You are a helpful research assistant named ResearchBot. You always introduce yourself by name.",
      },
    })) {
      if (message.type === "result" && message.subtype === "success") {
        result = message.result;
      }
    }

    const hasResearchBot = result.toLowerCase().includes("researchbot");
    console.log(`  Result: ${result.substring(0, 200)}...`);
    console.log(`  Contains 'ResearchBot': ${hasResearchBot ? "✓" : "✗"}`);
    return hasResearchBot;
  } catch (error) {
    console.error("  Error:", error);
    return false;
  }
}

async function testModelSelection() {
  console.log();
  console.log("[TEST 2b] Model Selection (Opus 4.5)");
  console.log("-".repeat(40));

  try {
    let modelUsed = "";
    for await (const message of query({
      prompt: "Say hello briefly.",
      options: {
        allowedTools: [],
        permissionMode: "bypassPermissions",
        maxTurns: 1,
        model: "claude-opus-4-5-20251101",  // Opus 4.5
      },
    })) {
      if (message.type === "system" && "subtype" in message && message.subtype === "init") {
        modelUsed = (message as any).model || "";
        console.log(`  Model in init message: ${modelUsed}`);
      }
      if (message.type === "result" && message.subtype === "success") {
        console.log(`  Result: ${message.result.substring(0, 100)}`);
        console.log(`  Cost: $${message.total_cost_usd?.toFixed(4)}`);
      }
    }

    const isOpus = modelUsed.includes("opus");
    console.log(`  Verified Opus model: ${isOpus ? "✓" : "✗"}`);
    return isOpus;
  } catch (error) {
    console.error("  Error:", error);
    return false;
  }
}

async function testMaxTurnsLimit() {
  console.log();
  console.log("[TEST 2c] maxTurns Limit");
  console.log("-".repeat(40));

  try {
    let turns = 0;
    let resultSubtype = "";
    for await (const message of query({
      prompt: "Count from 1 to 100, one number at a time, using separate tool calls.",
      options: {
        allowedTools: ["Bash"],
        permissionMode: "bypassPermissions",
        maxTurns: 2,  // Very low limit
      },
    })) {
      if (message.type === "result") {
        turns = (message as any).num_turns || 0;
        resultSubtype = message.subtype;
        console.log(`  Result subtype: ${resultSubtype}`);
        console.log(`  Turns used: ${turns}`);
      }
    }

    // Should hit the limit or complete within limit
    const limitRespected = turns <= 2;
    console.log(`  maxTurns respected: ${limitRespected ? "✓" : "✗"}`);
    return limitRespected;
  } catch (error) {
    console.error("  Error:", error);
    return false;
  }
}

async function testWebSearchTool() {
  console.log();
  console.log("[TEST 2d] WebSearch Tool");
  console.log("-".repeat(40));

  try {
    let usedWebSearch = false;
    let result = "";
    for await (const message of query({
      prompt: "Search the web for 'Claude Agent SDK Anthropic' and tell me what you find. Keep it brief.",
      options: {
        allowedTools: ["WebSearch"],
        permissionMode: "bypassPermissions",
        maxTurns: 3,
        maxBudgetUsd: 0.50,
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("name" in block && block.name === "WebSearch") {
            usedWebSearch = true;
            console.log(`  [Tool Used] WebSearch`);
          }
        }
      }
      if (message.type === "result" && message.subtype === "success") {
        result = message.result;
        console.log(`  Result preview: ${result.substring(0, 150)}...`);
      }
    }

    console.log(`  WebSearch tool used: ${usedWebSearch ? "✓" : "✗"}`);
    return usedWebSearch;
  } catch (error) {
    console.error("  Error:", error);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  const results: { name: string; passed: boolean }[] = [];

  results.push({ name: "Custom System Prompt", passed: await testCustomSystemPrompt() });
  results.push({ name: "Model Selection (Opus)", passed: await testModelSelection() });
  results.push({ name: "maxTurns Limit", passed: await testMaxTurnsLimit() });
  results.push({ name: "WebSearch Tool", passed: await testWebSearchTool() });

  console.log();
  console.log("=".repeat(60));
  console.log("TEST 2 SUMMARY:");
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
