import { describe, test, expect } from "bun:test";
import { buildAuditSystemPrompt, buildPlanSystemPrompt, buildUserPrompt } from "../tagging-agent.js";
import type { Config } from "../lib/config.js";

const mockConfig: Config = {
  vaultPath: "/tmp/test-vault",
  agentMode: "audit",
  batchSize: 50,
  maxBudgetUsd: 1.0,
  agentModel: "claude-sonnet-4-20250514",
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

  test("includes batch size from config", () => {
    expect(prompt).toContain("50");
  });

  test("states REVIEW-ONLY constraint", () => {
    expect(prompt).toContain("REVIEW-ONLY");
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

  test("throws for execute mode (Phase 3)", () => {
    expect(() => buildUserPrompt("execute", mockConfig)).toThrow("not yet implemented");
  });

  test("throws for verify mode (Phase 3)", () => {
    expect(() => buildUserPrompt("verify", mockConfig)).toThrow("not yet implemented");
  });
});
