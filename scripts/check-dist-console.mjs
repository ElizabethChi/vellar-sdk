#!/usr/bin/env node
// Scans the built dist/ bundle for console.log/debug/warn calls (#670).
//
// Why: src/payments-client.ts and src/x402-signer.ts sign and submit Stellar
// transactions. A stray debug console.log left in that path (or anywhere
// transitively bundled into it) would leak a signed transaction's XDR to
// every consumer's browser console — a realistic accidental regression
// during feature development, not a theoretical one. tsup bundles each
// entry point's full transitive closure into one file, so scanning the
// built output catches a leak regardless of which source file introduced
// it, rather than trying to scope a source-only scan to "signing code" and
// hoping nothing else pulls a console call in transitively.
//
// console.error is intentionally NOT scanned: surfacing an actual thrown
// error to the console (as opposed to logging debug/trace data) is normal,
// reviewed library behavior, not the leak this check guards against.
//
// Run manually: node scripts/check-dist-console.mjs
// Wired into CI in .github/workflows/ci.yml, after `npm run build` (the
// scan needs dist/ to exist; running it before the build step would either
// skip silently or scan a stale/missing directory).
//
// Pure scanning logic (scanContent/scanFiles) is exported for
// scripts/check-dist-console.test.ts to unit test directly against in-memory
// content, independent of a real dist/ build.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");

export const CONSOLE_METHODS = ["log", "debug", "warn"];
const CONSOLE_CALL_RE = new RegExp(`console\\.(${CONSOLE_METHODS.join("|")})\\s*\\(`, "g");

/**
 * Allowlist for an intentional, already-reviewed console call that's
 * expected to ship in dist/. Empty by default — the main SDK (unlike the
 * CLI or MCP payer packages, which are allowed to log) should never log
 * anything on its own. Add an entry only after explicit review, keyed by
 * the exact source line so a DIFFERENT call at the same file can't slip in
 * unnoticed under an existing allowlist entry.
 *
 * Shape: { file: "<dist file name>", line: "<exact trimmed source line>" }
 */
export const ALLOWLIST = [];

export function isAllowed(file, line, allowlist = ALLOWLIST) {
  return allowlist.some((entry) => entry.file === file && entry.line === line.trim());
}

/** Scans one file's already-read text content for unreviewed console calls. */
export function scanContent(file, content, allowlist = ALLOWLIST) {
  const lines = content.split("\n");
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!CONSOLE_CALL_RE.test(line)) continue;
    CONSOLE_CALL_RE.lastIndex = 0; // reset global regex state between lines
    if (isAllowed(file, line, allowlist)) continue;
    findings.push({ file, lineNumber: i + 1, line: line.trim() });
  }

  return findings;
}

function scanFile(file) {
  const filePath = path.join(distDir, file);
  const content = readFileSync(filePath, "utf8");
  return scanContent(file, content);
}

function main() {
  let distFiles;
  try {
    distFiles = readdirSync(distDir).filter((f) => f.endsWith(".js") || f.endsWith(".cjs"));
  } catch (err) {
    console.error(
      `check-dist-console: could not read "${distDir}" (${err.message}). Run "npm run build" first.`,
    );
    process.exit(1);
  }

  if (distFiles.length === 0) {
    console.error(`check-dist-console: no built .js/.cjs files found in "${distDir}".`);
    process.exit(1);
  }

  const allFindings = distFiles.flatMap(scanFile);

  if (allFindings.length > 0) {
    console.error(
      `\nFound ${allFindings.length} unreviewed console call(s) in the built dist bundle:\n`,
    );
    for (const f of allFindings) {
      console.error(`  ${f.file}:${f.lineNumber}  ${f.line}`);
    }
    console.error(
      "\nA console.log/debug/warn in the shipped bundle can leak sensitive data (e.g. a signed " +
        "transaction's XDR) to every consumer. If this call is intentional and already reviewed, " +
        "add it to ALLOWLIST in scripts/check-dist-console.mjs; otherwise remove it.",
    );
    process.exit(1);
  }

  console.log(`check-dist-console: scanned ${distFiles.length} file(s), no unreviewed console calls found.`);
}

// Only run when executed directly (`node scripts/check-dist-console.mjs`),
// not when imported by scripts/check-dist-console.test.ts — importing this
// module must never have the side effect of scanning a real dist/ or
// calling process.exit.
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? "")) {
  main();
}
