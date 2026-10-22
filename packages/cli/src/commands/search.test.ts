import { describe, expect, it } from "vitest";
import { DEFAULT_FACILITATOR_URL, makeSearchCommand, renderResource, type CatalogResource } from "./search.js";

function optionFor(flags: string) {
  return makeSearchCommand()
    .options.find((o) => o.long === flags);
}

describe("search command", () => {
  it("is named 'search' and takes one required query argument", () => {
    const cmd = makeSearchCommand();
    expect(cmd.name()).toBe("search");
    expect(cmd.description()).toMatch(/bazaar/i);
    expect(cmd.registeredArguments).toHaveLength(1);
    expect(cmd.registeredArguments[0]?.required).toBe(true);
  });

  it("registers --json", () => {
    expect(optionFor("--json")).toBeDefined();
  });

  it("registers --limit with a default of 10", () => {
    expect(optionFor("--limit")?.defaultValue).toBe("10");
  });

  it("defaults --facilitator to the hosted facilitator", () => {
    // Guards the default rather than just its presence: a wrong default sends
    // a user's query to the wrong service without any error.
    expect(DEFAULT_FACILITATOR_URL).toBe("https://vellar-facilitator.onrender.com");
    expect(optionFor("--facilitator")?.defaultValue).toBe(DEFAULT_FACILITATOR_URL);
  });

  it("builds the discovery URL with the 'query' parameter, not 'q'", () => {
    // The endpoint ignores an unknown key and returns an unfiltered listing, so
    // getting this wrong looks like a working search that ranks nothing.
    const url = new URL("/discovery/search", DEFAULT_FACILITATOR_URL);
    url.searchParams.set("query", "weather data");
    url.searchParams.set("limit", "10");
    expect(url.searchParams.get("query")).toBe("weather data");
    expect(url.pathname).toBe("/discovery/search");
  });
});

/**
 * Stable-contract output format (#683). A script that greps/parses this
 * text relies on exactly this shape — a formatting change here that isn't
 * an explicit snapshot update is a breaking change for that script, not a
 * free restyle. See packages/cli/README.md's "Stable vs. free-to-change
 * output" section.
 */
describe("renderResource — stable text contract", () => {
  const full: CatalogResource = {
    resource: "https://weather.example/api/forecast",
    serviceName: "Weather Forecast API",
    description: "Hourly forecasts for any coordinate, updated every 15 minutes.",
    accepts: [
      { scheme: "exact", network: "stellar:testnet", amount: "1000000", asset: "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND" },
    ],
    trust: { settlements: 42, uniquePayers: 7 },
  };

  it("renders a full entry (resource, service name, price, description, trust)", () => {
    expect(renderResource(full)).toMatchInlineSnapshot(`
      "https://weather.example/api/forecast
        Weather Forecast API
        exact on stellar:testnet: 1000000 base units of CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND
        Hourly forecasts for any coordinate, updated every 15 minutes.
        trust: 42 settlements, 7 unique payers"
    `);
  });

  it("renders every field as missing/unknown when the entry is minimal", () => {
    expect(renderResource({})).toMatchInlineSnapshot(`"(no resource URL)"`);
  });

  it("renders multiple accepts entries, one line each", () => {
    const multi: CatalogResource = {
      resource: "https://multi.example/api",
      accepts: [
        { scheme: "exact", network: "stellar:testnet", amount: "100", asset: "XLM" },
        { scheme: "exact", network: "stellar:mainnet", amount: "50", asset: "USDC" },
      ],
    };
    expect(renderResource(multi)).toMatchInlineSnapshot(`
      "https://multi.example/api
        exact on stellar:testnet: 100 base units of XLM
        exact on stellar:mainnet: 50 base units of USDC"
    `);
  });

  it("clamps a description past 200 characters with a truncation marker", () => {
    const long: CatalogResource = {
      resource: "https://long.example/api",
      description: "x".repeat(250),
    };
    const rendered = renderResource(long);
    expect(rendered).toContain(`  ${"x".repeat(200)}...`);
    expect(rendered).not.toContain("x".repeat(201));
  });

  it("falls back to 'unknown' for a missing scheme/network in an accepts entry", () => {
    const partial: CatalogResource = {
      resource: "https://partial.example/api",
      accepts: [{ amount: "100", asset: "XLM" }],
    };
    expect(renderResource(partial)).toMatchInlineSnapshot(`
      "https://partial.example/api
        unknown on unknown: 100 base units of XLM"
    `);
  });

  it("omits the trust line entirely when trust is absent, rather than printing a zeroed line", () => {
    const noTrust: CatalogResource = { resource: "https://no-trust.example/api" };
    expect(renderResource(noTrust)).not.toContain("trust:");
  });
});
