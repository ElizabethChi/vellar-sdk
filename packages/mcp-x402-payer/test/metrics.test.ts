import { describe, expect, it, afterEach } from "vitest";
import { createPayerMetrics, startMetricsServer } from "../src/metrics.js";
import { ASSET_A, ASSET_B } from "./helpers.js";

describe("createPayerMetrics (#676)", () => {
  it("happy path: renders empty counters as valid Prometheus text when nothing has happened", () => {
    const metrics = createPayerMetrics();
    const text = metrics.renderPrometheus();

    expect(text).toContain("# HELP vellar_x402_payment_spend_base_units_total");
    expect(text).toContain("# TYPE vellar_x402_payment_spend_base_units_total counter");
    expect(text).toContain("# HELP vellar_x402_payment_success_total");
    expect(text).toContain("# HELP vellar_x402_payment_failure_total");
    expect(text).toContain("# HELP vellar_x402_session_ceiling_rejection_total");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("reflects a sequence of simulated payments: two successes on one asset, one failure, one ceiling rejection", () => {
    const metrics = createPayerMetrics();

    metrics.recordPaymentSuccess(ASSET_A, 1000n);
    metrics.recordPaymentSuccess(ASSET_A, 2500n);
    metrics.recordPaymentFailure("SettlementFailedError");
    metrics.recordSessionCeilingRejection(ASSET_A);

    const text = metrics.renderPrometheus();

    expect(text).toContain(`vellar_x402_payment_spend_base_units_total{asset="${ASSET_A}"} 3500`);
    expect(text).toContain(`vellar_x402_payment_success_total{asset="${ASSET_A}"} 2`);
    expect(text).toContain(
      'vellar_x402_payment_failure_total{reason="SettlementFailedError"} 1',
    );
    expect(text).toContain(`vellar_x402_session_ceiling_rejection_total{asset="${ASSET_A}"} 1`);
  });

  it("tracks multiple assets and failure reasons as distinct series", () => {
    const metrics = createPayerMetrics();

    metrics.recordPaymentSuccess(ASSET_A, 100n);
    metrics.recordPaymentSuccess(ASSET_B, 200n);
    metrics.recordPaymentFailure("MaxAmountExceededError");
    metrics.recordPaymentFailure("MaxAmountExceededError");
    metrics.recordPaymentFailure("SessionCeilingExceededError");

    const text = metrics.renderPrometheus();

    expect(text).toContain(`vellar_x402_payment_success_total{asset="${ASSET_A}"} 1`);
    expect(text).toContain(`vellar_x402_payment_success_total{asset="${ASSET_B}"} 1`);
    expect(text).toContain(
      'vellar_x402_payment_failure_total{reason="MaxAmountExceededError"} 2',
    );
    expect(text).toContain(
      'vellar_x402_payment_failure_total{reason="SessionCeilingExceededError"} 1',
    );
  });

  it("accumulates spend across many small payments without losing precision (bigint, not float)", () => {
    const metrics = createPayerMetrics();
    // A value well past Number.MAX_SAFE_INTEGER: a float accumulator would
    // silently lose precision here, which is exactly the failure mode a spend
    // counter cannot tolerate.
    const huge = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2
    metrics.recordPaymentSuccess(ASSET_A, huge);
    metrics.recordPaymentSuccess(ASSET_A, huge);

    const text = metrics.renderPrometheus();
    expect(text).toContain(
      `vellar_x402_payment_spend_base_units_total{asset="${ASSET_A}"} ${(huge * 2n).toString()}`,
    );
  });

  it("escapes a label value containing a quote or backslash", () => {
    const metrics = createPayerMetrics();
    metrics.recordPaymentFailure('weird"reason\\here');

    const text = metrics.renderPrometheus();
    expect(text).toContain('vellar_x402_payment_failure_total{reason="weird\\"reason\\\\here"} 1');
  });

  it("key failure mode: counters for one metric kind never leak into another's series", () => {
    const metrics = createPayerMetrics();
    metrics.recordSessionCeilingRejection(ASSET_A);

    const text = metrics.renderPrometheus();
    // A ceiling rejection must not also appear as a success or a generic failure.
    expect(text).not.toMatch(
      new RegExp(`vellar_x402_payment_success_total\\{asset="${ASSET_A}"\\}`),
    );
    expect(text).not.toContain("vellar_x402_payment_failure_total{reason=");
  });
});

describe("startMetricsServer (#676)", () => {
  let server: ReturnType<typeof startMetricsServer> | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  function listenOnFreePort(metrics: ReturnType<typeof createPayerMetrics>): Promise<number> {
    return new Promise((resolve, reject) => {
      server = startMetricsServer(metrics, 0);
      server.on("error", reject);
      server.on("listening", () => {
        const address = server?.address();
        if (!address || typeof address === "string") {
          reject(new Error("expected a TCP address"));
          return;
        }
        resolve(address.port);
      });
    });
  }

  it("serves the current Prometheus text on GET, reflecting metrics recorded after the server started", async () => {
    const metrics = createPayerMetrics();
    const port = await listenOnFreePort(metrics);

    metrics.recordPaymentSuccess(ASSET_A, 42n);

    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain(`vellar_x402_payment_success_total{asset="${ASSET_A}"} 1`);
  });

  it("key failure mode: rejects a non-GET request instead of silently serving metrics", async () => {
    const metrics = createPayerMetrics();
    const port = await listenOnFreePort(metrics);

    const res = await fetch(`http://127.0.0.1:${port}/metrics`, { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("binds to 127.0.0.1 only, not every interface", async () => {
    const metrics = createPayerMetrics();
    await listenOnFreePort(metrics);

    const address = server!.address();
    if (!address || typeof address === "string") throw new Error("expected a TCP address");
    expect(address.address).toBe("127.0.0.1");
  });
});
