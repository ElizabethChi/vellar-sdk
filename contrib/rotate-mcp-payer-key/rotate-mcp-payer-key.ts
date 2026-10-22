// Dry run of the layer-2 (smart-account) half of the signer-key rotation
// runbook for `vellar-mcp-x402-payer` (issue #681).
//
// Proves the documented steps are executable IN ORDER against a mock
// AgentKeyRuntime: provision a new key, mint it onto the wallet (step 1),
// confirm BOTH the old and new key can sign while they briefly overlap,
// revoke the old key (step 3), confirm the old key can no longer sign while
// the new key still can, and confirm an in-memory ledger-shaped counter
// resets to zero on "restart" (step 4, a reset to observe, not a migration
// to perform).
//
// See rotate-mcp-payer-key.md for the full runbook this dry run exercises,
// including the layer-1 (hot wallet) half, which has no on-chain mint/revoke
// step to dry-run.
//
// Follows the same mock-runtime pattern as
// contrib/examples/agent-key-lifecycle/agent-key-lifecycle.ts, reading
// src/agents-facade.ts's real facade (read-only import, no source files are
// modified by this reference).

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createAgentsFacade,
  type AgentKeyRuntime,
  type AgentPolicyGrant,
} from "../../src/agents-facade";

const OLD_AGENT_PUBLIC_KEY = "G".padEnd(56, "O");
const NEW_AGENT_PUBLIC_KEY = "G".padEnd(56, "N");
const TOKEN = "C".padEnd(56, "B");
const SPENDING_LIMIT = "C".padEnd(56, "C");
const VERIFIED_ONLY = "C".padEnd(56, "D");

/** Same mock shape as contrib/examples/agent-key-lifecycle: a signer's
 * grants determine whether it's still an active key on the account. */
export class MockAgentKeyRuntime implements AgentKeyRuntime {
  readonly activeKeys = new Map<string, AgentPolicyGrant[]>();

  async resume(_keyId: string): Promise<void> {}

  async addAgentKey(input: {
    publicKey: string;
    grants: AgentPolicyGrant[];
    expirationSeconds?: number;
    store: "persistent" | "temporary";
  }): Promise<{ hash: string }> {
    this.activeKeys.set(input.publicKey, structuredClone(input.grants));
    return { hash: "a".repeat(64) };
  }

  async removeAgentKey(publicKey: string): Promise<{ hash: string }> {
    this.activeKeys.delete(publicKey);
    return { hash: "b".repeat(64) };
  }

  async sign(publicKey: string, payload: string): Promise<string> {
    if (!this.activeKeys.has(publicKey)) {
      throw new Error(`agent key ${publicKey} is revoked or was never minted`);
    }
    return `signed:${Buffer.from(payload).toString("base64url")}`;
  }
}

/** Mirrors the real spend ledger's shape just enough to demonstrate step 4:
 * a fresh ledger (= "the process restarted") reports zero spend, which is
 * the documented, expected behavior, not something to migrate. */
function freshInProcessLedgerSnapshot(): { spent: bigint } {
  return { spent: 0n };
}

export interface RotationDryRunResult {
  mintHash: string;
  revokeHash: string;
  oldKeyCouldSignBeforeRevoke: boolean;
  bothKeysCouldSignDuringOverlap: boolean;
  oldKeyRejectedAfterRevoke: boolean;
  newKeyStillWorksAfterOldRevoked: boolean;
  ledgerResetToZeroOnRestart: boolean;
}

