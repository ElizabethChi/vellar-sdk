# MCP payer protocol, limits, dry-run, and tracing

This contribution supplies executable reference implementations for issues
#610, #612, #613, and #614 while keeping external-contributor changes inside
`contrib/` as required by `CONTRIBUTING.md`.

## Per-resource caps (#610)

`resource-caps.ts` parses `VELLAR_X402_RESOURCE_CAPS` as a JSON object mapping
absolute resource URLs to positive base-unit limits. It tracks confirmed spend
separately from the existing per-asset session ledger and raises the distinct
`ResourceSpendCapExceededError` before the signing callback is invoked.

Maintainer integration:

1. Add `resourceCaps` to `PayerConfig` and parse the environment value in
   `packages/mcp-x402-payer/src/config.ts`.
2. Construct one resource tracker in `bin.ts`.
3. In `payer.ts`, call `assertWithinCap(url, amount)` immediately beside each
   `ledger.assertWithinCeiling(...)` call, before signing, and call `record`
   only beside the confirmed/indeterminate session-ledger records.

## Quote-only pay-and-call (#613)

`dry-run-pay-and-call.ts` adds the optional `dry_run` MCP field and a
discriminated result. Dry-run performs Bazaar discovery and `payer.quote`, but
never calls `payer.pay`, so signer and submission code are unreachable. Its
renderer starts with `DRY RUN - QUOTE ONLY` and explicitly says no payment was
completed.

Maintainers can move the schema field and handler branch into the existing
`x402_pay_and_call` registration in `server.ts`, then share the `discover`
selection block with `pay-and-call.ts` to avoid duplicate selection logic.

## OpenTelemetry-compatible phases (#612)

`payment-tracing.ts` exposes structural `Tracer`/`Span` interfaces compatible
with the OpenTelemetry API and defaults to a no-op tracer. The signer decorator
creates the `sign` span; the fetch decorator distinguishes the unsigned quote
probe from a request carrying `PAYMENT-SIGNATURE`, creating the `quote` and
`submit` spans. It records no headers, request bodies, secrets, query strings,
or signed envelopes.

Wire the decorators around the signer and payer fetch dependency in `bin.ts`.
An actual OpenTelemetry tracer can be passed directly without adding a hard
runtime dependency to the payer package.

## Official MCP client handshake (#614)

`mcp-stdio/mcp-client.integration.test.ts` bundles a deterministic fixture that
uses the real `createMcpServer` and `startStdio`, then connects with the official
MCP SDK `Client` and `StdioClientTransport`. `Client.connect` performs
initialize; the suite then checks server capabilities, list-tools schemas, and
a call-tool result. Unlike the existing funded-stack test, this contract is
hermetic and catches schema drift without a wallet or network.

## Validation

```sh
npx vitest run contrib/mcp-payer-hardening/*.test.ts
```

The protocol test is intentionally opt-in:

```powershell
$env:VELLAR_MCP_PROTOCOL_INTEGRATION = "1"
npx vitest run --config contrib/mcp-payer-hardening/mcp-stdio/vitest.config.ts
Remove-Item Env:VELLAR_MCP_PROTOCOL_INTEGRATION
```
