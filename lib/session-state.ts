/**
 * Session state management for the interactive agent experience.
 *
 * Handles persistence of session state to disk, allowing users to exit
 * and resume the interactive migration workflow.
 */

import { readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";

// ============================================================================
// TYPES
// ============================================================================

/**
 * The current phase of the interactive agent workflow.
 */
export type AgentPhase =
  | "WELCOME"
  | "AUDIT"
  | "REVIEW_AUDIT"
  | "PLAN"
  | "REVIEW_PLAN"
  | "GENERATE_WORKLIST"
  | "REVIEW_WORKLIST"
  | "EXECUTE"
  | "REVIEW_EXECUTE"
  | "VERIFY"
  | "REVIEW_VERIFY"
  | "COMPLETE";

/**
 * Session state persisted to disk for resumption across terminal sessions.
 */
export interface SessionState {
  /** SDK session ID for conversation context persistence */
  sessionId: string | null;
  /** Current phase in the workflow */
  currentPhase: AgentPhase;
  /** When the session was first started */
  startedAt: string;
  /** When the session was last updated */
  lastUpdatedAt: string;
  /** Path to the vault being processed */
  vaultPath: string;
  /** Phase completion flags */
  auditComplete: boolean;
  planComplete: boolean;
  worklistGenerated: boolean;
  /** Execute phase progress */
  executeBatchNumber: number;
  executeTotalBatches: number;
  verifyComplete: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SESSION_STATE_FILENAME = "interactive-session.json";

// ============================================================================
// FUNCTIONS
// ============================================================================

/**
 * Create a fresh session state for a new interactive session.
 */
export function createInitialState(vaultPath: string): SessionState {
  const now = new Date().toISOString();
  return {
    sessionId: null,
    currentPhase: "WELCOME",
    startedAt: now,
    lastUpdatedAt: now,
    vaultPath,
    auditComplete: false,
    planComplete: false,
    worklistGenerated: false,
    executeBatchNumber: 0,
    executeTotalBatches: 0,
    verifyComplete: false,
  };
}

/**
 * Load session state from disk.
 * Returns null if no session state file exists.
 */
export async function loadSessionState(dataPath: string): Promise<SessionState | null> {
  const statePath = join(dataPath, SESSION_STATE_FILENAME);
  try {
    const raw = await readFile(statePath, "utf-8");
    return JSON.parse(raw) as SessionState;
  } catch {
    // File doesn't exist or is invalid — return null
    return null;
  }
}

/**
 * Save session state to disk.
 */
export async function saveSessionState(dataPath: string, state: SessionState): Promise<void> {
  const statePath = join(dataPath, SESSION_STATE_FILENAME);
  const updated: SessionState = {
    ...state,
    lastUpdatedAt: new Date().toISOString(),
  };
  await writeFile(statePath, JSON.stringify(updated, null, 2), "utf-8");
}

/**
 * Remove session state file (for starting fresh).
 */
export async function clearSessionState(dataPath: string): Promise<void> {
  const statePath = join(dataPath, SESSION_STATE_FILENAME);
  try {
    await unlink(statePath);
  } catch {
    // File doesn't exist — that's fine
  }
}

/**
 * Get the human-readable name for a phase.
 */
export function getPhaseName(phase: AgentPhase): string {
  const names: Record<AgentPhase, string> = {
    WELCOME: "Welcome",
    AUDIT: "Audit",
    REVIEW_AUDIT: "Review Audit",
    PLAN: "Plan",
    REVIEW_PLAN: "Review Plan",
    GENERATE_WORKLIST: "Generate Worklist",
    REVIEW_WORKLIST: "Review Worklist",
    EXECUTE: "Execute",
    REVIEW_EXECUTE: "Review Execute",
    VERIFY: "Verify",
    REVIEW_VERIFY: "Review Verify",
    COMPLETE: "Complete",
  };
  return names[phase];
}

/**
 * Get the next phase in the workflow.
 * Returns null if current phase is COMPLETE.
 */
export function getNextPhase(currentPhase: AgentPhase): AgentPhase | null {
  const order: AgentPhase[] = [
    "WELCOME",
    "AUDIT",
    "REVIEW_AUDIT",
    "PLAN",
    "REVIEW_PLAN",
    "GENERATE_WORKLIST",
    "REVIEW_WORKLIST",
    "EXECUTE",
    "REVIEW_EXECUTE",
    "VERIFY",
    "REVIEW_VERIFY",
    "COMPLETE",
  ];
  const currentIndex = order.indexOf(currentPhase);
  if (currentIndex === -1 || currentIndex === order.length - 1) {
    return null;
  }
  return order[currentIndex + 1];
}