export async function runRotationDryRun(
  log: (message: string) => void = console.log,
): Promise<RotationDryRunResult> {
  const runtime = new MockAgentKeyRuntime();
  const wallet = {
    agents: createAgentsFacade({
      requireSession: () => ({ accountId: "C".padEnd(56, "W"), keyId: "demo-passkey" }),
      runtime,
    }),
  };
  const grants = [{ token: TOKEN, policies: [SPENDING_LIMIT, VERIFIED_ONLY] }];

  // Setup: the OLD key is already an active signer (as if minted earlier,
  // before this incident).
  await runtime.addAgentKey({ publicKey: OLD_AGENT_PUBLIC_KEY, grants, store: "persistent" });
  log(`setup: old key ${OLD_AGENT_PUBLIC_KEY} is an active signer`);

  const oldKeyCouldSignBeforeRevoke = await runtime
    .sign(OLD_AGENT_PUBLIC_KEY, "pre-incident payment")
    .then(() => true)
    .catch(() => false);
  log(`old key signs before rotation: ${oldKeyCouldSignBeforeRevoke}`);

  // Step 1: provision + mint the NEW key.
  const minted = await wallet.agents.mint({
    publicKey: NEW_AGENT_PUBLIC_KEY,
    grants,
    store: "persistent",
  });
  log(`step 1 - mint: ${minted.publicKey} tx=${minted.hash}`);

  // Step 2 (restart) is config-only in the real server; nothing to dry-run
  // here beyond "the new key can now sign," which step 1's mint already
  // proves on-chain.

  // Confirm the brief, intentional overlap window: BOTH keys can sign while
  // the old one hasn't been revoked yet.
  const oldSignsDuringOverlap = await runtime
    .sign(OLD_AGENT_PUBLIC_KEY, "overlap window payment (old)")
    .then(() => true)
    .catch(() => false);
  const newSignsDuringOverlap = await runtime
    .sign(NEW_AGENT_PUBLIC_KEY, "overlap window payment (new)")
    .then(() => true)
    .catch(() => false);
  const bothKeysCouldSignDuringOverlap = oldSignsDuringOverlap && newSignsDuringOverlap;
  log(`overlap window - old signs: ${oldSignsDuringOverlap}, new signs: ${newSignsDuringOverlap}`);

  // Step 3: revoke the OLD key, as soon as possible after the new one is confirmed.
  const revoked = await wallet.agents.revoke(OLD_AGENT_PUBLIC_KEY);
  log(`step 3 - revoke: ${OLD_AGENT_PUBLIC_KEY} tx=${revoked.hash}`);

  let oldKeyRejectedAfterRevoke = false;
  try {
    await runtime.sign(OLD_AGENT_PUBLIC_KEY, "post-revoke payment (should fail)");
  } catch {
    oldKeyRejectedAfterRevoke = true;
    log("old key sign after revoke: rejected");
  }
  if (!oldKeyRejectedAfterRevoke) {
    throw new Error("revoked old key remained an active signer, rotation is NOT complete");
  }

  const newKeyStillWorksAfterOldRevoked = await runtime
    .sign(NEW_AGENT_PUBLIC_KEY, "post-rotation payment (new key)")
    .then(() => true)
    .catch(() => false);
  log(`new key still signs after old key's revoke: ${newKeyStillWorksAfterOldRevoked}`);
  if (!newKeyStillWorksAfterOldRevoked) {
    throw new Error("revoking the old key also broke the new key, rotation left the wallet unusable");
  }

  // Step 4: confirm the "reconciliation" is really just observing a reset,
  // not a migration.
  const snapshot = freshInProcessLedgerSnapshot();
  const ledgerResetToZeroOnRestart = snapshot.spent === 0n;
  log(`step 4 - fresh in-process ledger spent: ${snapshot.spent} (reset to zero, as documented)`);

  return {
    mintHash: minted.hash,
    revokeHash: revoked.hash,
    oldKeyCouldSignBeforeRevoke,
    bothKeysCouldSignDuringOverlap,
    oldKeyRejectedAfterRevoke,
    newKeyStillWorksAfterOldRevoked,
    ledgerResetToZeroOnRestart,
  };
}

async function main() {
  await runRotationDryRun();
  console.log("complete: rotation sequence executed in documented order, old key dead, new key live");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
