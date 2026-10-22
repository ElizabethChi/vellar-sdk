# Dist bundle console scan (#670)

Reference implementation and tests for a script that scans the built `dist/`
bundle for accidental `console.log`/`debug`/`warn` calls, so a stray debug
statement left in the signing path (or anywhere transitively bundled into it)
cannot leak a signed transaction's XDR to every consumer's browser console.

## Files

- `check-dist-console.mjs`: the scanner. Exports pure, filesystem-independent
  `scanContent`/`isAllowed` functions plus a `main()` CLI entry point that
  reads a directory of built `.js`/`.cjs` files and reports any unreviewed
  console call.
- `check-dist-console.test.ts`: unit tests against `scanContent`/`isAllowed`
  directly, covering the happy path, each flagged method, the intentionally
  unscanned `console.error`, multi-line findings, and allowlist exact-match
  semantics (including the same-file-different-line and
  different-file-same-line cases).
- `fixtures/clean-dist/`, `fixtures/leaky-dist/`: small example "built"
  bundles for a manual CLI run.

## Run it standalone

```sh
npx vitest run contrib/dist-console-scan/check-dist-console.test.ts
node contrib/dist-console-scan/check-dist-console.mjs contrib/dist-console-scan/fixtures/clean-dist
node contrib/dist-console-scan/check-dist-console.mjs contrib/dist-console-scan/fixtures/leaky-dist
```

The clean fixture exits 0. The leaky fixture exits 1 and reports the
`console.log` call with its file and line number.

## What It Does

- Scans every `.js`/`.cjs` file in a target directory (the real `dist/` once
  wired in) for `console.log`, `console.debug`, and `console.warn` calls.
- Does not scan `console.error`: surfacing a thrown error is normal, reviewed
  library behavior, not the accidental data leak this check guards against.
- Supports an `ALLOWLIST` keyed by exact file + trimmed source line, so an
  intentional, already-reviewed call can ship without suppressing a
  different, unreviewed call in the same file.

## Integration into Core

1. Copy `check-dist-console.mjs` to `scripts/check-dist-console.mjs`, with
   `distDir` pointing at the real build output (`path.resolve(__dirname,
   "..", "dist")`), and copy the test file to
   `scripts/check-dist-console.test.ts`.
2. Add an npm script, e.g. `"check:dist-console": "node scripts/check-dist-console.mjs"`.
3. Wire it into `.github/workflows/ci.yml` as a step that runs **after**
   `npm run build` (the scan needs `dist/` to exist; running it earlier would
   scan a stale or missing directory).
4. Before this is meaningful against this repo's real bundle, confirm `npm
   run build` succeeds cleanly. At the time this reference was written, two
   pre-existing, unrelated issues blocked a clean build and would need to be
   fixed first by a maintainer (neither is in scope for this issue, both are
   called out here so the integration step is not a surprise):
   - `src/x402-signer.ts` has a malformed docblock opener that breaks `npm
     run build` outright.
   - `src/tx-rpc.ts` calls a Stellar SDK method name that does not exist on
     the installed SDK version.
