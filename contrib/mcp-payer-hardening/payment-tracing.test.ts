import { describe, expect, it } from "vitest";
import { createPayer } from "../../packages/mcp-x402-payer/src/payer";
import {
  response402,
  responsePaid,
  scriptedFetch,
  stubSigner,
  testConfig,
  testLedger,
  txHash,
} from "../../packages/mcp-x402-payer/test/helpers";
import {
  tracePaymentFetch,
  tracePaymentSigner,
  type CompatibleSpan,
  type CompatibleTracer,
  type SpanAttribute,
} from "./payment-tracing";

interface ExportedSpan {
  name: string;
  attributes: Record<string, SpanAttribute>;
  status?: { code: 1 | 2; message?: string };
  exceptions: string[];
}

class InMemoryTracer implements CompatibleTracer {
  readonly spans: ExportedSpan[] = [];

  startSpan(name: string, options?: { attributes?: Record<string, SpanAttribute> }): CompatibleSpan {
    const exported: ExportedSpan = {
      name,
      attributes: { ...options?.attributes },
      exceptions: [],
    };
    return {
      setAttribute(key, value) {
        exported.attributes[key] = value;
        return this;
      },
      recordException(error) {
        exported.exceptions.push(error.message);
      },
      setStatus(status) {
        exported.status = status;
        return this;
      },
      end: () => {
        this.spans.push(exported);
      },
    };
  }
}

describe("OpenTelemetry-compatible payment spans", () => {
  it("creates quote, sign, and submit spans without recording secrets or signed envelopes", async () => {
    const tracer = new InMemoryTracer();
    const config = testConfig();
    const signer = tracePaymentSigner(stubSigner(), tracer);
    const signedEnvelope = "signed-1";
    const secret = config.secret;
    const transport = scriptedFetch([response402(), responsePaid(txHash("traced"))]);
    const payer = createPayer({
      config,
      ledger: testLedger(config),
      signer,
      fetchImpl: tracePaymentFetch(transport, tracer),
    });

    const result = await payer.pay("https://seller.test/private?token=do-not-record", "1000");

    expect(result.paid).toBe(true);
    expect(tracer.spans.map(({ name }) => name)).toEqual([
      "vellar.mcp-payer.quote",
      "vellar.mcp-payer.sign",
      "vellar.mcp-payer.submit",
    ]);
    expect(tracer.spans.every(({ status }) => status?.code === 1)).toBe(true);
    const exported = JSON.stringify(tracer.spans);
    expect(exported).not.toContain(secret);
    expect(exported).not.toContain(signedEnvelope);
    expect(exported).not.toContain("do-not-record");
    expect(exported).not.toContain("PAYMENT-SIGNATURE");
  });
});
