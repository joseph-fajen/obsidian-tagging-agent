/**
 * Proactive Research Agent
 *
 * A scheduled AI agent that researches a topic and generates a markdown report.
 * Designed to run autonomously via cron job or Windows Task Scheduler.
 *
 * Usage:
 *   bun run agent.ts
 *   bun run agent.ts "Custom research topic"
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdir, writeFile, exists } from "fs/promises";
import { join } from "path";

// Configuration from environment or defaults
const CONFIG = {
  topic: process.argv[2] || process.env.AGENT_TOPIC || "Latest developments in AI agents and automation",
  outputDir: process.env.OUTPUT_DIR || "./reports",
  maxBudgetUsd: parseFloat(process.env.MAX_BUDGET_USD || "1.00"),
  model: process.env.AGENT_MODEL || "claude-sonnet-4-5-20250929",
};

// Generate filename with today's date
function getOutputFilename(): string {
  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return `${date}-research.md`;
}

// Main agent function
async function runResearchAgent() {
  console.log("=".repeat(60));
  console.log("Proactive Research Agent");
  console.log("=".repeat(60));
  console.log(`Topic: ${CONFIG.topic}`);
  console.log(`Output: ${CONFIG.outputDir}`);
  console.log(`Budget: $${CONFIG.maxBudgetUsd}`);
  console.log(`Model: ${CONFIG.model}`);
  console.log("=".repeat(60));
  console.log();

  // Ensure output directory exists
  if (!(await exists(CONFIG.outputDir))) {
    await mkdir(CONFIG.outputDir, { recursive: true });
    console.log(`Created output directory: ${CONFIG.outputDir}`);
  }

  const outputPath = join(CONFIG.outputDir, getOutputFilename());

  // Check if today's report already exists (idempotency)
  if (await exists(outputPath)) {
    console.log(`Report already exists for today: ${outputPath}`);
    console.log("Skipping to avoid duplicate work. Delete the file to regenerate.");
    return;
  }

  const startTime = Date.now();
  let result = "";
  let totalCost = 0;

  // The research prompt
  const prompt = `
You are a research analyst. Your task is to research the following topic and produce a comprehensive report.

**Topic:** ${CONFIG.topic}

**Instructions:**
1. Use WebSearch to find recent, relevant information (focus on developments from the last week)
2. Use WebFetch to read important articles for deeper insights
3. Synthesize your findings into a well-structured markdown report

**Report Format:**
- Title with today's date
- Executive summary (2-3 sentences)
- Key findings (bullet points)
- Detailed analysis (organized by subtopic)
- Notable sources (with links)
- Implications and trends to watch

**Important:** Focus on actionable insights and emerging trends. Be specific with dates, companies, and technologies mentioned.

After completing your research, output the final markdown report content that I can save to a file.
`;

  console.log("Starting research...\n");

  try {
    // Run the agent
    for await (const message of query({
      prompt,
      options: {
        allowedTools: ["WebSearch", "WebFetch", "Read", "Write"],
        permissionMode: "bypassPermissions", // Autonomous execution
        maxBudgetUsd: CONFIG.maxBudgetUsd,
        model: CONFIG.model,
        systemPrompt: `You are a thorough research analyst. Today's date is ${new Date().toISOString().split("T")[0]}. Always cite your sources with URLs.`,
      },
    })) {
      // Handle different message types
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block) {
            // Print Claude's reasoning/output
            console.log(block.text);
            // Capture the text for the report
            result = block.text;
          } else if ("name" in block) {
            // Log tool usage
            console.log(`\n[Tool: ${block.name}]\n`);
          }
        }
      } else if (message.type === "result") {
        // Capture final result and stats
        if (message.subtype === "success") {
          result = message.result || result;
          totalCost = message.total_cost_usd || 0;
        } else {
          console.error(`Agent ended with error: ${message.subtype}`);
          if ("errors" in message) {
            console.error(message.errors);
          }
        }
      }
    }

    // Save the report
    if (result) {
      await writeFile(outputPath, result, "utf-8");
      console.log("\n" + "=".repeat(60));
      console.log(`Report saved to: ${outputPath}`);
    }
  } catch (error) {
    console.error("Agent execution failed:", error);
    process.exit(1);
  }

  // Summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Duration: ${duration}s`);
  console.log(`Cost: $${totalCost.toFixed(4)}`);
  console.log("=".repeat(60));
}

// Run the agent
runResearchAgent().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
