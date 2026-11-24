#!/usr/bin/env node
// Fast CLI lookup over assets/catalog.json for @ghchinoy/lustrous-lit components, tokens, and icons.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CATALOG_PATH = fileURLToPath(new URL("../assets/catalog.json", import.meta.url));
const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const filtered = args.filter((a) => a !== "--json");

function usage() {
  console.log(`Usage:
  lookup-lustrous.mjs <component-query>      Inspect matching <lustrous-*> component APIs
  lookup-lustrous.mjs --list                 List all ${catalog.components.length} <lustrous-*> components
  lookup-lustrous.mjs --tokens [query]       Search --lustrous-* CSS custom properties
  lookup-lustrous.mjs --icons [query]        Search built-in Lustrous icon names
  (Add --json to any command for structured JSON output)`);
}

if (filtered.length === 0 || filtered.includes("--help") || filtered.includes("-h")) {
  usage();
  process.exit(0);
}

if (filtered[0] === "--list") {
  const rows = catalog.components.map((c) => ({
    tag: c.tag,
    importPath: c.importPath,
    formAssociated: c.formAssociated,
    summary: c.summary,
  }));
  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    for (const r of rows) {
      const formBadge = r.formAssociated ? " [form]" : "";
      console.log(`<${r.tag}>${formBadge}  (${r.importPath})\n  ${r.summary}`);
    }
  }
  process.exit(0);
}

if (filtered[0] === "--tokens") {
  const q = (filtered[1] ?? "").toLowerCase();
  const hits = catalog.tokens.filter(
    (t) => !q || t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q),
  );
  if (asJson) {
    console.log(JSON.stringify(hits, null, 2));
  } else {
    for (const t of hits) {
      const val = t.dark ? `light: ${t.value} | dark: ${t.dark}` : t.value;
      console.log(`${t.name}  [${t.category}]  ${val}`);
    }
    console.log(`\nMatched ${hits.length} of ${catalog.tokens.length} tokens.`);
  }
  process.exit(0);
}

if (filtered[0] === "--icons") {
  const q = (filtered[1] ?? "").toLowerCase();
  const hits = catalog.icons.filter((i) => !q || i.name.toLowerCase().includes(q));
  if (asJson) {
    console.log(JSON.stringify(hits, null, 2));
  } else {
    for (const i of hits) {
      console.log(`${i.name}${i.directional ? "  [directional-rtl]" : ""}`);
    }
    console.log(`\nMatched ${hits.length} of ${catalog.icons.length} core icons.`);
  }
  process.exit(0);
}

const query = filtered[0].toLowerCase().replace(/^<|>$/g, "");
const matches = catalog.components.filter(
  (c) =>
    c.tag.toLowerCase() === query ||
    c.tag.toLowerCase() === `lustrous-${query}` ||
    c.tag.toLowerCase().includes(query) ||
    c.className.toLowerCase().includes(query),
);

if (matches.length === 0) {
  console.error(`No component matching "${filtered[0]}". Try --list, --tokens, or --icons.`);
  process.exit(1);
}

if (asJson) {
  console.log(JSON.stringify(matches, null, 2));
  process.exit(0);
}

for (const c of matches) {
  console.log(`=== <${c.tag}> (${c.className}) ===`);
  console.log(`Import: import "${c.importPath}";`);
  if (c.superclass) console.log(`Extends: ${c.superclass}${c.formAssociated ? " (formAssociated)" : ""}`);
  if (c.summary) console.log(`Summary: ${c.summary}`);
  if (c.properties.length > 0) {
    console.log("Properties / Attributes:");
    for (const p of c.properties) {
      const attr = p.attribute ? ` [attr: ${p.attribute}]` : " [prop-only]";
      const def = p.default !== undefined ? ` = ${p.default}` : "";
      console.log(`  - ${p.name}: ${p.type || "unknown"}${def}${attr}${p.description ? ` — ${p.description}` : ""}`);
    }
  }
  if (c.events.length > 0) {
    console.log("Events:");
    for (const e of c.events) {
      console.log(`  - ${e.name}${e.type ? ` (${e.type})` : ""}${e.description ? ` — ${e.description}` : ""}`);
    }
  }
  if (c.slots.length > 0) {
    console.log("Slots:");
    for (const s of c.slots) {
      console.log(`  - ${s.name || "(default)"}${s.description ? ` — ${s.description}` : ""}`);
    }
  }
  if (c.cssParts.length > 0) {
    console.log("CSS Parts:");
    for (const part of c.cssParts) {
      console.log(`  - ::part(${part.name})${part.description ? ` — ${part.description}` : ""}`);
    }
  }
  if (c.cssProperties.length > 0) {
    console.log("Component CSS Properties:");
    for (const cp of c.cssProperties) {
      console.log(`  - ${cp.name}${cp.description ? ` — ${cp.description}` : ""}`);
    }
  }
  console.log("");
}
