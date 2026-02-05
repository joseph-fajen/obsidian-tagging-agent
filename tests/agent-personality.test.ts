import { describe, test, expect } from "bun:test";
import {
  buildPersonalityPrompt,
  buildAuditInstructions,
  buildPlanInstructions,
  buildExecuteInstructions,
  buildVerifyInstructions,
  buildInteractiveSystemPrompt,
  buildPhaseTransitionPrompt,
  buildWelcomeMessage,
  buildResumeMessage,
} from "../lib/agent-personality.js";
import { type Config } from "../lib/config.js";
import { type AgentPhase } from "../lib/session-state.js";

// Mock config for testing
const mockConfig: Config = {
  vaultPath: "/test/vault",
  dataPath: "/test/data",
  agentMode: "interactive",
  batchSize: 50,
  maxBudgetUsd: 1.0,
  agentModel: "claude-sonnet-4-20250514",
  modelsByPhase: {
    AUDIT: "claude-sonnet-4-20250514",
    PLAN: "claude-sonnet-4-20250514",
    EXECUTE: "claude-haiku-4-5-20251001",
    VERIFY: "claude-sonnet-4-20250514",
    CONVERSATION: "claude-sonnet-4-20250514",
  },
  sessionStatePath: "/test/data/interactive-session.json",
};

