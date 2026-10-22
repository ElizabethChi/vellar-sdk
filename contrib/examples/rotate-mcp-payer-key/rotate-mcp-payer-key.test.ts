import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockAgentKeyRuntime, runRotationDryRun } from "./rotate-mcp-payer-key";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("rotate-mcp-payer-key dry run (#681)", () => {
  it("executes the documented rotation sequence in order: mint new, overlap, revoke old, new survives, ledger resets", async () => {
    const log = vi.fn();
    const result = await runRotationDryRun(log);

    expect(result.mintHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.revokeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.oldKeyCouldSignBeforeRevoke).toBe(true);
    expect(result.bothKeysCouldSignDuringOverlap).toBe(true);
    expect(result.oldKeyRejectedAfterRevoke).toBe(true);
    expect(result.newKeyStillWorksAfterOldRevoked).toBe(true);
    expect(result.ledgerResetToZeroOnRestart).toBe(true);
    expect(log).toHaveBeenCalledWith("old key sign after revoke: rejected");
  });

  it("key failure mode: MockAgentKeyRuntime.sign rejects a key that was never minted or was already revoked", async () => {
    const runtime = new MockAgentKeyRuntime();
    const key = "G".padEnd(56, "Z");

    // Never minted at all.
    await expect(runtime.sign(key, "payload")).rejects.toThrow(/revoked or was never minted/);

    // Minted, then revoked — must reject the same way, not silently succeed.
    await runtime.addAgentKey({
      publicKey: key,
      grants: [{ token: "C".padEnd(56, "B"), policies: ["C".padEnd(56, "C")] }],
      store: "persistent",
    });
    await expect(runtime.sign(key, "payload")).resolves.toMatch(/^signed:/);
    await runtime.removeAgentKey(key);
    await expect(runtime.sign(key, "payload")).rejects.toThrow(/revoked or was never minted/);
  });

  it("runs end to end as a standalone Node process", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "vellar-rotate-mcp-payer-key-example-"));
    temporaryDirectories.push(outputDirectory);
    const output = join(outputDirectory, "rotate-mcp-payer-key.mjs");
    await build({
      entryPoints: [resolve("contrib/examples/rotate-mcp-payer-key/rotate-mcp-payer-key.ts")],
      outfile: output,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
    });

    const execution = await execFileAsync(process.execPath, [output]);
    expect(execution.stderr).toBe("");
    expect(execution.stdout).toContain("old key sign after revoke: rejected");
    expect(execution.stdout).toContain("new key still signs after old key's revoke: true");
    expect(execution.stdout).toContain(
      "complete: rotation sequence executed in documented order, old key dead, new key live",
    );
  });
});
