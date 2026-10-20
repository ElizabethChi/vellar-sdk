import type { FetchLike } from "../../packages/mcp-x402-payer/src/payer";
import type { PaymentSigner } from "../../packages/mcp-x402-payer/src/signer";

export type SpanAttribute = string | number | boolean;

/** Minimal structural subset of the OpenTelemetry Span API. */
export interface CompatibleSpan {
  setAttribute(name: string, value: SpanAttribute): this;
  recordException(error: Error): void;
  setStatus(status: { code: 1 | 2; message?: string }): this;
  end(): void;
}

/** Minimal structural subset of the OpenTelemetry Tracer API. */
export interface CompatibleTracer {
  startSpan(name: string, options?: { attributes?: Record<string, SpanAttribute> }): CompatibleSpan;
}

const noOpSpan: CompatibleSpan = {
  setAttribute() {
    return this;
  },
  recordException() {},
  setStatus() {
    return this;
  },
  end() {},
};

export const noOpTracer: CompatibleTracer = {
  startSpan() {
    return noOpSpan;
  },
};

async function inSpan<T>(
  tracer: CompatibleTracer,
  name: string,
  attributes: Record<string, SpanAttribute>,
  operation: (span: CompatibleSpan) => Promise<T>,
): Promise<T> {
  const span = tracer.startSpan(name, { attributes });
  try {
    const result = await operation(span);
    span.setStatus({ code: 1 });
    return result;
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    span.recordException(normalized);
    span.setStatus({ code: 2, message: normalized.message });
    throw error;
  } finally {
    span.end();
  }
}

function safeResourcePath(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function hasPaymentSignature(headers: HeadersInit | undefined): boolean {
  if (headers === undefined) return false;
  return new Headers(headers).has("payment-signature");
}

/** Wrap the signer so the expensive signing phase gets its own span. */
export function tracePaymentSigner(
  signer: PaymentSigner,
  tracer: CompatibleTracer = noOpTracer,
): PaymentSigner {
  return {
    address: signer.address,
    signPayment(challenge) {
      return inSpan(
        tracer,
        "vellar.mcp-payer.sign",
        {
          "payment.phase": "sign",
          "payment.option_count": challenge.accepts.length,
          // Public address only. The secret and signed envelope are never attributes.
          "payment.payer": signer.address,
        },
        () => signer.signPayment(challenge),
      );
    },
  };
}

/**
 * Wrap fetch so the unpaid quote probe and signed submission are distinct
 * spans. Headers and bodies are intentionally never copied into attributes.
 */
export function tracePaymentFetch(
  fetchImpl: FetchLike,
  tracer: CompatibleTracer = noOpTracer,
): FetchLike {
  return async (url, init) => {
    const phase = hasPaymentSignature(init?.headers) ? "submit" : "quote";
    return inSpan(
      tracer,
      `vellar.mcp-payer.${phase}`,
      {
        "payment.phase": phase,
        "http.request.method": init?.method ?? "GET",
        "url.path": safeResourcePath(url),
      },
      async (span) => {
        const response = await fetchImpl(url, init);
        span.setAttribute("http.response.status_code", response.status);
        return response;
      },
    );
  };
}
