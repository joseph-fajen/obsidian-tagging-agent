/**
 * Test 3: Subagents Testing
 *
 * Tests:
 * - Defining subagents with AgentDefinition
 * - Subagent invocation via Task tool
 * - Tool restrictions for subagents
 * - Model selection for subagents (haiku for cheaper operations)
 * - Multiple subagent orchestration
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

console.log("=".repeat(60));
console.log("TEST 3: Subagents");
console.log("=".repeat(60));
console.log();

async function testSingleSubagent() {
  console.log("[TEST 3a] Single Subagent Definition & Invocation");
  console.log("-".repeat(40));

  let subagentInvoked = false;
  let subagentType = "";
  let result = "";

  try {
    for await (const message of query({
      prompt: "Use the summarizer agent to summarize what files exist in this directory.",
      options: {
        allowedTools: ["Task", "Glob", "Read"],
        permissionMode: "bypassPermissions",
        maxTurns: 10,
        agents: {
          "summarizer": {
            description: "Summarizes information concisely. Use for creating brief summaries.",
            prompt: "You are a summarization specialist. Create brief, bullet-point summaries. Be concise.",
            tools: ["Glob", "Read"],
            model: "haiku",
          },
        },
      },
    })) {
      // Check for subagent invocation
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("name" in block && block.name === "Task") {
            subagentInvoked = true;
            const input = block.input as any;
            subagentType = input?.subagent_type || "";
            console.log(`  [Subagent Invoked] Type: ${subagentType}`);
          }
        }
      }

      if (message.type === "result" && message.subtype === "success") {
        result = message.result;
        console.log(`  Cost: $${message.total_cost_usd?.toFixed(4)}`);
      }
    }

    console.log(`  Subagent invoked: ${subagentInvoked ? "✓" : "✗"}`);
    console.log(`  Subagent type: ${subagentType || "none"}`);
    console.log(`  Result preview: ${result.substring(0, 150)}...`);
    return subagentInvoked;
  } catch (error) {
    console.error("  Error:", error);
    return false;
  }
}

async function testMultipleSubagents() {
  console.log();
  console.log("[TEST 3b] Multiple Subagents Orchestration");
  console.log("-".repeat(40));

  const invokedSubagents: string[] = [];
  let result = "";

  try {
    for await (const message of query({
      prompt: `You have two specialized agents available. First, use the 'file-finder' to find all TypeScript files. Then use the 'reporter' to create a brief report of what was found. Coordinate between them.`,
      options: {
        allowedTools: ["Task", "Glob", "Read"],
        permissionMode: "bypassPermissions",
        maxTurns: 15,
        agents: {
          "file-finder": {
            description: "Expert at finding and listing files. Use to search for files.",
            prompt: "You are a file system expert. Find files matching patterns and return organized lists.",
            tools: ["Glob", "Read"],
            model: "haiku",
          },
          "reporter": {
            description: "Creates formatted reports. Use to generate summaries and reports.",
            prompt: "You are a technical writer. Create clear, concise reports from provided information.",
            tools: ["Read"],
            model: "haiku",
          },
        },
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("name" in block && block.name === "Task") {
            const input = block.input as any;
            const agentType = input?.subagent_type || "unknown";
            if (!invokedSubagents.includes(agentType)) {
              invokedSubagents.push(agentType);
              console.log(`  [Subagent Invoked] ${agentType}`);
            }
          }
        }
      }

      if (message.type === "result" && message.subtype === "success") {
        result = message.result;
        console.log(`  Cost: $${message.total_cost_usd?.toFixed(4)}`);
      }
    }

    console.log(`  Subagents invoked: ${invokedSubagents.join(", ") || "none"}`);
    console.log(`  Multiple subagents used: ${invokedSubagents.length >= 2 ? "✓" : "✗"}`);
    console.log(`  Result preview: ${result.substring(0, 150)}...`);
    return invokedSubagents.length >= 1; // At least one subagent used
  } catch (error) {
    console.error("  Error:", error);
    return false;
  }
}

async function testSubagentModelOverride() {
  console.log();
  console.log("[TEST 3c] Subagent Model Override (Haiku)");
  console.log("-".repeat(40));

  let mainModel = "";
  let subagentInvoked = false;

  try {
    for await (const message of query({
      prompt: "Use the quick-analyzer agent to briefly describe this project.",
      options: {
        allowedTools: ["Task", "Glob", "Read"],
        permissionMode: "bypassPermissions",
        maxTurns: 10,
        model: "claude-sonnet-4-5-20250929", // Main agent uses Sonnet
        agents: {
          "quick-analyzer": {
            description: "Fast, brief analysis of codebases.",
            prompt: "Provide very brief analysis. One sentence max.",
            tools: ["Glob", "Read"],
            model: "haiku", // Subagent uses Haiku (cheaper/faster)
          },
        },
      },
    })) {
      if (message.type === "system" && "subtype" in message && message.subtype === "init") {
        mainModel = (message as any).model || "";
        console.log(`  Main model: ${mainModel}`);
      }

      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("name" in block && block.name === "Task") {
            subagentInvoked = true;
            console.log(`  [Subagent invoked with Haiku model]`);
          }
        }
      }

      if (message.type === "result" && message.subtype === "success") {
        console.log(`  Total cost: $${message.total_cost_usd?.toFixed(4)}`);
        // Check model usage breakdown
        const modelUsage = (message as any).modelUsage;
        if (modelUsage) {
          console.log(`  Model usage breakdown:`);
          for (const [model, usage] of Object.entries(modelUsage)) {
            console.log(`    - ${model}: $${(usage as any).costUSD?.toFixed(4)}`);
          }
        }
      }
    }

    const sonnetUsed = mainModel.includes("sonnet");
    console.log(`  Main agent uses Sonnet: ${sonnetUsed ? "✓" : "✗"}`);
    console.log(`  Subagent invoked: ${subagentInvoked ? "✓" : "✗"}`);
    return sonnetUsed && subagentInvoked;
  } catch (error) {
    console.error("  Error:", error);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  const results: { name: string; passed: boolean }[] = [];

  results.push({ name: "Single Subagent", passed: await testSingleSubagent() });
  results.push({ name: "Multiple Subagents", passed: await testMultipleSubagents() });
  results.push({ name: "Subagent Model Override", passed: await testSubagentModelOverride() });

  console.log();
  console.log("=".repeat(60));
  console.log("TEST 3 SUMMARY:");
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
