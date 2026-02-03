export type AgentMode = "audit" | "plan" | "generate-worklist" | "execute" | "verify";

export interface Config {
  vaultPath: string;
  agentMode: AgentMode;
  batchSize: number;
  maxBudgetUsd: number;
  agentModel: string;
}

const VALID_MODES: AgentMode[] = ["audit", "plan", "generate-worklist", "execute", "verify"];

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

  return {
    vaultPath,
    agentMode: modeRaw as AgentMode,
    batchSize,
    maxBudgetUsd,
    agentModel: process.env.AGENT_MODEL || "claude-sonnet-4-20250514",
  };
}
