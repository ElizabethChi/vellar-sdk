import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const integration = process.env.VELLAR_MCP_PROTOCOL_INTEGRATION === "1" ? describe : describe.skip;

function textOf(result: unknown): string {
  return ((result as { content?: Array<{ type: string; text?: string }> }).content ?? [])
    .map(({ text }) => text ?? "")
    .join("\n");
}

integration("real MCP client protocol over stdio", () => {
  let client: Client;
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "vellar-mcp-client-"));
    const serverBundle = join(directory, "server-fixture.mjs");
    await build({
      entryPoints: [resolve("contrib/mcp-payer-hardening/mcp-stdio/server-fixture.ts")],
      outfile: serverBundle,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
    });

    client = new Client({ name: "claude-desktop-contract", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [serverBundle],
        env: { PATH: process.env.PATH ?? "" },
        stderr: "pipe",
      }),
    );
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("completes initialize and advertises tool capabilities", () => {
    expect(client.getServerVersion()).toEqual({ name: "vellar-x402-payer", version: "0.1.0" });
    expect(client.getServerCapabilities()?.tools).toBeDefined();
  });

  it("lists the exact schemas registered by server.ts", async () => {
    const { tools } = await client.listTools();
    const contracts = Object.fromEntries(
      tools.map((tool) => [
        tool.name,
        {
          properties: Object.keys(
            (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
          ).sort(),
          required: [
            ...((tool.inputSchema as { required?: string[] }).required ?? []),
          ].sort(),
        },
      ]),
    );

    expect(contracts).toEqual({
      x402_pay: {
        properties: ["max_amount", "resource_url"],
        required: ["max_amount", "resource_url"],
      },
      x402_pay_and_call: {
        properties: ["max_amount", "query"],
        required: ["max_amount", "query"],
      },
      x402_quote: { properties: ["resource_url"], required: ["resource_url"] },
      x402_session_budget: { properties: [], required: [] },
    });
  });

  it("calls a tool and reads the server result through the official client", async () => {
    const result = await client.callTool({
      name: "x402_quote",
      arguments: { resource_url: "https://seller.test/report" },
    });
    const text = textOf(result);

    expect(result.isError ?? false).toBe(false);
    expect(text).toContain("Payment required (HTTP 402)");
    expect(text).toContain("No payment was made and nothing was signed by this call.");
  });
});
