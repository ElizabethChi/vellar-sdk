# Rotating a compromised MCP payer signer key

> A runbook for the `vellar-mcp-x402-payer` package (issue #231 tracks adding
> scoped session tokens as a longer-term fix; this covers rotating the one
> key that exists today).

`vellar-mcp-x402-payer` holds **exactly one key**, read once at startup from
`VELLAR_X402_SECRET` (or `VELLAR_X402_SECRET_FILE`) — see the package
[README](https://github.com/Vellar-Wallet/vellar-sdk/blob/main/packages/mcp-x402-payer/README.md#configure).
Which rotation steps apply depends on which of the two modes you're running:

- **Layer 1 only** (`VELLAR_X402_WALLET` unset): the key is a bare Stellar
  hot wallet (`G…`). There is no on-chain revocation for this key at all —
  it's an ordinary account, not a smart-account signer.
- **Layer 2** (`VELLAR_X402_WALLET` set): the key is an ed25519 **session
  key** minted onto a Vellar smart account via `wallet.agents.mint()`
  (`src/agents-facade.ts`), restricted by `SignerLimits` to specific token
  grants and co-signing policy contracts. This key CAN be revoked on-chain.

Do both halves below if you're on layer 2; only the hot-wallet half if you're
on layer 1.

## 0. Before you start

Note the current timestamp and the in-memory session ledger's state
(`x402_session_budget` tool, or the `vellar_x402_payment_spend_base_units_total`
/ `vellar_x402_session_ceiling_rejection_total` metrics if
`VELLAR_X402_METRICS_PORT` is set — see the README's Metrics section). You'll
want this for the reconciliation step later. The ledger (`src/ledger.ts`) is
**entirely in-process memory** — it is not written to disk or any external
store, and it already resets on every process restart, which a rotation
necessarily causes.

## 1. Provision the new signer key

```ts
import { Keypair } from "@stellar/stellar-sdk";
const newKey = Keypair.random();
// newKey.publicKey() -> G...
// newKey.secret()    -> S...  (store this; it becomes the new VELLAR_X402_SECRET)
```

The SDK never generates or stores this for you (`src/agents-facade.ts`'s own
comment: "Generate the keypair yourself... the SDK never sees or stores the
secret") — generate it with a fresh `Keypair.random()` on a machine you trust,
and get the secret into your secret manager (or
`VELLAR_X402_SECRET_FILE`'s target path) by the same channel you'd use for any
other credential rotation. Never paste it into a chat with the agent this
server serves — it is server config, never a tool argument, for exactly this
reason.

**Layer 2 only** — before minting, decide the new key's grants and policies.
If you're rotating because of a suspected compromise rather than routine
hygiene, this is also the moment to tighten them (narrower token grants, a
lower spending-limit policy ceiling) rather than reproducing whatever the
compromised key had.

```ts
await wallet.agents.mint({
  publicKey: newKey.publicKey(),
  grants: [
    { token: usdcContractId, policies: [spendingLimitPolicyId, verifiedOnlyPolicyId] },
  ],
  // expiresAt: optional — see MintAgentInput in src/agents-facade.ts
});
```

This is passkey-signed (one prompt) and is a **real on-chain transaction**: it
does not take effect until it's confirmed. Wait for confirmation before
proceeding — starting the server with the new key before the mint settles
just produces failed signing attempts, not a security gap, but it wastes the
time you're trying not to waste during an incident.

## 2. Update configuration and restart

Set `VELLAR_X402_SECRET` (or `VELLAR_X402_SECRET_FILE`) to the new key and
restart the server process. There is no in-place hot-swap: the secret is read
once at startup (`src/config.ts`'s `loadConfig`), and `src/bin.ts` builds the
signer from it a single time before connecting the stdio transport. A
restart is the only way this server picks up a new key.

If you're also changing `VELLAR_X402_WALLET`, `VELLAR_X402_POLICIES`, or
asset ceilings (`VELLAR_X402_ASSETS`) as part of this rotation, change them
in the same restart — don't do a partial restart with the old wallet/policies
and the new key, or vice versa; the README's own startup validation will
reject some but not all mismatched combinations (e.g. policies set without a
wallet fails fast; a wallet whose signer doesn't actually have the new key
registered does not fail at startup — it fails at the first payment attempt,
on-chain, which is a worse time to discover it).

## 3. Revoke the old key on-chain (layer 2 only)

**This is the step that actually stops a compromised layer-2 key from
spending.** Restarting the server with a new key does not revoke the old
one — the old key remains a valid signer on the smart account until you
explicitly remove it, and whoever holds the compromised secret can still
sign with it directly against the chain, bypassing this server entirely.

```ts
await wallet.agents.revoke(oldKey.publicKey());
```

Per `src/agents-facade.ts`'s own comment: "On-chain removal is the remote
kill: the key stops signing immediately." This is passkey-signed, same as
minting. Do this **as soon as the new key is confirmed minted** — the window
between minting the new key and revoking the old one is the window in which
both are valid signers, so keep it short.

**Layer 1 (hot wallet) has no equivalent step.** The old key is an ordinary
Stellar account, not a smart-account signer — there is nothing to "revoke" on
it. If it's compromised, the only real mitigation is moving its funds to a
different account before an attacker does, and then simply never configuring
this server with that key again. Fund hot-wallet keys with only what you are
willing to lose, for exactly this reason (see the README's "Read this before
you trust it with money" section).

## 4. Reconcile the spend ledger

The in-memory session ledger (`src/ledger.ts`) resets to zero spend on every
restart — rotation does not need to "carry it forward" in any special way,
because there is nothing durable to carry. What you lose on restart is purely
the **in-process view** of this session's spend so far; it was never a
record of on-chain reality, only a guard against this process paying more
than its configured ceiling within one run (see `ledger.ts`'s own module
comment: "WHAT THIS IS NOT: a security boundary... resets when that process
restarts").

If you need the TRUE cumulative spend across the rotation (e.g. to decide
whether this incident's spending stayed within what you'd authorize, or to
report it), that lives on-chain, not in this ledger:

- Query the old key's (or old smart account's) transaction history via
  Horizon/the Soroban RPC for the incident window.
- Compare against what the new process's ledger reports from the restart
  forward — the two together are the full picture; neither alone is.

There is no ledger "migration" step, because the ledger was never meant to
survive a restart in the first place — do not build one. A rotation that
tries to preserve the old ledger's counts into the new process would also
carry forward any corrupted/compromised-session accounting, which defeats
the point of rotating.

## 5. Confirm the rotation took

- Restart log line (`log("info", "vellar x402 payer ready", ...)`) reports
  the new `payer` address matching the new key's public key.
- `x402_session_budget` reports ceilings reset to zero spent (expected — see
  step 4).
- **Layer 2**: a `wallet.agents.revoke()` for the old key succeeded (check
  the returned transaction hash on-chain), and a payment attempt signed
  directly with the old key against the smart account now fails
  `__check_auth` — this is the actual proof the compromised key is dead, not
  just that the server stopped using it.
- If `VELLAR_X402_METRICS_PORT` is set, `vellar_x402_payment_success_total`
  starts incrementing again on the next real payment, confirming the new key
  can actually sign and settle, not just that the process restarted cleanly.
