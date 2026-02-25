import { describe, test, expect } from "bun:test";
import { buildAuditSystemPrompt, buildPlanSystemPrompt, buildExecuteSystemPrompt, buildVerifySystemPrompt, buildUserPrompt } from "../tagging-agent.js";
import type { Config } from "../lib/config.js";

const mockConfig: Config = {
  vaultPath: "/tmp/test-vault",
  dataPath: "/tmp/test-data",
  agentMode: "audit",
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
  sessionStatePath: "/tmp/test-data/interactive-session.json",
  schemeNotePath: "Proposed Tagging System.md",
};

describe("buildAuditSystemPrompt", () => {
  const prompt = buildAuditSystemPrompt(mockConfig);

  test("contains key tool instructions", () => {
    expect(prompt).toContain("list_notes");
    expect(prompt).toContain("read_note");
    expect(prompt).toContain("write_note");
    expect(prompt).toContain("git_commit");
  });

  test("instructs minimal detail for budget efficiency", () => {
    expect(prompt).toContain('"minimal"');
  });

  test("references the audit report output path", () => {
    expect(prompt).toContain("_Tag Audit Report.md");
  });

  test("includes today's date", () => {
    const today = new Date().toISOString().split("T")[0];
    expect(prompt).toContain(today);
  });

  test("states READ-ONLY constraint", () => {
    expect(prompt).toContain("READ-ONLY");
  });
});

describe("buildPlanSystemPrompt", () => {
  const prompt = buildPlanSystemPrompt(mockConfig);

  test("references audit report as input", () => {
    expect(prompt).toContain("_Tag Audit Report.md");
  });

  test("references proposed tagging scheme note", () => {
    expect(prompt).toContain("Proposed Tagging System.md");
  });

  test("references migration plan output path", () => {
    expect(prompt).toContain("_Tag Migration Plan.md");
  });

  test("contains key tool instructions", () => {
    expect(prompt).toContain("write_note");
    expect(prompt).toContain("git_commit");
  });

  test("states REVIEW-ONLY constraint", () => {
    expect(prompt).toContain("REVIEW-ONLY");
  });

  test("contains next steps with generate-worklist instruction", () => {
    expect(prompt).toContain("generate-worklist");
  });

  test("mentions unmapped tags", () => {
    expect(prompt).toContain("UNMAPPED");
    expect(prompt).toContain("Unmapped Tags");
  });

  test("prioritizes read_data_file for audit-data.json", () => {
    expect(prompt).toContain("read_data_file");
    expect(prompt).toContain("audit-data.json");
    expect(prompt).toContain("USE THIS FIRST");
  });

  test("instructs to use read_note only for specific files", () => {
    expect(prompt).toContain("read_note");
    expect(prompt).toContain("USE ONLY for the audit report and scheme note");
  });

  test("contains Critical Constraint section forbidding re-scan", () => {
    expect(prompt).toContain("Critical Constraint");
    expect(prompt).toContain("DO NOT re-scan notes");
  });

  test("de-prioritizes list_notes and search_notes", () => {
    expect(prompt).toContain("Tools NOT needed for this phase");
    expect(prompt).toContain("list_notes");
    expect(prompt).toContain("search_notes");
  });

  test("references tagFrequencies in audit-data.json", () => {
    expect(prompt).toContain("tagFrequencies");
  });

  test("does NOT contain worklist JSON schema (moved to code)", () => {
    expect(prompt).not.toContain('"totalChanges"');
  });
});

describe("buildExecuteSystemPrompt", () => {
  const prompt = buildExecuteSystemPrompt(mockConfig);

  test("references next-batch.json as primary input", () => {
    expect(prompt).toContain("next-batch.json");
  });

  test("contains key tool instructions", () => {
    expect(prompt).toContain("apply_tag_changes");
    expect(prompt).toContain("git_commit");
    expect(prompt).toContain("read_data_file");
  });

  test("describes batch structure fields", () => {
    expect(prompt).toContain("batchNumber");
    expect(prompt).toContain("totalInWorklist");
    expect(prompt).toContain("entries");
  });

  test("instructs to skip/log failed notes", () => {
    expect(prompt).toContain("skip");
  });

  test("includes today's date", () => {
    const today = new Date().toISOString().split("T")[0];
    expect(prompt).toContain(today);
  });

  test("states batch-only constraint", () => {
    expect(prompt).toContain("what the batch specifies");
  });

  test("references progress file", () => {
    expect(prompt).toContain("migration-progress.json");
  });

  test("references worklist source for progress tracking", () => {
    expect(prompt).toContain("migration-worklist.json");
  });

  test("forbids search_notes usage", () => {
    expect(prompt).toContain("search_notes");
  });

  test("forbids Bash usage", () => {
    expect(prompt).toContain("Bash");
  });

  test("instructs to read batch file first", () => {
    expect(prompt).toContain("Step 1: Read Batch File");
  });
});

describe("buildVerifySystemPrompt", () => {
  const prompt = buildVerifySystemPrompt(mockConfig);

  test("references verification report output", () => {
    expect(prompt).toContain("_Tag Migration Verification.md");
  });

  test("contains key tool instructions", () => {
    expect(prompt).toContain("list_notes");
    expect(prompt).toContain("read_note");
    expect(prompt).toContain("write_note");
    expect(prompt).toContain("git_commit");
  });

  test("instructs minimal detail for budget efficiency", () => {
    expect(prompt).toContain('"minimal"');
  });

  test("states READ-ONLY constraint", () => {
    expect(prompt).toContain("READ-ONLY");
  });

  test("includes today's date", () => {
    const today = new Date().toISOString().split("T")[0];
    expect(prompt).toContain(today);
  });

  test("instructs to exclude agent artifact notes", () => {
    expect(prompt).toContain("prefixed with _");
  });

  test("recognizes flat topic tags as valid", () => {
    expect(prompt).toContain("Flat topic tags");
  });

  test("flags purely numeric tags as invalid", () => {
    expect(prompt).toContain("numeric");
  });

  test("lists both valid tag formats", () => {
    expect(prompt).toContain("Prefixed tags");
    expect(prompt).toContain("Flat topic tags");
  });
});

describe("buildUserPrompt", () => {
  test("returns correct prompt for audit mode", () => {
    const prompt = buildUserPrompt("audit", mockConfig);
    expect(prompt).toContain("Audit all tags");
    expect(prompt).toContain("_Tag Audit Report.md");
  });

  test("returns correct prompt for plan mode", () => {
    const prompt = buildUserPrompt("plan", mockConfig);
    expect(prompt).toContain("migration plan");
    expect(prompt).toContain("_Tag Migration Plan.md");
    expect(prompt).toContain("50");
  });

  test("returns correct prompt for execute mode", () => {
    const prompt = buildUserPrompt("execute", mockConfig);
    expect(prompt).toContain("migration plan");
    expect(prompt).toContain("50");
  });

  test("returns correct prompt for generate-worklist mode", () => {
    const prompt = buildUserPrompt("generate-worklist", mockConfig);
    expect(prompt).toContain("worklist");
  });

  test("returns correct prompt for verify mode", () => {
    const prompt = buildUserPrompt("verify", mockConfig);
    expect(prompt).toContain("Verify");
    expect(prompt).toContain("_Tag Migration Verification.md");
  });
});
