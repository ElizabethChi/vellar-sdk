import { describe, expect, it } from "vitest";
import { HORIZON_URLS, makeInspectCommand, renderTransaction, type HorizonTransaction } from "./inspect.js";

function optionFor(flags: string) {
  return makeInspectCommand().options.find((o) => o.long === flags);
}

describe("inspect command", () => {
  it("is named 'inspect' and takes one required hash argument", () => {
    const cmd = makeInspectCommand();
    expect(cmd.name()).toBe("inspect");
    expect(cmd.registeredArguments).toHaveLength(1);
    expect(cmd.registeredArguments[0]?.required).toBe(true);
  });

  it("defaults --network to testnet", () => {
    // Vellar runs on testnet only, so a mainnet default would send every
    // lookup to a Horizon where none of these hashes exist.
    expect(optionFor("--network")?.defaultValue).toBe("testnet");
  });

  it("registers --json", () => {
    expect(optionFor("--json")).toBeDefined();
  });

  it("maps both networks to distinct Horizon hosts", () => {
    expect(HORIZON_URLS.testnet).toBe("https://horizon-testnet.stellar.org");
    expect(HORIZON_URLS.mainnet).toBe("https://horizon.stellar.org");
    expect(HORIZON_URLS.testnet).not.toBe(HORIZON_URLS.mainnet);
  });

  it("has no Horizon URL for an unknown network", () => {
    // The command branches on this being undefined to refuse before fetching.
    expect(HORIZON_URLS.pubnet).toBeUndefined();
  });
});

const TX_HASH = "a".repeat(64);

/**
 * Stable-contract output format (#683). See packages/cli/README.md's
 * "Stable vs. free-to-change output" section.
 */
describe("renderTransaction — stable text contract", () => {
  it("renders a plain (non-sponsored) transaction", () => {
    const tx: HorizonTransaction = {
      hash: TX_HASH,
      successful: true,
      ledger: 123456,
      fee_charged: "100",
      source_account: "GAATVGLRHZXFC66GEN5QNKD56HC5JJZVHQ3P7ZJNVCCI4WKLN44FICSC",
      fee_account: "GAATVGLRHZXFC66GEN5QNKD56HC5JJZVHQ3P7ZJNVCCI4WKLN44FICSC",
      created_at: "2026-01-15T10:32:00Z",
    };
    expect(renderTransaction(tx, TX_HASH)).toMatchInlineSnapshot(`
      "Hash:       aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      Successful: true
      Ledger:     123456
      Fee:        100 stroops
      Source:     GAATVGLRHZXFC66GEN5QNKD56HC5JJZVHQ3P7ZJNVCCI4WKLN44FICSC
      Fee acct:   GAATVGLRHZXFC66GEN5QNKD56HC5JJZVHQ3P7ZJNVCCI4WKLN44FICSC
      Created:    2026-01-15T10:32:00Z"
    `);
  });

  it("appends the fee-sponsorship note when fee_account and source_account differ", () => {
    const tx: HorizonTransaction = {
      hash: TX_HASH,
      successful: true,
      ledger: 123456,
      fee_charged: "100",
      source_account: "GCHANNELACCOUNT000000000000000000000000000000000000000000",
      fee_account: "GSPONSORACCOUNT0000000000000000000000000000000000000000000",
      created_at: "2026-01-15T10:32:00Z",
    };
    const rendered = renderTransaction(tx, TX_HASH);
    expect(rendered).toContain("Fee was paid by a different account than the transaction source");
    expect(rendered).toContain("(fee sponsorship shown on-chain, not asserted).");
  });

  it("omits the fee-sponsorship note when fee_account equals source_account", () => {
    const tx: HorizonTransaction = {
      source_account: "GSAME00000000000000000000000000000000000000000000000000000",
      fee_account: "GSAME00000000000000000000000000000000000000000000000000000",
    };
    expect(renderTransaction(tx, TX_HASH)).not.toContain("different account");
  });

  it("omits the fee-sponsorship note when either account is missing", () => {
    expect(renderTransaction({ source_account: "GONLY" }, TX_HASH)).not.toContain(
      "different account",
    );
    expect(renderTransaction({ fee_account: "GONLY" }, TX_HASH)).not.toContain(
      "different account",
    );
  });

  it("falls back to the given txHash when tx.hash is absent", () => {
    const rendered = renderTransaction({}, TX_HASH);
    expect(rendered).toContain(`Hash:       ${TX_HASH}`);
  });
});
