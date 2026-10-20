import { describe, expect, it, vi } from "vitest";
import type { PayerConfig } from "../../packages/mcp-x402-payer/src/config";
import { createSpendLedger } from "../../packages/mcp-x402-payer/src/ledger";
import type { Payer } from "../../packages/mcp-x402-payer/src/payer";
import {
  payAndCallInputSchema,
  payAndCallWithDryRun,
  renderControlledPayAndCall,
} from "./dry-run-pay-and-call";

const ASSET = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const RESOURCE = "https://seller.test/report";
const config = {
  caip2: "stellar:testnet",
  allowedAssets: [ASSET],
} as Pick<PayerConfig, "caip2" | "allowedAssets">;

function discoveryResponse() {
  return Response.json({
    resources: [
      {
        resource: RESOURCE,
        accepts: [
          {
            scheme: "exact",
            network: "stellar:testnet",
            amount: "500",
            asset: ASSET,
            extra: { areFeesSponsored: true },
          },
        ],
      },
    ],
  });
}

describe("pay-and-call dry run", () => {
  it("discovers and quotes but never enters the signing/submission payment path", async () => {
    const quote = vi.fn(async () => ({
      url: RESOURCE,
      requiresPayment: true,
      offered: [],
      selected: {
        amount: "500",
        asset: ASSET,
        payTo: "G".padEnd(56, "A"),
        network: "stellar:testnet",
        scheme: "exact",
        maxTimeoutSeconds: 120,
        feesSponsored: true,
      },
      payable: true,
      sessionRemaining: "1000",
      status: 402,
    }));
    const pay = vi.fn<Payer["pay"]>();
    const payer = { payerAddress: "GTEST", quote, pay } as Payer;

    const result = await payAndCallWithDryRun(
      {
        payer,
        config,
        ledger: createSpendLedger(new Map([[ASSET, 1000n]])),
        facilitatorUrl: "https://facilitator.test",
        fetchImpl: vi.fn(async () => discoveryResponse()),
      },
      { query: "risk report", maxAmount: "500", dryRun: true },
    );

    expect(result.kind).toBe("dry-run");
    expect(result.paid).toBe(false);
    expect(quote).toHaveBeenCalledWith(RESOURCE);
    expect(pay).not.toHaveBeenCalled();
    expect(renderControlledPayAndCall(result)).toContain("DRY RUN - QUOTE ONLY");
    expect(renderControlledPayAndCall(result)).toContain(
      "Nothing was signed, submitted, or spent.",
    );
  });

  it("exposes dry_run as an optional MCP boolean parameter defaulting false", () => {
    const parsed = zodObject(payAndCallInputSchema).parse({ query: "report", max_amount: "500" });
    expect(parsed.dry_run).toBe(false);
  });
});

function zodObject(shape: typeof payAndCallInputSchema) {
  return {
    parse(input: Record<string, unknown>) {
      return {
        query: shape.query.parse(input.query),
        max_amount: shape.max_amount.parse(input.max_amount),
        dry_run: shape.dry_run.parse(input.dry_run),
      };
    },
  };
}
