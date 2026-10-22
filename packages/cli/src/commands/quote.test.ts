import { describe, expect, it } from "vitest";
import { decodeChallenge, makeQuoteCommand, renderChallenge } from "./quote.js";
import type { PaymentRequired } from "@x402/core/types";

const CHALLENGE = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "stellar:testnet",
      amount: "1000000",
      asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      payTo: "GAATVGLRHZXFC66GEN5QNKD56HC5JJZVHQ3P7ZJNVCCI4WKLN44FICSC",
      extra: { areFeesSponsored: true },
    },
  ],
};

describe("quote command", () => {
  it("is named 'quote' and takes one required url argument", () => {
    const cmd = makeQuoteCommand();
    expect(cmd.name()).toBe("quote");
    expect(cmd.registeredArguments).toHaveLength(1);
    expect(cmd.registeredArguments[0]?.required).toBe(true);
  });

  it("registers --json", () => {
    expect(makeQuoteCommand().options.find((o) => o.long === "--json")).toBeDefined();
  });
});

describe("decodeChallenge", () => {
  it("decodes a base64 PAYMENT-REQUIRED header", () => {
    const header = Buffer.from(JSON.stringify(CHALLENGE), "utf8").toString("base64");
    expect(decodeChallenge(header, "")?.accepts?.[0]?.amount).toBe("1000000");
  });

  it("accepts an unencoded JSON header", () => {
    expect(decodeChallenge(JSON.stringify(CHALLENGE), "")?.accepts).toHaveLength(1);
  });

  it("falls back to the body when the header is absent", () => {
    expect(decodeChallenge(null, JSON.stringify(CHALLENGE))?.accepts?.[0]?.scheme).toBe("exact");
  });

  it("prefers the header over the body", () => {
    const header = Buffer.from(JSON.stringify(CHALLENGE), "utf8").toString("base64");
    const body = JSON.stringify({ accepts: [{ scheme: "upto", amount: "999" }] });
    expect(decodeChallenge(header, body)?.accepts?.[0]?.scheme).toBe("exact");
  });

  it("returns null when neither source parses, rather than an empty challenge", () => {
    // Null is what makes the caller report an undecodable 402. An empty object
    // would read as "no payment options" and hide the real failure.
    expect(decodeChallenge("not-base64-or-json", "also not json")).toBeNull();
    expect(decodeChallenge(null, "")).toBeNull();
  });
});

/**
 * Stable-contract output format (#683). See packages/cli/README.md's
 * "Stable vs. free-to-change output" section.
 */
describe("renderChallenge — stable text contract", () => {
  it("renders a single payment option with all fields present", () => {
    const challenge = { ...CHALLENGE, resource: { url: "https://weather.example/forecast" } } as unknown as PaymentRequired;
    expect(renderChallenge("https://weather.example/forecast", challenge)).toMatchInlineSnapshot(`
      "URL:    https://weather.example/forecast
      Scheme: exact
      Network:stellar:testnet
      Amount: 1000000 (base units)
      Asset:  CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
      Pay to: GAATVGLRHZXFC66GEN5QNKD56HC5JJZVHQ3P7ZJNVCCI4WKLN44FICSC
      Fees:   sponsored

      No payment was made and nothing was signed by this call."
    `);
  });

  it("renders 'The 402 carried no payment options.' when accepts is empty", () => {
    const empty = {
      x402Version: 2,
      resource: { url: "https://empty.example" },
      accepts: [],
    } as unknown as PaymentRequired;
    expect(renderChallenge("https://empty.example", empty)).toMatchInlineSnapshot(
      `
      "URL:    https://empty.example
      The 402 carried no payment options."
    `,
    );
  });

  it("numbers each option and prints a blank line between them when there is more than one", () => {
    const multi = {
      x402Version: 2,
      resource: { url: "https://multi.example" },
      accepts: [
        { scheme: "exact", network: "stellar:testnet", amount: "100", asset: "XLM", extra: {} },
        { scheme: "upto", network: "stellar:testnet", amount: "50", asset: "USDC", extra: { areFeesSponsored: true } },
      ],
    } as unknown as PaymentRequired;
    expect(renderChallenge("https://multi.example", multi)).toMatchInlineSnapshot(`
      "URL:    https://multi.example

      Option 1:
      Scheme: exact
      Network:stellar:testnet
      Amount: 100 (base units)
      Asset:  XLM
      Fees:   NOT sponsored

      Option 2:
      Scheme: upto
      Network:stellar:testnet
      Amount: 50 (base units)
      Asset:  USDC
      Fees:   sponsored

      No payment was made and nothing was signed by this call."
    `);
  });

  it("omits the 'Pay to:' line when payTo is absent, and reports fees NOT sponsored by default", () => {
    const noPayTo = {
      x402Version: 2,
      resource: { url: "https://no-payto.example" },
      accepts: [{ scheme: "exact", network: "stellar:testnet", amount: "1", asset: "XLM" }],
    } as unknown as PaymentRequired;
    const rendered = renderChallenge("https://no-payto.example", noPayTo);
    expect(rendered).not.toContain("Pay to:");
    expect(rendered).toContain("Fees:   NOT sponsored");
  });

  it("falls back to 'unknown' for a missing scheme/network/amount/asset", () => {
    const partial = {
      x402Version: 2,
      resource: { url: "https://partial.example" },
      accepts: [{}],
    } as unknown as PaymentRequired;
    expect(renderChallenge("https://partial.example", partial)).toMatchInlineSnapshot(`
      "URL:    https://partial.example
      Scheme: unknown
      Network:unknown
      Amount: unknown (base units)
      Asset:  unknown
      Fees:   NOT sponsored

      No payment was made and nothing was signed by this call."
    `);
  });
});
