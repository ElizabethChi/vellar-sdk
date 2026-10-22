import { describe, expect, it } from "vitest";
import { scanContent, isAllowed } from "./check-dist-console.mjs";

describe("check-dist-console: scanContent (#670)", () => {
  it("happy path: finds no findings in clean content", () => {
    const content = [
      "export function foo() {",
      "  return 1;",
      "}",
    ].join("\n");

    expect(scanContent("index.js", content)).toEqual([]);
  });

  it("flags a console.log call with the correct file/line/text", () => {
    const content = [
      "export function sign(xdr) {",
      '  console.log("signed:", xdr);',
      "  return xdr;",
      "}",
    ].join("\n");

    const findings = scanContent("index.js", content);
    expect(findings).toEqual([
      { file: "index.js", lineNumber: 2, line: 'console.log("signed:", xdr);' },
    ]);
  });

  it("flags console.debug and console.warn, matching CONSOLE_METHODS", () => {
    const content = [
      'console.debug("debug trace");',
      'console.warn("a warning");',
    ].join("\n");

    const findings = scanContent("index.cjs", content);
    expect(findings).toHaveLength(2);
    expect(findings[0]!.line).toContain("console.debug");
    expect(findings[1]!.line).toContain("console.warn");
  });

  it("does NOT flag console.error — surfacing a thrown error is normal, reviewed behavior", () => {
    const content = 'console.error("submission failed:", err);';
    expect(scanContent("index.js", content)).toEqual([]);
  });

  it("flags multiple console calls across multiple lines, each with its own line number", () => {
    const content = [
      'console.log("a");',
      "const x = 1;",
      'console.log("b");',
      "const y = 2;",
      'console.log("c");',
    ].join("\n");

    const findings = scanContent("index.js", content);
    expect(findings.map((f) => f.lineNumber)).toEqual([1, 3, 5]);
  });

  it("does not flag a console call allowlisted for that exact file + line", () => {
    const content = 'console.warn("reviewed, intentional warning");';
    const allowlist = [
      { file: "index.js", line: 'console.warn("reviewed, intentional warning");' },
    ];

    expect(scanContent("index.js", content, allowlist)).toEqual([]);
  });

  it("does NOT suppress a different console call at the same allowlisted file", () => {
    // An allowlist entry is keyed by file AND the exact line text — a
    // different, unreviewed call in the same file must still be flagged.
    const content = [
      'console.warn("reviewed, intentional warning");',
      'console.log("a NEW, unreviewed call");',
    ].join("\n");
    const allowlist = [
      { file: "index.js", line: 'console.warn("reviewed, intentional warning");' },
    ];

    const findings = scanContent("index.js", content, allowlist);
    expect(findings).toEqual([
      { file: "index.js", lineNumber: 2, line: 'console.log("a NEW, unreviewed call");' },
    ]);
  });

  it("does NOT suppress the same allowlisted line text in a DIFFERENT file", () => {
    const content = 'console.warn("reviewed, intentional warning");';
    const allowlist = [
      { file: "balances.js", line: 'console.warn("reviewed, intentional warning");' },
    ];

    // Allowlisted for balances.js, not index.js — must still be flagged here.
    expect(scanContent("index.js", content, allowlist)).toHaveLength(1);
  });

  it("trims whitespace when matching against the allowlist", () => {
    const content = '    console.warn("reviewed, intentional warning");  ';
    const allowlist = [
      { file: "index.js", line: 'console.warn("reviewed, intentional warning");' },
    ];

    expect(scanContent("index.js", content, allowlist)).toEqual([]);
  });

  it("does not false-positive on an unrelated identifier containing 'console'", () => {
    const content = "const consoleHelper = getConsoleHelper();";
    expect(scanContent("index.js", content)).toEqual([]);
  });
});

describe("check-dist-console: isAllowed (#670)", () => {
  it("returns false for an empty allowlist", () => {
    expect(isAllowed("index.js", 'console.log("x");', [])).toBe(false);
  });

  it("returns true only for an exact file + trimmed-line match", () => {
    const allowlist = [{ file: "index.js", line: 'console.log("x");' }];
    expect(isAllowed("index.js", '  console.log("x");  ', allowlist)).toBe(true);
    expect(isAllowed("index.js", 'console.log("y");', allowlist)).toBe(false);
    expect(isAllowed("other.js", 'console.log("x");', allowlist)).toBe(false);
  });
});
