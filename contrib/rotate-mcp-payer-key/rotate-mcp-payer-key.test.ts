import { describe, expect, it, vi } from "vitest";
import { MockAgentKeyRuntime, runRotationDryRun } from "./rotate-mcp-payer-key";

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

    // Minted, then revoked, must reject the same way, not silently succeed.
    await runtime.addAgentKey({
      publicKey: key,
      grants: [{ token: "C".padEnd(56, "B"), policies: ["C".padEnd(56, "C")] }],
      store: "persistent",
    });
    await expect(runtime.sign(key, "payload")).resolves.toMatch(/^signed:/);
    await runtime.removeAgentKey(key);
    await expect(runtime.sign(key, "payload")).rejects.toThrow(/revoked or was never minted/);
  });
});
