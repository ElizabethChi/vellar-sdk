export class ResourceSpendCapExceededError extends Error {
  constructor(
    readonly resourceUrl: string,
    readonly attempted: bigint,
    readonly spent: bigint,
    readonly cap: bigint,
  ) {
    super(
      `Per-resource spend cap exceeded for ${resourceUrl}: ` +
        `${spent} already spent + ${attempted} requested exceeds cap ${cap}. ` +
        "The global session ceiling may still have room, but this resource-specific limit does not.",
    );
    this.name = "ResourceSpendCapExceededError";
  }
}

export interface ResourceSpendSnapshot {
  resourceUrl: string;
  spent: string;
  cap: string;
  remaining: string;
}

export interface ResourceSpendCaps {
  assertWithinCap(resourceUrl: string, amount: bigint): void;
  record(resourceUrl: string, amount: bigint): void;
  snapshot(): ResourceSpendSnapshot[];
}

/**
 * Parse VELLAR_X402_RESOURCE_CAPS as a JSON object whose keys are absolute
 * resource URLs and whose values are positive integer base-unit limits.
 */
export function parseResourceCaps(raw: string | undefined): ReadonlyMap<string, bigint> {
  if (raw === undefined || raw.trim() === "") return new Map();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("VELLAR_X402_RESOURCE_CAPS must be a JSON object of URL-to-base-unit limits");
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("VELLAR_X402_RESOURCE_CAPS must be a JSON object");
  }

  const caps = new Map<string, bigint>();
  for (const [resourceUrl, value] of Object.entries(parsed)) {
    let normalized: string;
    try {
      normalized = new URL(resourceUrl).toString();
    } catch {
      throw new Error(`VELLAR_X402_RESOURCE_CAPS contains an invalid URL: ${resourceUrl}`);
    }
    if (typeof value !== "string" || !/^\d+$/.test(value) || BigInt(value) <= 0n) {
      throw new Error(`Resource cap for ${resourceUrl} must be a positive integer string`);
    }
    caps.set(normalized, BigInt(value));
  }
  return caps;
}

export function createResourceSpendCaps(
  caps: ReadonlyMap<string, bigint>,
): ResourceSpendCaps {
  const spent = new Map<string, bigint>();

  function normalized(raw: string): string {
    return new URL(raw).toString();
  }

  return {
    assertWithinCap(resourceUrl, amount) {
      const url = normalized(resourceUrl);
      const cap = caps.get(url);
      if (cap === undefined) return;
      const already = spent.get(url) ?? 0n;
      if (already + amount > cap) {
        throw new ResourceSpendCapExceededError(url, amount, already, cap);
      }
    },

    record(resourceUrl, amount) {
      const url = normalized(resourceUrl);
      if (!caps.has(url)) return;
      this.assertWithinCap(url, amount);
      spent.set(url, (spent.get(url) ?? 0n) + amount);
    },

    snapshot() {
      return [...caps.entries()].map(([resourceUrl, cap]) => {
        const used = spent.get(resourceUrl) ?? 0n;
        const remaining = cap > used ? cap - used : 0n;
        return {
          resourceUrl,
          spent: used.toString(),
          cap: cap.toString(),
          remaining: remaining.toString(),
        };
      });
    },
  };
}

/**
 * Run the exact pre-signing guard needed in payer.ts. The callback represents
 * signing plus submission and is never invoked when the resource cap refuses.
 */
export async function payWithinResourceCap<T>(options: {
  caps: ResourceSpendCaps;
  resourceUrl: string;
  amount: bigint;
  signAndSubmit: () => Promise<{ settled: boolean; value: T }>;
}): Promise<T> {
  options.caps.assertWithinCap(options.resourceUrl, options.amount);
  const result = await options.signAndSubmit();
  if (result.settled) options.caps.record(options.resourceUrl, options.amount);
  return result.value;
}
