/**
 * DEMO: MCP Servers (Model Context Protocol)
 *
 * Demonstrates how to create custom tools and connect to external systems.
 *
 * Key concepts:
 * - Create in-process MCP servers with custom tools
 * - Define tools using Zod schemas for type safety
 * - Tool naming convention: mcp__<server-name>__<tool-name>
 * - Streaming input mode required for custom MCP tools
 *
 * Run: bun run demo-mcp-servers.ts
 */

import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// ============================================================================
// DEMO CONFIGURATION
// ============================================================================

console.log("\n");
console.log("╔══════════════════════════════════════════════════════════════════╗");
console.log("║         CLAUDE AGENT SDK - MCP SERVERS DEMONSTRATION             ║");
console.log("╚══════════════════════════════════════════════════════════════════╝");
console.log();

// Track tool invocations for demo visibility
const toolInvocations: { tool: string; input: any; output: string; timestamp: Date }[] = [];

// ============================================================================
// CUSTOM TOOL DEFINITIONS
// ============================================================================

/**
 * Weather Tool - Simulates getting weather data
 * In production, this would call a real weather API
 */
const getWeatherTool = tool(
  "get_weather",
  "Get the current weather for a location. Returns temperature, conditions, and humidity.",
  {
    location: z.string().describe("City name (e.g., 'San Francisco')"),
    units: z.enum(["celsius", "fahrenheit"]).optional().describe("Temperature units (default: fahrenheit)"),
  },
  async ({ location, units = "fahrenheit" }) => {
    console.log(`   📡 [MCP] get_weather called for: ${location}`);

    // Simulated weather data (in production, call OpenWeatherMap, etc.)
    const weatherData = {
      location,
      temperature: units === "celsius" ? 18 : 64,
      units,
      conditions: "Partly Cloudy",
      humidity: 65,
      wind: "12 mph NW",
      timestamp: new Date().toISOString(),
    };

    const output = JSON.stringify(weatherData, null, 2);
    toolInvocations.push({ tool: "get_weather", input: { location, units }, output, timestamp: new Date() });

    return {
      content: [{ type: "text" as const, text: output }],
    };
  }
);

/**
 * Database Query Tool - Simulates database access
 * In production, this would connect to Postgres, MongoDB, etc.
 */
const queryDatabaseTool = tool(
  "query_database",
  "Execute a read-only query against the database. Returns results as JSON.",
  {
    query: z.string().describe("SQL-like query (e.g., 'SELECT * FROM users LIMIT 5')"),
    database: z.enum(["users", "products", "orders"]).describe("Which database table to query"),
  },
  async ({ query: queryStr, database }) => {
    console.log(`   📡 [MCP] query_database called: ${database}`);

    // Simulated database results
    const mockData: Record<string, any[]> = {
      users: [
        { id: 1, name: "Alice Johnson", email: "alice@example.com", role: "admin" },
        { id: 2, name: "Bob Smith", email: "bob@example.com", role: "user" },
        { id: 3, name: "Carol White", email: "carol@example.com", role: "user" },
      ],
      products: [
        { id: 101, name: "Widget Pro", price: 29.99, stock: 150 },
        { id: 102, name: "Gadget Plus", price: 49.99, stock: 75 },
      ],
      orders: [
        { id: 1001, user_id: 1, product_id: 101, quantity: 2, status: "shipped" },
        { id: 1002, user_id: 2, product_id: 102, quantity: 1, status: "pending" },
      ],
    };

    const results = {
      database,
      query: queryStr,
      rowCount: mockData[database]?.length || 0,
      rows: mockData[database] || [],
      executionTime: "12ms",
    };

    const output = JSON.stringify(results, null, 2);
    toolInvocations.push({ tool: "query_database", input: { query: queryStr, database }, output, timestamp: new Date() });

    return {
      content: [{ type: "text" as const, text: output }],
    };
  }
);

/**
 * Notification Tool - Simulates sending notifications
 * In production, this would integrate with Slack, email, SMS, etc.
 */
const sendNotificationTool = tool(
  "send_notification",
  "Send a notification through a specified channel.",
  {
    channel: z.enum(["slack", "email", "sms"]).describe("Notification channel"),
    recipient: z.string().describe("Recipient (channel ID, email, or phone)"),
    message: z.string().describe("The notification message"),
    priority: z.enum(["low", "normal", "high"]).optional().describe("Message priority"),
  },
  async ({ channel, recipient, message, priority = "normal" }) => {
    console.log(`   📡 [MCP] send_notification via ${channel}`);

    // Simulated notification
    const notification = {
      status: "sent",
      channel,
      recipient,
      message,
      priority,
      messageId: `msg_${Date.now()}`,
      sentAt: new Date().toISOString(),
    };

    const output = JSON.stringify(notification, null, 2);
    toolInvocations.push({ tool: "send_notification", input: { channel, recipient, message }, output, timestamp: new Date() });

    return {
      content: [{ type: "text" as const, text: `Notification sent successfully!\n${output}` }],
    };
  }
);

// ============================================================================
// CREATE MCP SERVER
// ============================================================================

