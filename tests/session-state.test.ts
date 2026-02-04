import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import {
  createInitialState,
  loadSessionState,
  saveSessionState,
  clearSessionState,
  getPhaseName,
  getNextPhase,
  type SessionState,
  type AgentPhase,
} from "../lib/session-state.js";

// Use a temporary directory for tests
const TEST_DATA_PATH = join(process.cwd(), "test-data-session");

describe("session-state", () => {
  beforeEach(async () => {
    // Create test data directory
    await mkdir(TEST_DATA_PATH, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test data directory
    await rm(TEST_DATA_PATH, { recursive: true, force: true });
  });

  describe("createInitialState", () => {
    test("returns valid state with all required fields", () => {
      const vaultPath = "/test/vault";
      const state = createInitialState(vaultPath);

      expect(state.sessionId).toBeNull();
      expect(state.currentPhase).toBe("WELCOME");
      expect(state.vaultPath).toBe(vaultPath);
      expect(state.auditComplete).toBe(false);
      expect(state.planComplete).toBe(false);
      expect(state.worklistGenerated).toBe(false);
      expect(state.executeBatchNumber).toBe(0);
      expect(state.executeTotalBatches).toBe(0);
      expect(state.verifyComplete).toBe(false);
    });

    test("sets timestamps to current time", () => {
      const before = new Date().toISOString();
      const state = createInitialState("/test/vault");
      const after = new Date().toISOString();

      expect(state.startedAt >= before).toBe(true);
      expect(state.startedAt <= after).toBe(true);
      expect(state.lastUpdatedAt >= before).toBe(true);
      expect(state.lastUpdatedAt <= after).toBe(true);
    });
  });

  describe("saveSessionState", () => {
    test("writes JSON file to disk", async () => {
      const state = createInitialState("/test/vault");
      await saveSessionState(TEST_DATA_PATH, state);

      // Verify file exists by loading it back
      const loaded = await loadSessionState(TEST_DATA_PATH);
      expect(loaded).not.toBeNull();
    });

    test("updates lastUpdatedAt timestamp", async () => {
      const state = createInitialState("/test/vault");
      const originalTimestamp = state.lastUpdatedAt;

      // Wait a tiny bit to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      await saveSessionState(TEST_DATA_PATH, state);
      const loaded = await loadSessionState(TEST_DATA_PATH);

      expect(loaded!.lastUpdatedAt > originalTimestamp).toBe(true);
    });
  });

  describe("loadSessionState", () => {
    test("reads JSON file from disk", async () => {
      const state = createInitialState("/test/vault");
      state.currentPhase = "AUDIT";
      state.auditComplete = true;
      await saveSessionState(TEST_DATA_PATH, state);

      const loaded = await loadSessionState(TEST_DATA_PATH);
      expect(loaded).not.toBeNull();
      expect(loaded!.currentPhase).toBe("AUDIT");
      expect(loaded!.auditComplete).toBe(true);
    });

    test("returns null when file does not exist", async () => {
      const loaded = await loadSessionState(TEST_DATA_PATH);
      expect(loaded).toBeNull();
    });

    test("returns null when file is invalid JSON", async () => {
      // Write invalid JSON
      const fs = await import("fs/promises");
      await fs.writeFile(
        join(TEST_DATA_PATH, "interactive-session.json"),
        "not valid json{{{",
        "utf-8"
      );

      const loaded = await loadSessionState(TEST_DATA_PATH);
      expect(loaded).toBeNull();
    });
  });

  describe("clearSessionState", () => {
    test("removes session file", async () => {
      const state = createInitialState("/test/vault");
      await saveSessionState(TEST_DATA_PATH, state);

      // Verify file exists
      const before = await loadSessionState(TEST_DATA_PATH);
      expect(before).not.toBeNull();

      // Clear it
      await clearSessionState(TEST_DATA_PATH);

      // Verify it's gone
      const after = await loadSessionState(TEST_DATA_PATH);
      expect(after).toBeNull();
    });

    test("does not throw when file does not exist", async () => {
      // Should not throw
      await clearSessionState(TEST_DATA_PATH);
    });
  });

  describe("round-trip persistence", () => {
    test("save then load preserves all fields", async () => {
      const state: SessionState = {
        sessionId: "test-session-123",
        currentPhase: "EXECUTE",
        startedAt: "2026-02-04T10:00:00.000Z",
        lastUpdatedAt: "2026-02-04T10:00:00.000Z",
        vaultPath: "/my/vault/path",
        auditComplete: true,
        planComplete: true,
        worklistGenerated: true,
        executeBatchNumber: 5,
        executeTotalBatches: 10,
        verifyComplete: false,
      };

      await saveSessionState(TEST_DATA_PATH, state);
      const loaded = await loadSessionState(TEST_DATA_PATH);

      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe("test-session-123");
      expect(loaded!.currentPhase).toBe("EXECUTE");
      expect(loaded!.startedAt).toBe("2026-02-04T10:00:00.000Z");
      expect(loaded!.vaultPath).toBe("/my/vault/path");
      expect(loaded!.auditComplete).toBe(true);
      expect(loaded!.planComplete).toBe(true);
      expect(loaded!.worklistGenerated).toBe(true);
      expect(loaded!.executeBatchNumber).toBe(5);
      expect(loaded!.executeTotalBatches).toBe(10);
      expect(loaded!.verifyComplete).toBe(false);
      // lastUpdatedAt will be updated by saveSessionState
      expect(loaded!.lastUpdatedAt > state.lastUpdatedAt).toBe(true);
    });
  });

  describe("getPhaseName", () => {
    test("returns human-readable names for all phases", () => {
      expect(getPhaseName("WELCOME")).toBe("Welcome");
      expect(getPhaseName("AUDIT")).toBe("Audit");
      expect(getPhaseName("REVIEW_AUDIT")).toBe("Review Audit");
      expect(getPhaseName("PLAN")).toBe("Plan");
      expect(getPhaseName("REVIEW_PLAN")).toBe("Review Plan");
      expect(getPhaseName("GENERATE_WORKLIST")).toBe("Generate Worklist");
      expect(getPhaseName("REVIEW_WORKLIST")).toBe("Review Worklist");
      expect(getPhaseName("EXECUTE")).toBe("Execute");
      expect(getPhaseName("REVIEW_EXECUTE")).toBe("Review Execute");
      expect(getPhaseName("VERIFY")).toBe("Verify");
      expect(getPhaseName("REVIEW_VERIFY")).toBe("Review Verify");
      expect(getPhaseName("COMPLETE")).toBe("Complete");
    });
  });

  describe("getNextPhase", () => {
    test("returns correct next phase for each phase", () => {
      expect(getNextPhase("WELCOME")).toBe("AUDIT");
      expect(getNextPhase("AUDIT")).toBe("REVIEW_AUDIT");
      expect(getNextPhase("REVIEW_AUDIT")).toBe("PLAN");
      expect(getNextPhase("PLAN")).toBe("REVIEW_PLAN");
      expect(getNextPhase("REVIEW_PLAN")).toBe("GENERATE_WORKLIST");
      expect(getNextPhase("GENERATE_WORKLIST")).toBe("REVIEW_WORKLIST");
      expect(getNextPhase("REVIEW_WORKLIST")).toBe("EXECUTE");
      expect(getNextPhase("EXECUTE")).toBe("REVIEW_EXECUTE");
      expect(getNextPhase("REVIEW_EXECUTE")).toBe("VERIFY");
      expect(getNextPhase("VERIFY")).toBe("REVIEW_VERIFY");
      expect(getNextPhase("REVIEW_VERIFY")).toBe("COMPLETE");
    });

    test("returns null for COMPLETE phase", () => {
      expect(getNextPhase("COMPLETE")).toBeNull();
    });
  });
});
