// Reference implementation for #683: the CLI's pure rendering helpers for
// `search`, `quote`, and `inspect`, extracted and duplicated here (rather
// than imported) so this folder has no dependency on packages/cli's source
// and can be tested standalone. The real integration target is
// packages/cli/src/commands/{search,quote,inspect}.ts, see this folder's
// README for exact extraction steps.
//
// These functions are pure: given the same input they always render the
// same text. That purity is what makes the output "stable enough for
// scripting", a caller piping this CLI's stdout into grep/awk/jq-on-text
// can rely on line order, label text, fallback text, and conditional-line
// presence not changing on a whim, while ANSI styling and purely cosmetic
// whitespace stay free to change.

/** One entry of `accepts[]` on a catalog resource (search). */
interface Accept {
  scheme?: string;
  network?: string;
  amount?: string;
  asset?: string;
}

/** A catalog entry as returned by `GET /discovery/search`. */
export interface CatalogResource {
  resource?: string;
  serviceName?: string;
  description?: string;
  accepts?: Accept[];
  trust?: { settlements?: number; uniquePayers?: number };
}

/**
 * Render one catalog entry. Everything except the `trust` block is text the
 * seller supplied, so it is printed as a claim rather than as fact, and the
 * description is clamped to 200 characters as a terminal-side safety net.
 */
export function renderResource(r: CatalogResource): string {
  const lines: string[] = [];
  lines.push(r.resource ?? "(no resource URL)");
  if (r.serviceName) lines.push(`  ${r.serviceName}`);

  for (const a of r.accepts ?? []) {
    const scheme = a.scheme ?? "unknown";
    const network = a.network ?? "unknown";
    lines.push(`  ${scheme} on ${network}: ${a.amount ?? "?"} base units of ${a.asset ?? "?"}`);
  }

  if (r.description) {
    const d = r.description.length > 200 ? `${r.description.slice(0, 200)}...` : r.description;
    lines.push(`  ${d}`);
  }

  const t = r.trust;
  if (t && (t.settlements !== undefined || t.uniquePayers !== undefined)) {
    lines.push(`  trust: ${t.settlements ?? 0} settlements, ${t.uniquePayers ?? 0} unique payers`);
  }
  return lines.join("\n");
}

/** One payment option from a 402 challenge (quote). */
export interface PaymentRequirement {
  scheme?: string;
  network?: string;
  amount?: string;
  asset?: string;
  payTo?: string;
  extra?: { areFeesSponsored?: boolean };
}

export interface PaymentRequiredChallenge {
  accepts?: PaymentRequirement[];
}

/**
 * Render a decoded 402 challenge's payment options as the CLI's
 * human-readable text output. Every option is printed, a seller may
 * advertise more than one scheme, and picking one for the reader would hide
 * the choice.
 */
export function renderChallenge(url: string, challenge: PaymentRequiredChallenge): string {
  const lines: string[] = [`URL:    ${url}`];
  const accepts = challenge.accepts ?? [];
  if (accepts.length === 0) {
    lines.push("The 402 carried no payment options.");
    return lines.join("\n");
  }

  for (const [i, a] of accepts.entries()) {
    if (accepts.length > 1) lines.push(`\nOption ${i + 1}:`);
    lines.push(`Scheme: ${a.scheme ?? "unknown"}`);
    lines.push(`Network:${a.network ?? "unknown"}`);
    lines.push(`Amount: ${a.amount ?? "unknown"} (base units)`);
    lines.push(`Asset:  ${a.asset ?? "unknown"}`);
    if (a.payTo) lines.push(`Pay to: ${a.payTo}`);
    lines.push(`Fees:   ${a.extra?.areFeesSponsored ? "sponsored" : "NOT sponsored"}`);
  }

  return lines.join("\n");
}

/** A Horizon transaction record (inspect). */
export interface HorizonTransaction {
  hash?: string;
  successful?: boolean;
  ledger?: number;
  fee_charged?: string;
  fee_account?: string;
  source_account?: string;
  created_at?: string;
}

/**
 * Render a Horizon transaction record as the CLI's human-readable text
 * output. `txHash` falls back for `tx.hash` since Horizon's own response
 * always carries it, but the fallback keeps this usable if that ever
 * changes.
 */
export function renderTransaction(tx: HorizonTransaction, txHash: string): string {
  const lines = [
    `Hash:       ${tx.hash ?? txHash}`,
    `Successful: ${tx.successful}`,
    `Ledger:     ${tx.ledger}`,
    `Fee:        ${tx.fee_charged} stroops`,
    `Source:     ${tx.source_account}`,
    `Fee acct:   ${tx.fee_account}`,
    `Created:    ${tx.created_at}`,
  ];

  if (tx.fee_account && tx.source_account && tx.fee_account !== tx.source_account) {
    lines.push(
      "",
      "Fee was paid by a different account than the transaction source",
      "(fee sponsorship shown on-chain, not asserted).",
    );
  }

  return lines.join("\n");
}
