// Reference implementation for #676: an opt-in Prometheus-format metrics
// endpoint for packages/mcp-x402-payer, tracking spend and error counters so
// an operator can watch spend rate and error rate without tailing logs.
//
// Disabled by default: binding a port is a behavior change this process
// would otherwise never do (it is a stdio-only MCP server), and an
// unexpected open port on a process holding a hot-wallet key is exactly the
// kind of surprise that should require explicit opt-in, not a default.
//
// Binds to 127.0.0.1 ONLY, never 0.0.0.0: this endpoint has no auth of its
// own (Prometheus text format has none either), so exposing it beyond
// localhost needs an operator-managed reverse proxy in front of it, not a
// config flag here that could be flipped without that protection in place.
//
// This file has no dependency on packages/mcp-x402-payer's own source; it is
// a standalone reference a maintainer wires in per the integration notes in
// this folder's README.

import { createServer, type Server } from "node:http";

export interface PayerMetrics {
  /** Record a CONFIRMED settlement (mirrors the "record on settle only" rule). */
  recordPaymentSuccess(asset: string, amountBaseUnits: bigint): void;
  /** Record any payment attempt that did not settle (refused, failed, errored). */
  recordPaymentFailure(reason: string): void;
  /** Record an attempt refused because it would exceed the session ceiling. */
  recordSessionCeilingRejection(asset: string): void;
  /** Render all counters in Prometheus text exposition format. */
  renderPrometheus(): string;
}

/** Prometheus label value escaping: backslash, double-quote, and newline. */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatSample(
  name: string,
  labels: Record<string, string>,
  value: string | number | bigint,
): string {
  const labelEntries = Object.entries(labels);
  const labelStr =
    labelEntries.length > 0
      ? `{${labelEntries.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(",")}}`
      : "";
  return `${name}${labelStr} ${value.toString()}`;
}

/**
 * In-process counters. Reset when the process restarts, same as the spend
 * ledger: a point-in-time view of THIS process's lifetime, not a durable
 * record. An operator wanting history scrapes and stores it themselves,
 * which is the entire point of exposing Prometheus format rather than
 * inventing a persistence layer here.
 */
export function createPayerMetrics(): PayerMetrics {
  const successCountByAsset = new Map<string, number>();
  const successAmountByAsset = new Map<string, bigint>();
  const failureCountByReason = new Map<string, number>();
  const ceilingRejectionsByAsset = new Map<string, number>();

  return {
    recordPaymentSuccess(asset, amountBaseUnits) {
      successCountByAsset.set(asset, (successCountByAsset.get(asset) ?? 0) + 1);
      successAmountByAsset.set(asset, (successAmountByAsset.get(asset) ?? 0n) + amountBaseUnits);
    },

    recordPaymentFailure(reason) {
      failureCountByReason.set(reason, (failureCountByReason.get(reason) ?? 0) + 1);
    },

    recordSessionCeilingRejection(asset) {
      ceilingRejectionsByAsset.set(asset, (ceilingRejectionsByAsset.get(asset) ?? 0) + 1);
    },

    renderPrometheus() {
      const lines: string[] = [];

      lines.push(
        "# HELP vellar_x402_payment_spend_base_units_total Cumulative confirmed spend, in the asset's base units.",
        "# TYPE vellar_x402_payment_spend_base_units_total counter",
      );
      for (const [asset, amount] of successAmountByAsset) {
        lines.push(formatSample("vellar_x402_payment_spend_base_units_total", { asset }, amount));
      }

      lines.push(
        "# HELP vellar_x402_payment_success_total Confirmed settlements.",
        "# TYPE vellar_x402_payment_success_total counter",
      );
      for (const [asset, count] of successCountByAsset) {
        lines.push(formatSample("vellar_x402_payment_success_total", { asset }, count));
      }

      lines.push(
        "# HELP vellar_x402_payment_failure_total Payment attempts that did not settle, by reason.",
        "# TYPE vellar_x402_payment_failure_total counter",
      );
      for (const [reason, count] of failureCountByReason) {
        lines.push(formatSample("vellar_x402_payment_failure_total", { reason }, count));
      }

      lines.push(
        "# HELP vellar_x402_session_ceiling_rejection_total Attempts refused for exceeding the session spend ceiling, by asset.",
        "# TYPE vellar_x402_session_ceiling_rejection_total counter",
      );
      for (const [asset, count] of ceilingRejectionsByAsset) {
        lines.push(formatSample("vellar_x402_session_ceiling_rejection_total", { asset }, count));
      }

      // Prometheus text format requires a trailing newline.
      return lines.join("\n") + "\n";
    },
  };
}

/**
 * Starts the opt-in metrics HTTP endpoint. Every path serves the same
 * Prometheus text (there's exactly one metrics set in this process); only
 * GET /metrics is documented, but any GET is served so a trailing-slash or a
 * monitoring tool's default scrape path doesn't 404 for no operator-visible
 * reason.
 */
export function startMetricsServer(metrics: PayerMetrics, port: number): Server {
  const server = createServer((req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "text/plain" }).end("method not allowed\n");
      return;
    }
    const body = metrics.renderPrometheus();
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" }).end(body);
  });

  server.listen(port, "127.0.0.1");

  return server;
}
