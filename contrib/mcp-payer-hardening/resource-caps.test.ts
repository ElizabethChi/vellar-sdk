import { describe, expect, it, vi } from "vitest";
import {
  ResourceSpendCapExceededError,
  createResourceSpendCaps,
  parseResourceCaps,
  payWithinResourceCap,
} from "./resource-caps";

const RESOURCE = "https://seller.test/report";

describe("per-resource spend caps", () => {
  it("parses URL-specific caps without conflating asset session ceilings", () => {
    const caps = parseResourceCaps(JSON.stringify({ [RESOURCE]: "200" }));
    expect(caps.get(RESOURCE)).toBe(200n);
  });

  it("refuses a resource that exceeds its own cap while the global ceiling still has room", async () => {
    const caps = createResourceSpendCaps(new Map([[RESOURCE, 100n]]));
    caps.record(RESOURCE, 70n);
    const signAndSubmit = vi.fn(async () => ({ settled: true, value: "paid" }));

    await expect(
      payWithinResourceCap({ caps, resourceUrl: RESOURCE, amount: 40n, signAndSubmit }),
    ).rejects.toBeInstanceOf(ResourceSpendCapExceededError);
    await expect(
      payWithinResourceCap({ caps, resourceUrl: RESOURCE, amount: 40n, signAndSubmit }),
    ).rejects.toThrow(/global session ceiling may still have room/i);
    expect(signAndSubmit).not.toHaveBeenCalled();
  });

  it("records only confirmed settlements", async () => {
    const caps = createResourceSpendCaps(new Map([[RESOURCE, 100n]]));
    await payWithinResourceCap({
      caps,
      resourceUrl: RESOURCE,
      amount: 40n,
      signAndSubmit: async () => ({ settled: false, value: "not-spent" }),
    });
    expect(caps.snapshot()[0]?.spent).toBe("0");

    await payWithinResourceCap({
      caps,
      resourceUrl: RESOURCE,
      amount: 40n,
      signAndSubmit: async () => ({ settled: true, value: "paid" }),
    });
    expect(caps.snapshot()[0]).toMatchObject({ spent: "40", remaining: "60" });
  });

  it("rejects malformed configuration", () => {
    expect(() => parseResourceCaps("not-json")).toThrow(/JSON object/);
    expect(() => parseResourceCaps(JSON.stringify({ "not a url": "10" }))).toThrow(/invalid URL/);
    expect(() => parseResourceCaps(JSON.stringify({ [RESOURCE]: "0" }))).toThrow(/positive/);
  });
});
