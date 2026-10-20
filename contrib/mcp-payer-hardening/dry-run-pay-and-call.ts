import { z } from "zod";
import type { PayerConfig } from "../../packages/mcp-x402-payer/src/config";
import type { SpendLedger } from "../../packages/mcp-x402-payer/src/ledger";
import {
  NoPayableResultError,
  selectCandidates,
  type Candidate,
  type PayAndCallResult,
} from "../../packages/mcp-x402-payer/src/pay-and-call";
import type { FetchLike, Payer, QuoteResult } from "../../packages/mcp-x402-payer/src/payer";

export const payAndCallInputSchema = {
  query: z.string().min(1),
  max_amount: z.string().regex(/^\d+$/),
  dry_run: z
    .boolean()
    .optional()
    .default(false)
    .describe("Quote the selected resource without signing, submitting, or spending."),
};

export interface DryRunPayAndCallResult {
  kind: "dry-run";
  paid: false;
  selectedUrl: string;
  query: string;
  advertisedAmount: string;
  advertisedAsset: string;
  quote: QuoteResult;
  resultsFound: number;
  resultsPayable: number;
}

export type ControlledPayAndCallResult =
  | DryRunPayAndCallResult
  | ({ kind: "payment" } & PayAndCallResult);

export interface ControlledPayAndCallDeps {
  payer: Payer;
  config: Pick<PayerConfig, "caip2" | "allowedAssets">;
  ledger: SpendLedger;
  fetchImpl?: FetchLike;
  facilitatorUrl?: string;
}

async function discover(
  deps: ControlledPayAndCallDeps,
  query: string,
  maxAmount: string,
): Promise<{ chosen: Candidate; resultsFound: number; resultsPayable: number }> {
  if (!/^\d+$/.test(maxAmount)) {
    throw new Error("max_amount must be a non-negative integer in base units");
  }
  if (!deps.config.allowedAssets.some((asset) => deps.ledger.remainingFor(asset) > 0n)) {
    throw new Error("session ceiling exhausted for every allowed asset");
  }

  const endpoint = new URL(
    "/discovery/search",
    deps.facilitatorUrl ?? "https://vellar-facilitator.onrender.com",
  );
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("limit", "10");
  const response = await (deps.fetchImpl ?? fetch)(endpoint.toString());
  if (!response.ok) throw new Error(`the Bazaar returned HTTP ${response.status}`);

  const { payable, resultsFound } = selectCandidates(
    (await response.json()) as Parameters<typeof selectCandidates>[0],
    deps.config,
  );
  const ceiling = BigInt(maxAmount);
  const affordable = payable.filter(({ amount }) => amount <= ceiling);
  const chosen = affordable[0];
  if (!chosen) {
    const cheapest = payable[0];
    throw new NoPayableResultError(
      cheapest
        ? `nothing is under max_amount ${ceiling}; cheapest is ${cheapest.amount}`
        : "no result is payable by this server",
      {
        resultsFound,
        ...(cheapest
          ? { cheapestAmount: cheapest.amount, cheapestAsset: cheapest.asset }
          : {}),
      },
    );
  }
  return { chosen, resultsFound, resultsPayable: affordable.length };
}

export async function payAndCallWithDryRun(
  deps: ControlledPayAndCallDeps,
  input: { query: string; maxAmount: string; dryRun?: boolean },
): Promise<ControlledPayAndCallResult> {
  const selection = await discover(deps, input.query, input.maxAmount);

  if (input.dryRun) {
    const quote = await deps.payer.quote(selection.chosen.url);
    return {
      kind: "dry-run",
      paid: false,
      selectedUrl: selection.chosen.url,
      query: input.query,
      advertisedAmount: selection.chosen.amount.toString(),
      advertisedAsset: selection.chosen.asset,
      quote,
      resultsFound: selection.resultsFound,
      resultsPayable: selection.resultsPayable,
    };
  }

  const payment = await deps.payer.pay(selection.chosen.url, input.maxAmount);
  return {
    kind: "payment",
    ...payment,
    selectedUrl: selection.chosen.url,
    query: input.query,
    resultsFound: selection.resultsFound,
    resultsPayable: selection.resultsPayable,
  };
}

export function renderControlledPayAndCall(result: ControlledPayAndCallResult): string {
  if (result.kind === "dry-run") {
    const selected = result.quote.selected;
    const price = selected?.amount ?? result.advertisedAmount;
    const asset = selected?.asset ?? result.advertisedAsset;
    return [
      "DRY RUN - QUOTE ONLY",
      `Selected: ${result.selectedUrl}`,
      `Would pay: ${price} base units of ${asset}.`,
      "No payment was completed. Nothing was signed, submitted, or spent.",
    ].join("\n");
  }
  return result.paid
    ? `PAYMENT COMPLETED: ${result.settlement?.transaction ?? "settlement hash unavailable"}`
    : "PAYMENT PATH COMPLETED WITHOUT A CHARGE";
}