const customServer = createSdkMcpServer({
  name: "demo-tools",
  version: "1.0.0",
  tools: [getWeatherTool, queryDatabaseTool, sendNotificationTool],
});

console.log("MCP SERVER CONFIGURATION:");
console.log("─".repeat(60));
console.log();
console.log("  Server Name: demo-tools");
console.log("  Available Tools:");
console.log();
console.log("  1. 🌤️  get_weather");
console.log("     - Get weather for any location");
console.log("     - Params: location (string), units (celsius|fahrenheit)");
console.log();
console.log("  2. 🗄️  query_database");
console.log("     - Query mock database tables");
console.log("     - Params: query (string), database (users|products|orders)");
console.log();
console.log("  3. 📬 send_notification");
console.log("     - Send notifications via various channels");
console.log("     - Params: channel, recipient, message, priority");
console.log();
console.log("  Tool Naming Convention: mcp__<server>__<tool>");
console.log("  Example: mcp__demo-tools__get_weather");
console.log();
console.log("─".repeat(60));

// ============================================================================
// RUN THE DEMO
// ============================================================================

async function runMcpDemo() {
  console.log("\n🚀 STARTING MCP TOOLS DEMONSTRATION\n");

  const startTime = Date.now();
  let finalResult = "";
  let totalCost = 0;
  const toolsUsed: string[] = [];

  // Create streaming input (required for custom MCP tools)
  async function* streamPrompt() {
    yield {
      type: "user" as const,
      message: {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: `Please demonstrate all three custom tools:

1. First, check the weather in San Francisco using celsius units
2. Then, query the users database to see who's registered
3. Finally, send a slack notification to #general with a summary

After using all three tools, provide a brief summary of what each tool returned.`,
          },
        ],
      },
    };
  }

  try {
    for await (const message of query({
      prompt: streamPrompt(),  // Must use streaming for MCP tools
      options: {
        // MCP server configuration
        mcpServers: {
          "demo-tools": customServer,
        },

        // Allow all custom tools (note the naming convention)
        allowedTools: [
          "mcp__demo-tools__get_weather",
          "mcp__demo-tools__query_database",
          "mcp__demo-tools__send_notification",
        ],

        permissionMode: "bypassPermissions",
        maxTurns: 10,
        maxBudgetUsd: 0.50,

        systemPrompt: "You are a helpful assistant demonstrating MCP tool integration. Use each tool exactly once and explain what you're doing.",
      },
    })) {
      // Track initialization
      if (message.type === "system" && "subtype" in message && message.subtype === "init") {
        console.log(`📍 Session ID: ${message.session_id}`);
        const mcpServers = (message as any).mcp_servers;
        if (mcpServers) {
          console.log(`📍 MCP Servers: ${JSON.stringify(mcpServers)}`);
        }
        console.log();
      }

      // Track tool usage and responses
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("name" in block && block.name.startsWith("mcp__")) {
            const toolName = block.name.replace("mcp__demo-tools__", "");
            if (!toolsUsed.includes(toolName)) {
              toolsUsed.push(toolName);
            }
            console.log();
            console.log("┌" + "─".repeat(58) + "┐");
            console.log(`│ 🔧 MCP TOOL CALLED: ${toolName.padEnd(37)}│`);
            console.log("└" + "─".repeat(58) + "┘");
            console.log(`   Input: ${JSON.stringify(block.input)}`);
          } else if ("text" in block && block.text.length > 20) {
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
  console.log(`  🔧 Tools Used: ${toolsUsed.length}/3`);
  console.log();

  console.log("  TOOL INVOCATION LOG:");
  console.log("  " + "─".repeat(56));
  for (const inv of toolInvocations) {
    console.log(`  ${inv.tool}:`);
    console.log(`     Input: ${JSON.stringify(inv.input)}`);
    console.log(`     Time: ${inv.timestamp.toISOString()}`);
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
  console.log("  1. MCP servers connect Claude to external systems");
  console.log("  2. Use `tool()` and `createSdkMcpServer()` for in-process tools");
  console.log("  3. Zod schemas validate tool inputs automatically");
  console.log("  4. Tool names: mcp__<server-name>__<tool-name>");
  console.log("  5. IMPORTANT: Custom MCP tools require streaming input mode");
  console.log();
  console.log("  Configuration used:");
  console.log("  ```typescript");
  console.log("  mcpServers: {");
  console.log('    "demo-tools": createSdkMcpServer({');
  console.log('      name: "demo-tools",');
  console.log("      tools: [getWeatherTool, queryDatabaseTool, sendNotificationTool]");
  console.log("    })");
  console.log("  }");
  console.log("  ```");
  console.log();
  console.log("  Other MCP connection types:");
  console.log('  - Local process: { command: "npx", args: ["@playwright/mcp"] }');
  console.log('  - HTTP: { type: "http", url: "https://api.example.com/mcp" }');
  console.log('  - SSE: { type: "sse", url: "https://api.example.com/sse" }');
  console.log();
}

// Run the demo
runMcpDemo().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
