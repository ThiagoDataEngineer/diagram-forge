/**
 * docs-sync — reads source-of-truth values and patches documentation.
 *
 * Source of truth:
 *   prices   → src/payment/l402.ts  (PRICE_SATS)
 *   version  → package.json         (version)
 *   env vars → src/server.ts        (process.env.* usages)
 *
 * Run: npx tsx scripts/docs-sync.ts [--check]
 *   --check  exit 1 if any doc is out of sync (for CI)
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const DRY = process.argv.includes("--check");

// ── Source of truth readers ────────────────────────────────────────────────

function readPrices(): Record<string, number> {
  const src = fs.readFileSync(path.join(ROOT, "src/payment/l402.ts"), "utf8");
  const match = src.match(/export const PRICE_SATS\s*=\s*\{([^}]+)\}/s);
  if (!match) throw new Error("PRICE_SATS block not found in l402.ts");
  const prices: Record<string, number> = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/(\w+)\s*:\s*(\d+)/);
    if (m) prices[m[1]] = parseInt(m[2], 10);
  }
  return prices;
}

function readVersion(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  return pkg.version as string;
}

// ── Patch helpers ─────────────────────────────────────────────────────────

let drifted = false;

function patch(file: string, replacements: Array<[RegExp, string]>): void {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) {
    console.warn(`  SKIP  ${file} (not found)`);
    return;
  }
  let content = fs.readFileSync(abs, "utf8");
  let changed = false;
  for (const [pattern, replacement] of replacements) {
    const updated = content.replace(pattern, replacement);
    if (updated !== content) {
      changed = true;
      content = updated;
    }
  }
  if (!changed) {
    console.log(`  OK    ${file}`);
    return;
  }
  drifted = true;
  if (DRY) {
    console.error(`  DRIFT ${file} — run "npx tsx scripts/docs-sync.ts" to fix`);
  } else {
    fs.writeFileSync(abs, content, "utf8");
    console.log(`  FIXED ${file}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

const prices = readPrices();
const version = readVersion();

const { basic, full, live } = prices;

// Approximate USD at ~$100k/BTC (1 sat = $0.001)
const usd = (sats: number) => `~$${(sats * 0.001).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

console.log(`\ndocs-sync ${DRY ? "(check mode)" : "(patch mode)"}`);
console.log(`  prices: basic=${basic} full=${full} live=${live}`);
console.log(`  version: ${version}\n`);

// README.md
patch("README.md", [
  // pricing table rows — match the full row (all columns to end of line)
  [
    /\| \*\*Basic\*\* \|[^\n]+/,
    `| **Basic** | ${basic.toLocaleString("en-US")} sats (${usd(basic)}) | Quick scan — up to 10 key files, main services detected. **First analysis per IP is free.** |`,
  ],
  [
    /\| \*\*Full\*\* \|[^\n]+/,
    `| **Full** | ${full.toLocaleString("en-US")} sats (${usd(full)}) | Complete repo analysis — all services, connections, monorepos, notebooks, benchmark, diff, share link |`,
  ],
  [
    /\| \*\*Live\*\* \|[^\n]+/,
    `| **Live** | ${live.toLocaleString("en-US")} sats (${usd(live)}) | Full analysis + animated SVG particle flows, minimap, built-in screen recorder |`,
  ],
  // badges
  [/tests-\d+_passing/, `tests-${version.replace(/\./g, "_")}_passing`],
]);

// README_TECH.md
patch("README_TECH.md", [
  // /health response
  [
    /"tiers":\s*\{[^}]+\}/,
    `"tiers": { "basic": ${basic}, "full": ${full}, "live": ${live} }`,
  ],
  // flow diagram sats label
  [
    /createInvoice\([\d,.]+ sats\)/,
    `createInvoice(${full.toLocaleString("en-US")} sats)`,
  ],
  // response example paid_sats
  [/"paid_sats":\s*\d+/, `"paid_sats": ${full}`],
  // 402 response amount_sats
  [/"amount_sats":\s*\d+/, `"amount_sats": ${full}`],
  // revenue table
  [
    /\| Lightning basic \([\d,.]+ sats\)[^\n]*/,
    `| Lightning basic (${basic.toLocaleString("en-US")} sats) | ${usd(basic)} | $0.02 | **$${(basic * 0.001 - 0.02).toFixed(2)}** |`,
  ],
  [
    /\| Lightning full \([\d,.]+ sats\)[^\n]*/,
    `| Lightning full (${full.toLocaleString("en-US")} sats) | ${usd(full)} | $0.03 | **$${(full * 0.001 - 0.03).toFixed(2)}** |`,
  ],
  [
    /\| Lightning live \([\d,.]+ sats\)[^\n]*/,
    `| Lightning live (${live.toLocaleString("en-US")} sats) | ${usd(live)} | $0.03 | **$${(live * 0.001 - 0.03).toFixed(2)}** |`,
  ],
]);

// CREDENTIALS.owner.md
patch("CREDENTIALS.owner.md", [
  [/\| basic \| [\d,.]+ \|/, `| basic | ${basic.toLocaleString("en-US")} |`],
  [/\| full \| [\d,.]+ \|/, `| full | ${full.toLocaleString("en-US")} |`],
  [/\| live \| [\d,.]+ \|/, `| live | ${live.toLocaleString("en-US")} |`],
]);

// vscode-extension README
patch("vscode-extension/README.md", [
  [
    /\*\*Basic\*\*[^–—-]*[–—-][^()\n]*(basic)/i,
    `**Basic** — ${basic.toLocaleString("en-US")} sats (${usd(basic)}) — quick scan, main services ($1)`,
  ],
  [
    /\*\*Full\*\*[^–—-]*[–—-][^()\n]*(full)/i,
    `**Full** — ${full.toLocaleString("en-US")} sats (${usd(full)}) — complete analysis ($1)`,
  ],
  [
    /\*\*Live\*\*[^–—-]*[–—-][^()\n]*(live)/i,
    `**Live** — ${live.toLocaleString("en-US")} sats (${usd(live)}) — analysis + animated diagram ($1)`,
  ],
]);

console.log();
if (DRY && drifted) {
  process.exit(1);
}