describe("buildPersonalityPrompt", () => {
  test("returns non-empty string", () => {
    const prompt = buildPersonalityPrompt();
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("mentions vault organization", () => {
    const prompt = buildPersonalityPrompt();
    expect(prompt.toLowerCase()).toContain("vault");
  });

  test("mentions tags", () => {
    const prompt = buildPersonalityPrompt();
    expect(prompt.toLowerCase()).toContain("tag");
  });

  test("has supportive tone keywords", () => {
    const prompt = buildPersonalityPrompt();
    const lowerPrompt = prompt.toLowerCase();
    expect(
      lowerPrompt.includes("supportive") ||
        lowerPrompt.includes("guide") ||
        lowerPrompt.includes("help")
    ).toBe(true);
  });

  test("mentions hierarchical prefixes", () => {
    const prompt = buildPersonalityPrompt();
    expect(prompt).toContain("status/");
    expect(prompt).toContain("type/");
  });
});

describe("buildAuditInstructions", () => {
  test("includes key audit steps", () => {
    const instructions = buildAuditInstructions(mockConfig);
    expect(instructions).toContain("list_notes");
    expect(instructions).toContain("read_note");
    expect(instructions).toContain("_Tag Audit Report.md");
  });

  test("includes vault path", () => {
    const instructions = buildAuditInstructions(mockConfig);
    expect(instructions).toContain(mockConfig.vaultPath);
  });

  test("mentions READ-ONLY constraint", () => {
    const instructions = buildAuditInstructions(mockConfig);
    expect(instructions).toContain("READ-ONLY");
  });

  test("mentions noise tags", () => {
    const instructions = buildAuditInstructions(mockConfig);
    expect(instructions.toLowerCase()).toContain("noise");
  });
});

describe("buildPlanInstructions", () => {
  test("includes mapping table guidance", () => {
    const instructions = buildPlanInstructions(mockConfig);
    expect(instructions).toContain("MAP");
    expect(instructions).toContain("REMOVE");
    expect(instructions).toContain("KEEP");
    expect(instructions).toContain("UNMAPPED");
  });

  test("mentions audit report as input", () => {
    const instructions = buildPlanInstructions(mockConfig);
    expect(instructions).toContain("_Tag Audit Report.md");
  });

  test("mentions migration plan output", () => {
    const instructions = buildPlanInstructions(mockConfig);
    expect(instructions).toContain("_Tag Migration Plan.md");
  });
});

describe("buildExecuteInstructions", () => {
  test("includes batch processing", () => {
    const instructions = buildExecuteInstructions(mockConfig);
    expect(instructions).toContain("batch");
    expect(instructions).toContain("next-batch.json");
  });

  test("mentions execute_batch tool", () => {
    const instructions = buildExecuteInstructions(mockConfig);
    expect(instructions).toContain("execute_batch");
  });

  test("mentions get_progress tool", () => {
    const instructions = buildExecuteInstructions(mockConfig);
    expect(instructions).toContain("get_progress");
  });

  test("includes vault path", () => {
    const instructions = buildExecuteInstructions(mockConfig);
    expect(instructions).toContain(mockConfig.vaultPath);
  });
});

describe("buildVerifyInstructions", () => {
  test("includes compliance checks", () => {
    const instructions = buildVerifyInstructions(mockConfig);
    expect(instructions.toLowerCase()).toContain("inline");
    expect(instructions.toLowerCase()).toContain("frontmatter");
  });

  test("mentions verification report", () => {
    const instructions = buildVerifyInstructions(mockConfig);
    expect(instructions).toContain("_Tag Migration Verification.md");
  });

  test("mentions valid prefixes", () => {
    const instructions = buildVerifyInstructions(mockConfig);
    expect(instructions).toContain("status/");
    expect(instructions).toContain("type/");
  });
});

describe("buildInteractiveSystemPrompt", () => {
  test("combines personality with phase instructions for AUDIT", () => {
    const prompt = buildInteractiveSystemPrompt("AUDIT", mockConfig);
    // Should have personality
    expect(prompt.toLowerCase()).toContain("vault");
    // Should have audit instructions
    expect(prompt).toContain("list_notes");
  });

  test("combines personality with phase instructions for PLAN", () => {
    const prompt = buildInteractiveSystemPrompt("PLAN", mockConfig);
    expect(prompt).toContain("MAP");
    expect(prompt).toContain("UNMAPPED");
  });

  test("combines personality with phase instructions for EXECUTE", () => {
    const prompt = buildInteractiveSystemPrompt("EXECUTE", mockConfig);
    expect(prompt).toContain("execute_batch");
  });

  test("combines personality with phase instructions for VERIFY", () => {
    const prompt = buildInteractiveSystemPrompt("VERIFY", mockConfig);
    expect(prompt).toContain("_Tag Migration Verification.md");
  });

  test("returns only personality for WELCOME phase", () => {
    const prompt = buildInteractiveSystemPrompt("WELCOME", mockConfig);
    // Should have personality but no specific phase instructions
    expect(prompt.toLowerCase()).toContain("vault");
    expect(prompt).not.toContain("## Current Phase:");
  });

  test("returns only personality for REVIEW phases", () => {
    const prompt = buildInteractiveSystemPrompt("REVIEW_AUDIT", mockConfig);
    expect(prompt.toLowerCase()).toContain("vault");
    expect(prompt).not.toContain("## Current Phase:");
  });

  test("returns only personality for COMPLETE phase", () => {
    const prompt = buildInteractiveSystemPrompt("COMPLETE", mockConfig);
    expect(prompt.toLowerCase()).toContain("vault");
    expect(prompt).not.toContain("## Current Phase:");
  });
});

describe("buildPhaseTransitionPrompt", () => {
  test("returns appropriate message for WELCOME to AUDIT", () => {
    const message = buildPhaseTransitionPrompt("WELCOME", "AUDIT");
    expect(message.toLowerCase()).toContain("audit");
    expect(message.toLowerCase()).toContain("scan");
  });

  test("returns appropriate message for AUDIT to REVIEW_AUDIT", () => {
    const message = buildPhaseTransitionPrompt("AUDIT", "REVIEW_AUDIT");
    expect(message.toLowerCase()).toContain("complete");
    expect(message).toContain("_Tag Audit Report.md");
  });

  test("returns appropriate message for PLAN to REVIEW_PLAN", () => {
    const message = buildPhaseTransitionPrompt("PLAN", "REVIEW_PLAN");
    expect(message).toContain("_Tag Migration Plan.md");
  });

  test("includes batch info for EXECUTE to REVIEW_EXECUTE when notes remaining", () => {
    const message = buildPhaseTransitionPrompt("EXECUTE", "REVIEW_EXECUTE", {
      notesRemaining: 100,
    });
    expect(message).toContain("100");
  });

  test("returns completion message when no notes remaining", () => {
    const message = buildPhaseTransitionPrompt("EXECUTE", "REVIEW_EXECUTE", {
      notesRemaining: 0,
    });
    expect(message.toLowerCase()).toContain("complete");
  });

  test("returns congratulations for REVIEW_VERIFY to COMPLETE", () => {
    const message = buildPhaseTransitionPrompt("REVIEW_VERIFY", "COMPLETE");
    expect(message.toLowerCase()).toContain("congratulations");
  });

  test("returns default message for unknown transitions", () => {
    const message = buildPhaseTransitionPrompt(
      "COMPLETE" as AgentPhase,
      "WELCOME" as AgentPhase
    );
    expect(message.length).toBeGreaterThan(0);
  });
});

describe("buildWelcomeMessage", () => {
  test("includes vault path", () => {
    const message = buildWelcomeMessage("/my/vault");
    expect(message).toContain("/my/vault");
  });

  test("lists all phases", () => {
    const message = buildWelcomeMessage("/test");
    expect(message.toLowerCase()).toContain("audit");
    expect(message.toLowerCase()).toContain("plan");
    expect(message.toLowerCase()).toContain("execute");
    expect(message.toLowerCase()).toContain("verify");
  });

  test("mentions saving progress", () => {
    const message = buildWelcomeMessage("/test");
    const lowerMessage = message.toLowerCase();
    expect(lowerMessage.includes("save") || lowerMessage.includes("pause")).toBe(true);
  });
});

describe("buildResumeMessage", () => {
  test("includes vault path", () => {
    const message = buildResumeMessage("EXECUTE", "/my/vault");
    expect(message).toContain("/my/vault");
  });

  test("includes current phase", () => {
    const message = buildResumeMessage("EXECUTE", "/test");
    expect(message.toLowerCase()).toContain("execute");
  });

  test("offers choice to continue or start fresh", () => {
    const message = buildResumeMessage("PLAN", "/test");
    const lowerMessage = message.toLowerCase();
    expect(lowerMessage.includes("continue") || lowerMessage.includes("fresh")).toBe(true);
  });
});
