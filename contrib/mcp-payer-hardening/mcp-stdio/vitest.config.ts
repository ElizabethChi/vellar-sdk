import { defineConfig } from "vitest/config";
import { sdkSourceAliases } from "../../../vitest.alias";

export default defineConfig({
  resolve: { alias: sdkSourceAliases },
  test: {
    include: ["contrib/mcp-payer-hardening/mcp-stdio/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
