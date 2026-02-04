import { join } from "path";

export type AgentMode = "audit" | "plan" | "generate-worklist" | "execute" | "verify" | "interactive";

export interface Config {
  vaultPath: string;
  dataPath: string;
  agentMode: AgentMode;
  batchSize: number;
  maxBudgetUsd: number;
  agentModel: string;
  /** Path to the session state file for interactive mode */
  sessionStatePath: string;
}

const VALID_MODES: AgentMode[] = ["audit", "plan", "generate-worklist", "execute", "verify", "interactive"];

export function loadConfig(): Config {
  const vaultPath = process.env.VAULT_PATH;
  if (!vaultPath) {
    throw new Error("VAULT_PATH environment variable is required");
  }

  const modeRaw = process.env.AGENT_MODE || "audit";
  if (!VALID_MODES.includes(modeRaw as AgentMode)) {
    throw new Error(`Invalid AGENT_MODE: "${modeRaw}". Must be one of: ${VALID_MODES.join(", ")}`);
  }

  const batchSize = parseInt(process.env.BATCH_SIZE || "50", 10);
  if (isNaN(batchSize) || batchSize < 1) {
    throw new Error(`Invalid BATCH_SIZE: "${process.env.BATCH_SIZE}". Must be a positive integer.`);
  }

  const maxBudgetUsd = parseFloat(process.env.MAX_BUDGET_USD || "1.00");
  if (isNaN(maxBudgetUsd) || maxBudgetUsd <= 0) {
    throw new Error(`Invalid MAX_BUDGET_USD: "${process.env.MAX_BUDGET_USD}". Must be a positive number.`);
  }

  // Compute data path relative to project root
  // import.meta.dir is Bun-specific; fallback to process.cwd() for other environments
  const projectRoot = (import.meta as { dir?: string }).dir
    ? join((import.meta as { dir: string }).dir, "..")
    : process.cwd();
  const dataPath = join(projectRoot, "data");

  return {
    vaultPath,
    dataPath,
    agentMode: modeRaw as AgentMode,
    batchSize,
    maxBudgetUsd,
    agentModel: process.env.AGENT_MODEL || "claude-sonnet-4-20250514",
    sessionStatePath: join(dataPath, "interactive-session.json"),
  };
}
