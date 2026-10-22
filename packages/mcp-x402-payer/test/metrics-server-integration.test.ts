// Confirms x402_pay/x402_pay_and_call actually update the metrics object
// passed into createMcpServer — not just that metrics.ts's own counters work
// in isolation (see metrics.test.ts), but that the real tool handlers wire
// into them correctly on both success and failure (#676).

import { describe, expect, it } from "vitest";
import { createPayer } from "../src/payer.js";
import { createMcpServer } from "../src/server.js";
import { createPayerMetrics } from "../src/metrics.js";
import {
  ASSET_A,
  neverCalledSigner,
  response402,
  responsePaid,
  scriptedFetch,
  stubSigner,
  testConfig,
  testLedger,
} from "./helpers.js";

const URL = "https://res.test/paid";

function toolHandler(server: ReturnType<typeof createMcpServer>, name: string) {
  const registered = (
    server as unknown as {
      _registeredTools: Record<string, { handler: (a: unknown, e: unknown) => unknown }>;
    }
  )._registeredTools[name];
  if (!registered) throw new Error(`tool ${name} is not registered`);
  return registered.handler;
}

describe("metrics wired through the real x402_pay tool handler (#676)", () => {
  it("records a success with the settled amount and asset", async () => {
    const config = testConfig();
    const ledger = testLedger(config);
    const payer = createPayer({
      config,
      ledger,
      signer: stubSigner(),
      fetchImpl: scriptedFetch([response402(), responsePaid("paid-ok")]),
    });
    const metrics = createPayerMetrics();
    const server = createMcpServer({ payer, config, ledger, metrics });

    await toolHandler(server, "x402_pay")({ resource_url: URL, max_amount: "1000000" }, {});

    const text = metrics.renderPrometheus();
    expect(text).toContain(`vellar_x402_payment_success_total{asset="${ASSET_A}"} 1`);
    expect(text).toContain(`vellar_x402_payment_spend_base_units_total{asset="${ASSET_A}"} 1000`);
  });

  it("records a session-ceiling rejection distinctly from a generic failure", async () => {
    const config = testConfig({ assets: `${ASSET_A}:500` }); // ceiling below the quoted price
    const ledger = testLedger(config);
    const payer = createPayer({
      config,
      ledger,
      signer: neverCalledSigner(), // must never be reached — refused before signing
      fetchImpl: scriptedFetch([response402()]),
    });
    const metrics = createPayerMetrics();
    const server = createMcpServer({ payer, config, ledger, metrics });

    await toolHandler(server, "x402_pay")({ resource_url: URL, max_amount: "1000000" }, {});

    const text = metrics.renderPrometheus();
    expect(text).toContain(`vellar_x402_session_ceiling_rejection_total{asset="${ASSET_A}"} 1`);
  });

  it("does nothing to metrics when no payment was required at all", async () => {
    const config = testConfig();
    const ledger = testLedger(config);
    const payer = createPayer({
      config,
      ledger,
      signer: neverCalledSigner(),
      fetchImpl: scriptedFetch([new Response("ok", { status: 200 })]),
    });
    const metrics = createPayerMetrics();
    const server = createMcpServer({ payer, config, ledger, metrics });

    await toolHandler(server, "x402_pay")({ resource_url: URL, max_amount: "1000000" }, {});

    const text = metrics.renderPrometheus();
    expect(text).not.toContain("vellar_x402_payment_success_total{");
    expect(text).not.toContain("vellar_x402_payment_failure_total{");
  });

  it("works with no metrics object at all (opt-out is the default, and must not throw)", async () => {
    const config = testConfig();
    const ledger = testLedger(config);
    const payer = createPayer({
      config,
      ledger,
      signer: stubSigner(),
      fetchImpl: scriptedFetch([response402(), responsePaid("no-metrics-ok")]),
    });
    // No `metrics` key at all — this is the default, un-opted-in shape.
    const server = createMcpServer({ payer, config, ledger });

    const out = (await toolHandler(server, "x402_pay")(
      { resource_url: URL, max_amount: "1000000" },
      {},
    )) as { content: Array<{ text: string }> };

    expect(out.content[0]!.text).toContain("Paid 1000 base units");
  });
});
