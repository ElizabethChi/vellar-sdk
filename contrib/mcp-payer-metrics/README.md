# MCP payer Prometheus metrics endpoint (#676)

Reference implementation and tests for an opt-in Prometheus-format metrics
endpoint for `packages/mcp-x402-payer`, tracking cumulative confirmed spend
(by asset), payment success count (by asset), payment failure count (by
error reason), and session-ceiling rejections (by asset).

## Files

- `metrics.ts`: `createPayerMetrics()` (in-process counters plus
  `renderPrometheus()`) and `startMetricsServer()` (a minimal HTTP server
  bound to `127.0.0.1` only, serving the current Prometheus text on any GET
  and `405` on anything else).
- `metrics.test.ts`: covers the happy path (empty counters still render
  valid Prometheus text), a simulated payment sequence, multi-asset and
  multi-reason series staying distinct, bigint precision past
  `Number.MAX_SAFE_INTEGER`, Prometheus label escaping, and the HTTP server
  itself (serves on GET, rejects non-GET, binds to `127.0.0.1` only).

## Run it standalone

```sh
npx vitest run contrib/mcp-payer-metrics/metrics.test.ts
```

## What It Does

- Four counters, matching the issue's ask: spend (bigint-precise, mirroring
  a record-on-settle-only rule), success count, failure count by error
  reason, and session-ceiling rejections (counted separately from a generic
  failure since it is a refusal, not a settlement attempt that failed).
- Disabled unless explicitly started: the HTTP server here is only ever
  created by a caller that opts in. A process holding a hot-wallet key
  opening an unexpected port is exactly the kind of surprise that should
  require explicit configuration, not a default.
- Binds to `127.0.0.1` only. The endpoint has no auth of its own (Prometheus
  text format doesn't either), so exposing it beyond localhost needs an
  operator-managed reverse proxy, not a flag that could be flipped without
  that protection in place.

## Integration into Core

1. Copy `metrics.ts` to `packages/mcp-x402-payer/src/metrics.ts` and
   `metrics.test.ts` to `packages/mcp-x402-payer/test/metrics.test.ts`
   unchanged (no path rewrites needed; it has no dependency on this
   package's other source files).

2. Add an opt-in config option in `packages/mcp-x402-payer/src/config.ts`:
   - Add `readonly metricsPort?: number;` to the `PayerConfig` interface
     (near the other optional fields around line 58).
   - Add a `parseMetricsPort(raw: string | undefined): number | undefined`
     helper next to `parseMaxResponseBytes` (around line 206): return
     `undefined` when `VELLAR_X402_METRICS_PORT` is unset or empty (disabled
     is the only default, never a default port), otherwise validate it is an
     integer in `1..65535` and throw `ConfigError` otherwise.
   - Call it in `loadConfig` alongside `maxResponseBytes` (around line 230)
     and spread `metricsPort` into the returned config only when defined
     (around line 255), matching the existing pattern for other optional
     fields.

3. In `packages/mcp-x402-payer/src/server.ts`:
   - Add `metrics?: PayerMetrics;` to `ServerDeps` (around line 150).
   - Add two small helpers, `recordPaymentOutcome(metrics, result)` and
     `recordPaymentFailure(metrics, err)`, that no-op when `metrics` is
     undefined; the first calls `recordPaymentSuccess` when
     `result.paid && result.settlement`, the second calls
     `recordSessionCeilingRejection` when the caught error is a
     `SessionCeilingExceededError` and always calls `recordPaymentFailure`
     with `err.name`.
   - Call `recordPaymentOutcome`/`recordPaymentFailure` from the
     `x402_pay` and `x402_pay_and_call` handlers' existing try/catch blocks
     (around lines 208, 255, and 347), observing the result/error each
     handler already has rather than adding a new seam.

4. In `packages/mcp-x402-payer/src/bin.ts` (around lines 28 and 40): after
   constructing `payer`, create `metrics = config.metricsPort !== undefined
   ? createPayerMetrics() : undefined`, call `startMetricsServer(metrics,
   config.metricsPort)` when defined, and pass `metrics` into
   `createMcpServer({ payer, config, ledger, metrics })`.

5. Document `VELLAR_X402_METRICS_PORT` and a "Metrics" section listing the
   four counters in `packages/mcp-x402-payer/README.md`.
