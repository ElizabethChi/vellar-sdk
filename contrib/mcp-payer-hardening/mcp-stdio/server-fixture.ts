import type { PayerConfig } from "../../../packages/mcp-x402-payer/src/config";
import { createSpendLedger } from "../../../packages/mcp-x402-payer/src/ledger";
import type { Payer } from "../../../packages/mcp-x402-payer/src/payer";
import { createMcpServer, startStdio } from "../../../packages/mcp-x402-payer/src/server";

const ASSET = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const PAYER = "GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A";

const config = {
  network: "testnet",
  caip2: "stellar:testnet",
  rpcUrl: undefined,
  ceilings: new Map([[ASSET, 1_000_000n]]),
  allowedAssets: [ASSET],
  maxResponseBytes: 1024,
  policies: [],
  secret: "not-used-by-this-fixture",
} as PayerConfig;
const ledger = createSpendLedger(config.ceilings);
const payer: Payer = {
  payerAddress: PAYER,
  async quote(url) {
    return {
      url,
      requiresPayment: true,
      offered: [],
      selected: {
        asset: ASSET,
        amount: "1000",
        payTo: PAYER,
        network: "stellar:testnet",
        scheme: "exact",
        maxTimeoutSeconds: 120,
        feesSponsored: true,
      },
      payable: true,
      sessionRemaining: "1000000",
      status: 402,
    };
  },
  async pay(url) {
    return {
      url,
      paid: true,
      content: { contentType: "text/plain", text: "fixture", bytes: 7 },
      settlement: {
        transaction: "a".repeat(64),
        payer: PAYER,
        asset: ASSET,
        amount: "1000",
        network: "testnet",
      },
      status: 200,
    };
  },
};

await startStdio(createMcpServer({ payer, config, ledger }));
