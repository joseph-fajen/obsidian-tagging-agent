import { describe, test, expect } from "bun:test";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { createVaultTools } from "../tools/vault-tools.js";
import { createTagTools } from "../tools/tag-tools.js";
import { createGitTools } from "../tools/git-tools.js";

describe("tool creation", () => {
  test("createVaultTools returns 4 tools", () => {
    const tools = createVaultTools("/tmp/dummy-vault");
    expect(tools).toHaveLength(4);
  });

  test("createTagTools returns 4 tools", () => {
    const tools = createTagTools("/tmp/dummy-vault", "/tmp/dummy-data");
    expect(tools).toHaveLength(4);
  });

  test("createGitTools returns 1 tool", () => {
    const tools = createGitTools("/tmp/dummy-vault");
    expect(tools).toHaveLength(1);
  });
});

describe("MCP server assembly", () => {
  test("createSdkMcpServer succeeds with all tools", () => {
    const vaultTools = createVaultTools("/tmp/dummy-vault");
    const tagTools = createTagTools("/tmp/dummy-vault", "/tmp/dummy-data");
    const gitTools = createGitTools("/tmp/dummy-vault");

    const server = createSdkMcpServer({
      name: "vault-tagging",
      version: "1.0.0",
      tools: [...vaultTools, ...tagTools, ...gitTools],
    });

    expect(server).toBeDefined();
    expect(server.name).toBe("vault-tagging");
    expect(server.type).toBe("sdk");
  });
});
