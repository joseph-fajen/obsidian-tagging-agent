import { describe, test, expect } from "bun:test";
import { transitionState } from "../lib/interactive-agent.js";
import {
  createInitialState,
  type SessionState,
  type AgentPhase,
} from "../lib/session-state.js";

describe("interactive-agent state transitions", () => {
  describe("transitionState", () => {
    test("returns same state when user chooses exit", () => {
      const state = createInitialState("/test/vault");
      state.currentPhase = "AUDIT";

      const result = transitionState(state, "exit", true);
      expect(result.currentPhase).toBe("AUDIT");
    });

    test("returns same state when user chooses review", () => {
      const state = createInitialState("/test/vault");
      state.currentPhase = "AUDIT";

      const result = transitionState(state, "review", true);
      expect(result.currentPhase).toBe("AUDIT");
    });

    test("returns same state when phase failed", () => {
      const state = createInitialState("/test/vault");
      state.currentPhase = "AUDIT";

      const result = transitionState(state, "continue", false);
      expect(result.currentPhase).toBe("AUDIT");
    });

    test("transitions from WELCOME to AUDIT", () => {
      const state = createInitialState("/test/vault");
      expect(state.currentPhase).toBe("WELCOME");

      const result = transitionState(state, "continue", true);
      expect(result.currentPhase).toBe("AUDIT");
    });

    test("transitions from AUDIT to PLAN", () => {
      const state = createInitialState("/test/vault");
      state.currentPhase = "AUDIT";

      const result = transitionState(state, "continue", true);
      expect(result.currentPhase).toBe("PLAN");
      expect(result.auditComplete).toBe(true);
    });

    test("transitions from PLAN to GENERATE_WORKLIST", () => {
      const state = createInitialState("/test/vault");
      state.currentPhase = "PLAN";

      const result = transitionState(state, "continue", true);
      expect(result.currentPhase).toBe("GENERATE_WORKLIST");
      expect(result.planComplete).toBe(true);
    });

    test("transitions from GENERATE_WORKLIST to EXECUTE", () => {
      const state = createInitialState("/test/vault");
      state.currentPhase = "GENERATE_WORKLIST";

      const result = transitionState(state, "continue", true);
      expect(result.currentPhase).toBe("EXECUTE");
      expect(result.worklistGenerated).toBe(true);
    });

    test("transitions from EXECUTE to VERIFY", () => {
      const state = createInitialState("/test/vault");
      state.currentPhase = "EXECUTE";

      const result = transitionState(state, "continue", true);
      expect(result.currentPhase).toBe("VERIFY");
    });

    test("transitions from VERIFY to COMPLETE", () => {
      const state = createInitialState("/test/vault");
      state.currentPhase = "VERIFY";

      const result = transitionState(state, "continue", true);
      expect(result.currentPhase).toBe("COMPLETE");
      expect(result.verifyComplete).toBe(true);
    });

    test("stays at COMPLETE when already complete", () => {
      const state = createInitialState("/test/vault");
      state.currentPhase = "COMPLETE";

      const result = transitionState(state, "continue", true);
      expect(result.currentPhase).toBe("COMPLETE");
    });

    test("preserves other state fields during transition", () => {
      const state = createInitialState("/test/vault");
      state.currentPhase = "EXECUTE";
      state.sessionId = "test-session-123";
      state.auditComplete = true;
      state.planComplete = true;
      state.worklistGenerated = true;
      state.executeBatchNumber = 5;

      const result = transitionState(state, "continue", true);
      expect(result.sessionId).toBe("test-session-123");
      expect(result.auditComplete).toBe(true);
      expect(result.planComplete).toBe(true);
      expect(result.worklistGenerated).toBe(true);
      expect(result.executeBatchNumber).toBe(5);
    });
  });

  describe("full workflow transitions", () => {
    test("complete workflow follows expected order", () => {
      let state = createInitialState("/test/vault");

      const expectedOrder: AgentPhase[] = [
        "WELCOME",
        "AUDIT",
        "PLAN",
        "GENERATE_WORKLIST",
        "EXECUTE",
        "VERIFY",
        "COMPLETE",
      ];

      for (let i = 0; i < expectedOrder.length - 1; i++) {
        expect(state.currentPhase).toBe(expectedOrder[i]);
        state = transitionState(state, "continue", true);
      }

      expect(state.currentPhase).toBe("COMPLETE");
    });

    test("all completion flags are set after full workflow", () => {
      let state = createInitialState("/test/vault");

      // Run through all phases
      while (state.currentPhase !== "COMPLETE") {
        state = transitionState(state, "continue", true);
      }

      expect(state.auditComplete).toBe(true);
      expect(state.planComplete).toBe(true);
      expect(state.worklistGenerated).toBe(true);
      expect(state.verifyComplete).toBe(true);
    });
  });
});
