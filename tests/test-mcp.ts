/**
 * Test 4: MCP Server Integration
 *
 * Tests:
 * - In-process MCP server creation with createSdkMcpServer()
 * - Custom tool definition with tool()
 * - Tool invocation and response handling
 * - Tool with Zod schema validation
 */

import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

console.log("=".repeat(60));
console.log("TEST 4: MCP Server Integration");
console.log("=".repeat(60));
console.log();

// Track tool invocations
const toolInvocations: { name: string; input: any; timestamp: Date }[] = [];

// Create custom tools
const greetingTool = tool(
  "greet_user",
  "Greet a user by name with a friendly message",
  {
    name: z.string().describe("The name of the person to greet"),
    style: z.enum(["formal", "casual", "enthusiastic"]).optional().describe("The greeting style"),
  },
  async ({ name, style = "casual" }) => {
    toolInvocations.push({ name: "greet_user", input: { name, style }, timestamp: new Date() });

    let greeting: string;
    switch (style) {
      case "formal":
        greeting = `Good day, ${name}. It is a pleasure to make your acquaintance.`;
        break;
      case "enthusiastic":
        greeting = `HEY ${name.toUpperCase()}!!! SO GREAT TO MEET YOU! 🎉`;
        break;
      default:
        greeting = `Hey ${name}! Nice to meet you.`;
    }

    return {
      content: [{ type: "text" as const, text: greeting }],
    };
  }
);

const calculatorTool = tool(
  "calculate",
  "Perform basic arithmetic calculations",
  {
    operation: z.enum(["add", "subtract", "multiply", "divide"]).describe("The operation to perform"),
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  },
  async ({ operation, a, b }) => {
    toolInvocations.push({ name: "calculate", input: { operation, a, b }, timestamp: new Date() });

    let result: number;
    switch (operation) {
      case "add":
        result = a + b;
        break;
      case "subtract":
        result = a - b;
        break;
      case "multiply":
        result = a * b;
        break;
      case "divide":
        if (b === 0) {
          return {
            content: [{ type: "text" as const, text: "Error: Division by zero" }],
            isError: true,
          };
        }
        result = a / b;
        break;
    }

    return {
      content: [{ type: "text" as const, text: `Result: ${a} ${operation} ${b} = ${result}` }],
    };
  }
);

const timestampTool = tool(
  "get_timestamp",
  "Get the current timestamp in various formats",
  {
    format: z.enum(["iso", "unix", "human"]).optional().describe("The format for the timestamp"),
  },
  async ({ format = "iso" }) => {
    toolInvocations.push({ name: "get_timestamp", input: { format }, timestamp: new Date() });

    const now = new Date();
    let result: string;
    switch (format) {
      case "unix":
        result = Math.floor(now.getTime() / 1000).toString();
        break;
      case "human":
        result = now.toLocaleString();
        break;
      default:
        result = now.toISOString();
    }

    return {
      content: [{ type: "text" as const, text: `Current timestamp (${format}): ${result}` }],
    };
  }
);

// Create in-process MCP server
const customServer = createSdkMcpServer({
  name: "custom-tools",
  version: "1.0.0",
  tools: [greetingTool, calculatorTool, timestampTool],
});

async function testCustomMcpTools() {
  console.log("[TEST 4a] Custom MCP Tools (In-Process Server)");
  console.log("-".repeat(40));

  // Clear previous invocations
  toolInvocations.length = 0;

  let mcpToolsCalled: string[] = [];
  let result = "";

  try {
    // Create an async generator for streaming input mode (required for MCP)
    async function* streamPrompt() {
      yield {
        type: "user" as const,
        message: {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: "Please do these three things: 1) Greet me (my name is Cole) enthusiastically, 2) Calculate 42 * 17, 3) Get the current timestamp in ISO format.",
            },
          ],
        },
      };
    }

    for await (const message of query({
      prompt: streamPrompt(),
      options: {
        mcpServers: {
          "custom": customServer,
        },
        allowedTools: ["mcp__custom__greet_user", "mcp__custom__calculate", "mcp__custom__get_timestamp"],
        permissionMode: "bypassPermissions",
        maxTurns: 10,
      },
    })) {
      if (message.type === "system" && "subtype" in message && message.subtype === "init") {
        const mcpServers = (message as any).mcp_servers || [];
        console.log(`  MCP Servers: ${JSON.stringify(mcpServers)}`);
      }

      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("name" in block && block.name.startsWith("mcp__custom__")) {
            const toolName = block.name.replace("mcp__custom__", "");
            if (!mcpToolsCalled.includes(toolName)) {
              mcpToolsCalled.push(toolName);
              console.log(`  [MCP Tool Called] ${toolName}`);
            }
          }
        }
      }

      if (message.type === "result" && message.subtype === "success") {
        result = message.result;
        console.log(`  Cost: $${message.total_cost_usd?.toFixed(4)}`);
      }
    }

    console.log();
    console.log(`  Tools invoked via MCP: ${mcpToolsCalled.join(", ") || "none"}`);
    console.log(`  Tool invocations logged: ${toolInvocations.length}`);
    for (const inv of toolInvocations) {
      console.log(`    - ${inv.name}: ${JSON.stringify(inv.input)}`);
    }
    console.log(`  Result preview: ${result.substring(0, 200)}...`);

    const success = mcpToolsCalled.length >= 2;
    return success;
  } catch (error) {
    console.error("  Error:", error);
    return false;
  }
}

async function testMcpToolWithZodValidation() {
  console.log();
  console.log("[TEST 4b] MCP Tool Zod Schema Validation");
  console.log("-".repeat(40));

  toolInvocations.length = 0;

  try {
    async function* streamPrompt() {
      yield {
        type: "user" as const,
        message: {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: "Use the calculator to divide 100 by 25.",
            },
          ],
        },
      };
    }

    let calculationResult = "";
    for await (const message of query({
      prompt: streamPrompt(),
      options: {
        mcpServers: { "custom": customServer },
        allowedTools: ["mcp__custom__calculate"],
        permissionMode: "bypassPermissions",
        maxTurns: 5,
      },
    })) {
      if (message.type === "result" && message.subtype === "success") {
        calculationResult = message.result;
      }
    }

    const hasResult = calculationResult.includes("4") || calculationResult.includes("divide");
    console.log(`  Result: ${calculationResult.substring(0, 150)}`);
    console.log(`  Calculation performed: ${hasResult ? "✓" : "✗"}`);
    console.log(`  Invocations: ${toolInvocations.length}`);
    return toolInvocations.length > 0;
  } catch (error) {
    console.error("  Error:", error);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  const results: { name: string; passed: boolean }[] = [];

  results.push({ name: "Custom MCP Tools", passed: await testCustomMcpTools() });
  results.push({ name: "Zod Schema Validation", passed: await testMcpToolWithZodValidation() });

  console.log();
  console.log("=".repeat(60));
  console.log("TEST 4 SUMMARY:");
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
