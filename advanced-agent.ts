/**
 * Advanced Proactive Agent
 *
 * Demonstrates advanced Claude Agent SDK features:
 * - Custom subagents for specialized tasks
 * - MCP server integration
 * - Hooks for logging and notifications
 * - Session management
 *
 * Usage:
 *   bun run advanced-agent.ts
 */

import {
  query,
  createSdkMcpServer,
  tool,
  type HookCallback,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { appendFile } from "fs/promises";

// ============================================================================
// CUSTOM MCP TOOLS
// ============================================================================

/**
 * Example: Custom tool to log events to a file
 * In production, this could send to a database, webhook, etc.
 */
const logEventTool = tool(
  "log_event",
  "Log an event with timestamp for audit trail",
  {
    event_type: z.string().describe("Type of event (e.g., 'research_started', 'finding')"),
    message: z.string().describe("Event description"),
    metadata: z.string().optional().describe("Additional JSON metadata"),
  },
  async ({ event_type, message, metadata }) => {
    const timestamp = new Date().toISOString();
    const logLine = JSON.stringify({ timestamp, event_type, message, metadata }) + "\n";

    await appendFile("./agent-events.log", logLine);

    return {
      content: [{ type: "text" as const, text: `Event logged: ${event_type}` }],
    };
  }
);

/**
 * Example: Custom tool to check a condition
 * Could be used for monitoring, alerting, etc.
 */
const checkThresholdTool = tool(
  "check_threshold",
  "Check if a numeric value exceeds a threshold",
  {
    value: z.number().describe("The value to check"),
    threshold: z.number().describe("The threshold to compare against"),
    metric_name: z.string().describe("Name of the metric being checked"),
  },
  async ({ value, threshold, metric_name }) => {
    const exceeded = value > threshold;
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            metric: metric_name,
            value,
            threshold,
            exceeded,
            status: exceeded ? "ALERT" : "OK",
          }),
        },
      ],
    };
  }
);

// Create in-process MCP server with custom tools
const customServer = createSdkMcpServer({
  name: "custom-tools",
  version: "1.0.0",
  tools: [logEventTool, checkThresholdTool],
});

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook: Log all tool usage to console
 */
const toolLogger: HookCallback = async (input) => {
  if ("tool_name" in input) {
    console.log(`[Hook] Tool called: ${input.tool_name}`);
  }
  return {}; // Continue execution
};

/**
 * Hook: Log session end
 */
const sessionEndLogger: HookCallback = async (input) => {
  if ("reason" in input) {
    console.log(`[Hook] Session ended: ${input.reason}`);
  }
  return {};
};

// ============================================================================
// SUBAGENT DEFINITIONS
// ============================================================================

const agents = {
  /**
   * Researcher: Focused on gathering information
   */
  researcher: {
    description: "Expert researcher who finds and summarizes information from the web",
    prompt: `You are a skilled research analyst. Your job is to:
1. Search the web for relevant information on the given topic
2. Read and analyze the most important sources
3. Summarize key findings with citations
4. Return a structured summary to the main agent

Always cite your sources with URLs. Focus on recent, authoritative sources.`,
    tools: ["WebSearch", "WebFetch", "log_event"],
    model: "sonnet" as const,
  },

  /**
   * Analyst: Focused on synthesizing and analyzing data
   */
  analyst: {
    description: "Data analyst who synthesizes research and identifies patterns",
    prompt: `You are an analytical thinker. Your job is to:
1. Take research findings and identify key themes
2. Look for patterns, trends, and implications
3. Provide actionable insights
4. Highlight any risks or opportunities

Be specific and data-driven in your analysis.`,
    tools: ["Read", "check_threshold", "log_event"],
    model: "sonnet" as const,
  },

  /**
   * Writer: Focused on producing polished output
   */
  writer: {
    description: "Technical writer who creates polished reports and documentation",
    prompt: `You are an expert technical writer. Your job is to:
1. Take analysis and research and craft it into a professional report
2. Use clear, concise language
3. Structure content logically with headings
4. Include an executive summary

Write for a technical audience who values clarity and actionability.`,
    tools: ["Write", "Edit", "log_event"],
    model: "haiku" as const, // Use faster/cheaper model for writing
  },
};

// ============================================================================
// MAIN AGENT
// ============================================================================

async function runAdvancedAgent() {
  console.log("=".repeat(60));
  console.log("Advanced Proactive Agent with Subagents");
  console.log("=".repeat(60));

  const topic = process.argv[2] || "The impact of AI agents on software development workflows";
  console.log(`Topic: ${topic}\n`);

  const startTime = Date.now();

  // The orchestrating prompt that delegates to subagents
  const promptText = `
You are an orchestrator agent managing a research project. Your team consists of:
- **researcher**: Gathers information from the web
- **analyst**: Analyzes findings and identifies patterns
- **writer**: Produces the final polished report

**Research Topic:** ${topic}

**Your workflow:**
1. First, use log_event to record that research has started
2. Delegate to the "researcher" subagent to gather information
3. Once research is complete, delegate to the "analyst" subagent to analyze findings
4. Finally, delegate to the "writer" subagent to produce a polished report
5. Log completion with log_event

Use the Task tool to invoke subagents. Provide clear instructions to each.
After the writer completes, output the final report.
`;

  // Streaming input mode required for custom MCP tools
  async function* streamPrompt() {
    yield {
      type: "user" as const,
      message: {
        role: "user" as const,
        content: [{ type: "text" as const, text: promptText }],
      },
    };
  }

  try {
    for await (const message of query({
      prompt: streamPrompt(),  // Use async generator for MCP tools
      options: {
        // Tools available to the main agent (including Task for subagents)
        allowedTools: ["Task", "Read", "Write", "log_event", "check_threshold"],

        // Subagent definitions
        agents,

        // MCP servers (custom tools)
        mcpServers: {
          custom: customServer,
        },

        // Hooks for monitoring
        hooks: {
          PreToolUse: [{ hooks: [toolLogger] }],
          SessionEnd: [{ hooks: [sessionEndLogger] }],
        },

        // Run autonomously
        permissionMode: "bypassPermissions",
        maxBudgetUsd: 2.0,

        // System prompt for the orchestrator
        systemPrompt: `You are an orchestrator agent. Today's date is ${new Date().toISOString().split("T")[0]}.
Your role is to coordinate between specialized subagents to produce high-quality research reports.
Always start and end with logging events for traceability.`,
      },
    })) {
      // Process messages
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block) {
            console.log(block.text);
          } else if ("name" in block) {
            // Check if this is a subagent invocation
            if (block.name === "Task") {
              const input = block.input as { subagent_type?: string; description?: string };
              console.log(`\n[Delegating to subagent: ${input.subagent_type || input.description}]\n`);
            } else {
              console.log(`[Tool: ${block.name}]`);
            }
          }
        }
      } else if (message.type === "result") {
        console.log(`\n[Agent completed: ${message.subtype}]`);
        if (message.subtype === "success" && "total_cost_usd" in message) {
          console.log(`Total cost: $${message.total_cost_usd.toFixed(4)}`);
        }
      }
    }
  } catch (error) {
    console.error("Agent execution failed:", error);
    process.exit(1);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nTotal duration: ${duration}s`);
}

// Run
runAdvancedAgent().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
