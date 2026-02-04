import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig, type AgentMode, type Config } from "../lib/config.js";

describe("config", () => {
  // Store original env values
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save original env values
    originalEnv.VAULT_PATH = process.env.VAULT_PATH;
    originalEnv.AGENT_MODE = process.env.AGENT_MODE;
    originalEnv.BATCH_SIZE = process.env.BATCH_SIZE;
    originalEnv.MAX_BUDGET_USD = process.env.MAX_BUDGET_USD;
    originalEnv.AGENT_MODEL = process.env.AGENT_MODEL;

    // Set required env for tests
    process.env.VAULT_PATH = "/test/vault";
  });

  afterEach(() => {
    // Restore original env values
    process.env.VAULT_PATH = originalEnv.VAULT_PATH;
    process.env.AGENT_MODE = originalEnv.AGENT_MODE;
    process.env.BATCH_SIZE = originalEnv.BATCH_SIZE;
    process.env.MAX_BUDGET_USD = originalEnv.MAX_BUDGET_USD;
    process.env.AGENT_MODEL = originalEnv.AGENT_MODEL;
  });

  describe("AgentMode type", () => {
    test("includes all expected modes", () => {
      // Test that loadConfig accepts all valid modes
      const validModes: AgentMode[] = [
        "audit",
        "plan",
        "generate-worklist",
        "execute",
        "verify",
        "interactive",
      ];

      for (const mode of validModes) {
        process.env.AGENT_MODE = mode;
        const config = loadConfig();
        expect(config.agentMode).toBe(mode);
      }
    });

    test("interactive is a valid mode", () => {
      process.env.AGENT_MODE = "interactive";
      const config = loadConfig();
      expect(config.agentMode).toBe("interactive");
    });
  });

  describe("Config interface", () => {
    test("includes sessionStatePath", () => {
      process.env.AGENT_MODE = "audit";
      const config = loadConfig();
      expect(config.sessionStatePath).toBeDefined();
      expect(typeof config.sessionStatePath).toBe("string");
    });

    test("sessionStatePath defaults to data/interactive-session.json", () => {
      const config = loadConfig();
      expect(config.sessionStatePath).toContain("data");
      expect(config.sessionStatePath).toContain("interactive-session.json");
    });

    test("sessionStatePath is under dataPath", () => {
      const config = loadConfig();
      expect(config.sessionStatePath.startsWith(config.dataPath)).toBe(true);
    });
  });

  describe("loadConfig", () => {
    test("throws when VAULT_PATH is missing", () => {
      delete process.env.VAULT_PATH;
      expect(() => loadConfig()).toThrow("VAULT_PATH environment variable is required");
    });

    test("uses default agentMode when AGENT_MODE not set", () => {
      delete process.env.AGENT_MODE;
      const config = loadConfig();
      expect(config.agentMode).toBe("audit");
    });

    test("throws for invalid AGENT_MODE", () => {
      process.env.AGENT_MODE = "invalid-mode";
      expect(() => loadConfig()).toThrow("Invalid AGENT_MODE");
    });

    test("uses default batchSize when BATCH_SIZE not set", () => {
      const config = loadConfig();
      expect(config.batchSize).toBe(50);
    });

    test("parses BATCH_SIZE from env", () => {
      process.env.BATCH_SIZE = "100";
      const config = loadConfig();
      expect(config.batchSize).toBe(100);
    });

    test("uses default maxBudgetUsd when MAX_BUDGET_USD not set", () => {
      delete process.env.MAX_BUDGET_USD;
      const config = loadConfig();
      expect(config.maxBudgetUsd).toBe(1.0);
    });

    test("uses default agentModel when AGENT_MODEL not set", () => {
      delete process.env.AGENT_MODEL;
      const config = loadConfig();
      expect(config.agentModel).toBe("claude-sonnet-4-20250514");
    });
  });
});
