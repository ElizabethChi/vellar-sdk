# CLI output stability across Node versions (#683)

Reference implementation and snapshot tests proving the CLI's
human-readable text output (from `search`, `quote`, and `inspect`) is a
stable contract: line order, label text, fallback text, and conditional
line presence do not drift, including across the Node major versions this
repo supports.

## Files

- `render.ts`: `renderResource`, `renderChallenge`, and `renderTransaction`,
  duplicated here as pure, standalone functions matching the real
  rendering logic inline in `packages/cli/src/commands/{search,quote,inspect}.ts`.
  Given this folder has no dependency on `packages/cli`'s source, these are
  a reference to extract from, not a drop-in replacement; see Integration
  below.
- `render.test.ts`: inline snapshot tests covering full and minimal
  entries, multiple `accepts` options, missing-field fallbacks, description
  truncation, and the `payTo`/fee-sponsorship conditional lines.

## Run it standalone

```sh
npx vitest run contrib/cli-output-stability/render.test.ts
```

## What It Does

- Extracts each command's inline `console.log` sequence into a named, pure,
  exported function: `renderResource` (search), `renderChallenge` (quote),
  `renderTransaction` (inspect). No behavior change versus the inline
  version, just made testable.
- Snapshot tests pin the full text/line contract per function: full
  entries, minimal entries (every optional field absent), multiple
  `accepts` options, missing-field fallback text (`"unknown"`, `"?"`,
  placeholders), description truncation at 200 characters, and the
  conditional `payTo`/fee-sponsorship lines.
- Documents the stable-vs-free-to-change distinction: line order, label
  text, fallback text, and conditional line presence are the contract (and
  must be updated deliberately, together with the inline snapshot, when
  changed); ANSI styling, purely cosmetic whitespace, and stderr wording
  are not part of the contract.

## Integration into Core

1. In `packages/cli/src/commands/search.ts`, extract the inline
   `console.log` sequence inside the search action handler into an exported
   `renderResource(r: CatalogResource): string` matching the shape in
   `render.ts` here, then call it (`console.log(renderResource(r))`) from
   the handler instead of duplicating the logic inline.
2. Do the same in `packages/cli/src/commands/quote.ts` for
   `renderChallenge(url, challenge)` and
   `packages/cli/src/commands/inspect.ts` for
   `renderTransaction(tx, txHash)`, matching `pay.ts`'s existing pattern of
   exporting pure render helpers for testing.
3. Copy `render.test.ts`'s snapshot tests into each command's own test
   file (`search.test.ts`, `quote.test.ts`, `inspect.test.ts`), importing
   the now-exported function from the real command module instead of from
   this folder's `render.ts`.
4. Add a "Stable vs. free-to-change output" section to
   `packages/cli/README.md` documenting the contract described above.
5. Add a `cli-output-stability` job to `.github/workflows/ci.yml` running
   `npm test --workspace packages/cli` across a Node version matrix
   (`node-version: [20, 22]`, 20 being the oldest major
   `packages/cli/package.json`'s `engines.node` supports, 22 being the
   version the main `ci` job already validates this repo on), to catch a
   Node-version-dependent formatting drift (locale defaults,
   `Intl`/`toLocaleString` behavior, etc.) that a single-version run would
   miss.
