/**
 * DEMO: Subagents
 *
 * Demonstrates how to spawn specialized child agents using the Claude Agent SDK.
 *
 * Key concepts:
 * - Define subagents with specific roles, tools, and models
 * - Main agent orchestrates by delegating to subagents via the Task tool
 * - Each subagent has isolated context
 * - Use cheaper/faster models (Haiku) for simple subtasks
 *
 * Run: bun run demo-subagents.ts
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

// ============================================================================
// DEMO CONFIGURATION
// ============================================================================

console.log("\n");
console.log("╔══════════════════════════════════════════════════════════════════╗");
console.log("║           CLAUDE AGENT SDK - SUBAGENTS DEMONSTRATION             ║");
console.log("╚══════════════════════════════════════════════════════════════════╝");
console.log();

// Define specialized subagents
const subagentDefinitions = {
  /**
   * Research Agent - Uses web tools to gather information
   * Uses Sonnet for quality research
   */
  "researcher": {
    description: "Expert researcher who searches the web and summarizes findings. Use for gathering information.",
    prompt: `You are a research specialist. Your job is to:
1. Search the web for relevant, recent information
2. Read and analyze key sources
3. Return a concise summary with source URLs

Focus on facts and be specific. Always cite your sources.`,
    tools: ["WebSearch", "WebFetch"],
    model: "sonnet" as const,
  },

  /**
   * Code Analyzer - Reads and analyzes code
   * Uses Haiku for speed (simple analysis tasks)
   */
  "code-analyzer": {
    description: "Code analysis expert who examines codebases. Use for understanding code structure.",
    prompt: `You are a code analysis expert. Your job is to:
1. Read and understand code files
2. Identify patterns, structure, and purpose
3. Return clear, technical summaries

Be concise and focus on architecture and key components.`,
    tools: ["Read", "Glob", "Grep"],
    model: "haiku" as const,
  },

  /**
   * Report Writer - Creates polished output
   * Uses Haiku since writing is straightforward once content exists
   */
  "writer": {
    description: "Technical writer who creates polished reports. Use for final output generation.",
    prompt: `You are a technical writer. Your job is to:
1. Take research/analysis findings and create a polished report
2. Use clear headings and bullet points
3. Write for a technical audience

Keep it professional and actionable.`,
    tools: ["Read"],
    model: "haiku" as const,
  },
};

// ============================================================================
// DISPLAY CONFIGURATION
// ============================================================================

console.log("SUBAGENT DEFINITIONS:");
console.log("─".repeat(60));
for (const [name, config] of Object.entries(subagentDefinitions)) {
  console.log(`\n  📋 ${name}`);
  console.log(`     Model: ${config.model}`);
  console.log(`     Tools: ${config.tools.join(", ")}`);
  console.log(`     Purpose: ${config.description.split(".")[0]}`);
}
console.log("\n" + "─".repeat(60));

// ============================================================================
// RUN THE DEMO
// ============================================================================

async function runSubagentsDemo() {
  console.log("\n🚀 STARTING ORCHESTRATOR AGENT\n");
  console.log("The main agent will coordinate subagents to analyze this project.\n");

  const startTime = Date.now();
  const subagentInvocations: string[] = [];
  let finalResult = "";
  let totalCost = 0;

  // Orchestrator prompt - tells the main agent how to delegate
  const prompt = `
You are an orchestrator agent with a team of specialists:
- **researcher**: For web research and finding information
- **code-analyzer**: For reading and understanding code
- **writer**: For creating polished reports

**Your Task:**
Analyze this project directory and create a brief summary. Here's how to approach it:

1. First, use the **code-analyzer** subagent to examine the project structure and key files
2. Then, use the **writer** subagent to create a polished 3-5 bullet point summary

Use the Task tool to invoke subagents. Provide clear instructions to each.
Keep the final output concise - just a brief project summary.
`;

  try {
    for await (const message of query({
      prompt,
      options: {
        // Main agent needs Task tool to invoke subagents
        allowedTools: ["Task", "Read", "Glob"],

        // Subagent definitions
        agents: subagentDefinitions,

        // Run autonomously for the demo
        permissionMode: "bypassPermissions",
        maxTurns: 15,
        maxBudgetUsd: 1.00,

        // System prompt for the orchestrator
        systemPrompt: `You are an orchestrator agent. Today is ${new Date().toISOString().split("T")[0]}.
Your role is to coordinate between specialized subagents to complete tasks efficiently.
Always delegate to the most appropriate subagent for each subtask.`,
      },
    })) {
      // Track session initialization
      if (message.type === "system" && "subtype" in message && message.subtype === "init") {
        console.log(`📍 Session ID: ${message.session_id}`);
        console.log(`📍 Model: ${(message as any).model}`);
        console.log();
      }

      // Track assistant messages and tool calls
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("name" in block) {
            if (block.name === "Task") {
              // Subagent invocation
              const input = block.input as { subagent_type?: string; description?: string; prompt?: string };
              const agentName = input.subagent_type || input.description || "unknown";

              if (!subagentInvocations.includes(agentName)) {
                subagentInvocations.push(agentName);
              }

              console.log("┌" + "─".repeat(58) + "┐");
              console.log(`│ 🤖 SUBAGENT INVOKED: ${agentName.padEnd(36)}│`);
              console.log("└" + "─".repeat(58) + "┘");

              // Show what the subagent was asked to do
              if (input.prompt) {
                const preview = input.prompt.substring(0, 80).replace(/\n/g, " ");
                console.log(`   Task: ${preview}...`);
              }
              console.log();
            } else {
              // Other tool usage
              console.log(`   [Tool] ${block.name}`);
            }
          } else if ("text" in block && block.text.length > 0) {
            // Only show substantial text output
            if (block.text.length > 50) {
              console.log("\n📝 Agent Output:");
              console.log("─".repeat(40));
              // Show first part of output
              const preview = block.text.substring(0, 300);
              console.log(preview);
              if (block.text.length > 300) {
                console.log("...[truncated]");
              }
              console.log("─".repeat(40));
            }
            finalResult = block.text;
          }
        }
      }

      // Capture final result
      if (message.type === "result") {
        if (message.subtype === "success") {
          finalResult = message.result || finalResult;
          totalCost = message.total_cost_usd || 0;
          console.log(`\n✅ Agent completed successfully`);
          console.log(`   Turns: ${message.num_turns}`);
        } else {
          console.log(`\n❌ Agent ended: ${message.subtype}`);
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
  console.log(`  🤖 Subagents Invoked: ${subagentInvocations.length}`);

  if (subagentInvocations.length > 0) {
    console.log();
    console.log("  Subagent Invocation Order:");
    subagentInvocations.forEach((agent, i) => {
      console.log(`     ${i + 1}. ${agent}`);
    });
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
  console.log("  1. Subagents are defined in the `agents` option");
  console.log("  2. Each subagent has: description, prompt, tools, model");
  console.log("  3. Main agent uses the `Task` tool to invoke subagents");
  console.log("  4. Subagents have isolated context (separate conversation)");
  console.log("  5. Use Haiku for simple tasks, Sonnet/Opus for complex ones");
  console.log();
  console.log("  Configuration used:");
  console.log("  ```typescript");
  console.log("  agents: {");
  console.log('    "researcher": { model: "sonnet", tools: ["WebSearch", "WebFetch"] },');
  console.log('    "code-analyzer": { model: "haiku", tools: ["Read", "Glob", "Grep"] },');
  console.log('    "writer": { model: "haiku", tools: ["Read"] }');
  console.log("  }");
  console.log("  ```");
  console.log();
}

// Run the demo
runSubagentsDemo().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
