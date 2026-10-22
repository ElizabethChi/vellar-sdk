import { describe, expect, it } from "vitest";
import { renderResource, renderChallenge, renderTransaction } from "./render";

describe("renderResource (#683)", () => {
  it("full entry: resource, service name, multiple accepts, description, trust", () => {
    const text = renderResource({
      resource: "https://api.example.com/forecast",
      serviceName: "Weather API",
      accepts: [
        { scheme: "exact", network: "stellar", amount: "1000000", asset: "USDC" },
        { scheme: "exact", network: "stellar-testnet", amount: "500000", asset: "XLM" },
      ],
      description: "Hourly forecast data.",
      trust: { settlements: 42, uniquePayers: 7 },
    });

    expect(text).toMatchInlineSnapshot(`
      "https://api.example.com/forecast
        Weather API
        exact on stellar: 1000000 base units of USDC
        exact on stellar-testnet: 500000 base units of XLM
        Hourly forecast data.
        trust: 42 settlements, 7 unique payers"
    `);
  });

  it("minimal entry: every optional field absent falls back to placeholders", () => {
    const text = renderResource({});
    expect(text).toMatchInlineSnapshot(`"(no resource URL)"`);
  });

  it("missing-field fallbacks inside a single accepts entry", () => {
    const text = renderResource({ resource: "https://x", accepts: [{}] });
    expect(text).toMatchInlineSnapshot(`
      "https://x
        unknown on unknown: ? base units of ?"
    `);
  });

  it("description longer than 200 characters is truncated with an ellipsis", () => {
    const longDescription = "a".repeat(250);
    const text = renderResource({ resource: "https://x", description: longDescription });
    const lines = text.split("\n");
    expect(lines[1]).toBe(`  ${"a".repeat(200)}...`);
  });

  it("trust block is omitted entirely when both fields are absent", () => {
    const text = renderResource({ resource: "https://x", trust: {} });
    expect(text).not.toContain("trust:");
  });

  it("trust block renders zero explicitly when one field is present and the other is not", () => {
    const text = renderResource({ resource: "https://x", trust: { settlements: 3 } });
    expect(text).toContain("trust: 3 settlements, 0 unique payers");
  });
});

describe("renderChallenge (#683)", () => {
  it("full entry: single option with payTo and sponsored fees", () => {
    const text = renderChallenge("https://api.example.com/forecast", {
      accepts: [
        {
          scheme: "exact",
          network: "stellar",
          amount: "1000000",
          asset: "USDC",
          payTo: "GPAYEE...",
          extra: { areFeesSponsored: true },
        },
      ],
    });

    expect(text).toMatchInlineSnapshot(`
      "URL:    https://api.example.com/forecast
      Scheme: exact
      Network:stellar
      Amount: 1000000 (base units)
      Asset:  USDC
      Pay to: GPAYEE...
      Fees:   sponsored"
    `);
  });

  it("no payment options: reports the 402 carried none, nothing else", () => {
    const text = renderChallenge("https://x", { accepts: [] });
    expect(text).toMatchInlineSnapshot(`
      "URL:    https://x
      The 402 carried no payment options."
    `);
  });

  it("multiple accepts options each print an 'Option N:' header, including the first", () => {
    const text = renderChallenge("https://x", {
      accepts: [
        { scheme: "exact", network: "stellar", amount: "1", asset: "USDC" },
        { scheme: "exact", network: "stellar-testnet", amount: "2", asset: "XLM" },
      ],
    });

    expect(text).toContain("\nOption 1:");
    expect(text).toContain("\nOption 2:");
    const option1Index = text.indexOf("Option 1:");
    const option2Index = text.indexOf("Option 2:");
    expect(option1Index).toBeGreaterThan(-1);
    expect(option2Index).toBeGreaterThan(option1Index);
  });

  it("a single accepts option prints no 'Option N:' header at all", () => {
    const text = renderChallenge("https://x", {
      accepts: [{ scheme: "exact", network: "stellar", amount: "1", asset: "USDC" }],
    });
    expect(text).not.toContain("Option");
  });

  it("missing-field fallbacks render 'unknown' per field, not undefined or empty", () => {
    const text = renderChallenge("https://x", { accepts: [{}] });
    expect(text).toContain("Scheme: unknown");
    expect(text).toContain("Network:unknown");
    expect(text).toContain("Amount: unknown (base units)");
    expect(text).toContain("Asset:  unknown");
  });

  it("payTo line is omitted entirely when absent, not printed empty", () => {
    const text = renderChallenge("https://x", {
      accepts: [{ scheme: "exact", network: "stellar", amount: "1", asset: "USDC" }],
    });
    expect(text).not.toContain("Pay to:");
  });

  it("fees line reports NOT sponsored when areFeesSponsored is absent or false", () => {
    const text = renderChallenge("https://x", {
      accepts: [{ scheme: "exact", network: "stellar", amount: "1", asset: "USDC" }],
    });
    expect(text).toContain("Fees:   NOT sponsored");
  });
});

describe("renderTransaction (#683)", () => {
  it("full entry: all fields present, fee sponsored by a different account", () => {
    const text = renderTransaction(
      {
        hash: "abc123",
        successful: true,
        ledger: 12345,
        fee_charged: "100",
        source_account: "GSOURCE...",
        fee_account: "GSPONSOR...",
        created_at: "2026-01-01T00:00:00Z",
      },
      "abc123",
    );

    expect(text).toMatchInlineSnapshot(`
      "Hash:       abc123
      Successful: true
      Ledger:     12345
      Fee:        100 stroops
      Source:     GSOURCE...
      Fee acct:   GSPONSOR...
      Created:    2026-01-01T00:00:00Z

      Fee was paid by a different account than the transaction source
      (fee sponsorship shown on-chain, not asserted)."
    `);
  });

  it("minimal entry: tx.hash absent falls back to the passed-in txHash argument", () => {
    const text = renderTransaction({ successful: false }, "fallback-hash");
    expect(text.split("\n")[0]).toBe("Hash:       fallback-hash");
  });

  it("sponsorship note is omitted when fee_account equals source_account", () => {
    const text = renderTransaction(
      { source_account: "GSAME...", fee_account: "GSAME..." },
      "h",
    );
    expect(text).not.toContain("Fee was paid by a different account");
  });

  it("sponsorship note is omitted when either account field is absent", () => {
    const text = renderTransaction({ source_account: "GSOURCE..." }, "h");
    expect(text).not.toContain("Fee was paid by a different account");
  });
});
