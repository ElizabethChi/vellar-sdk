# vellar-cli

Command-line tool for discovering, quoting, paying for, and inspecting
[x402](https://x402.org) resources on Stellar.

Every command supports `--json` for machine-readable output.

## Install

```sh
npm install -g vellar-cli
```

## Commands

### `vellar search <query>`

Search the Vellar Bazaar for payable resources.

```sh
vellar search "motivational quote"
vellar search "lorem ipsum" --limit 5 --json
```

Prints the resource URL, its price per accepted scheme, and the trust block.
`settlements` and `uniquePayers` are counted from observed on-chain activity, so
they are the only fields in a listing a seller cannot write themselves.

### `vellar quote <url>`

Check the price of a resource without paying. One HTTP request: nothing is
signed and no key is read.

```sh
vellar quote https://vellar-seller-demo.onrender.com/quote
```

Every payment option in the challenge is printed, including whether fees are
sponsored. Without sponsorship the payer needs XLM of its own.

### `vellar pay <url>`

Pay for a resource and print the content.

```sh
vellar pay https://vellar-seller-demo.onrender.com/quote \
  --secret-file ~/.vellar/key \
  --max 1000000
```

`--max` is a hard ceiling in the asset's base units. Stellar Asset Contracts use
7 decimals, so `1000000` is 0.1 units. The payment is refused, unsigned, if the
price exceeds `--max`, if the seller offers no `exact` option on the chosen
network, or if the seller does not advertise sponsored fees.

Only the `exact` scheme is payable from a classic keypair. An `upto`-only seller
is reported rather than half-attempted.

> **Prefer `--secret-file`.** A secret passed as `--secret` lands in shell
> history and is visible in the process table. `VELLAR_SECRET` works too, and
> keeps it off the command line.

Roughly one testnet settlement in three fails with an empty `transaction` field,
which means nothing was spent and a fresh attempt is safe. A non-empty
`transaction` means fees were charged: do not retry.

### `vellar inspect <tx-hash>`

Look up a Stellar transaction by hash.

```sh
vellar inspect be33bb71b0a2c74c465bf0243c45e081bc7c5b66a337e2d8a5c0bbb82f54ede6
```

Prints the hash, success flag, ledger, fee charged, source account, and fee
account. On a sponsored settlement the source and fee accounts differ and the
buyer appears in neither, which is fee sponsorship shown on-chain rather than
asserted.

## Stable vs. free-to-change output

`--json` output is a stable contract today, covered by its own existing
tests. The **human-readable text** output (what `search`, `quote`, and
`inspect` print without `--json`) is ALSO a stable contract, for the same
reason: a script that greps or parses it (e.g. `vellar inspect <hash> | grep
Successful`) relies on the exact text shown, not just the underlying data.

What counts as part of that contract, snapshot-tested in
`src/commands/{search,quote,inspect}.test.ts` via `renderResource`,
`renderChallenge`, and `renderTransaction`:

- Line order and the literal label text (`Hash:`, `Scheme:`, etc, including
  their exact column alignment/padding).
- Fallback text for a missing field (`unknown`, `(no resource URL)`).
- Which lines are omitted entirely when a field is absent (e.g. no `Pay to:`
  line when `payTo` is unset; no fee-sponsorship note when the fee and
  source accounts match).
- The 200-character description truncation marker in `search`.

What is explicitly NOT part of the contract, and may change without a
`closes`-worthy breaking-change note:

- Color/ANSI styling, if any is added later.
- Whitespace purely cosmetic to a human reader that no existing snapshot
  pins (e.g. an extra blank line added between unrelated sections, as long
  as no snapshot already asserts its absence).
- Error message wording on stderr (`console.error` paths), these are for a
  human operator, not for scripting against; script against the exit code
  instead.
- The `console.log`/`console.error` call sites themselves, versus some other
  future I/O mechanism, as long as the printed TEXT is unchanged.

A change to anything in the first list must update the corresponding inline
snapshot deliberately (`toMatchInlineSnapshot`, run with `vitest run -u` to
accept a new snapshot), CI fails on the diff otherwise, and the PR
description should say why the format changed. Snapshot tests run across
the oldest Node major this package supports (`engines.node` in
`package.json`) and the newest this repo's CI already validates, in a
dedicated CI job, so a Node-version-dependent formatting drift (locale
defaults, `toLocaleString` behavior, etc) is caught too.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `VELLAR_FACILITATOR_URL` | Facilitator base URL (default: the hosted instance) |
| `VELLAR_SECRET` | Payer secret key, used by `pay` when no flag is given |
| `VELLAR_NETWORK` | `testnet` (default) or `mainnet` |

## Notes

Vellar runs on `stellar:testnet` only. The hosted facilitator sleeps after 15
minutes idle, so the first call after a sleep takes roughly 45 seconds.

Debug a paid route with `GET`, never `HEAD`: a `HEAD` request carries no payment
challenge, so a correctly wired paid route looks free.

## License

Apache-2.0
