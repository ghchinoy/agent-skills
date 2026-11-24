#!/usr/bin/env node
// Static CSP, token, icon, overlay, SSR, and accessibility auditor for @ghchinoy/lustrous-lit codebases.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RULES_PATH = fileURLToPath(new URL("../assets/rules-data.json", import.meta.url));
const rulesData = JSON.parse(readFileSync(RULES_PATH, "utf8"));

const VALID_TOKENS = new Set(rulesData.tokens);
const COMPONENT_CSS_PROPS = new Set(rulesData.componentCssProperties);
const VALID_ICONS = new Set(rulesData.icons);

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".astro",
  ".svelte-kit",
  "storybook-static",
  "playwright-report-visual",
  "playwright-report-a11y",
  "test-results",
  "coverage",
]);

const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".vue", ".svelte", ".html", ".css"]);

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage:
  audit-lustrous.mjs [path...] [--allow-custom-icons icon1,icon2] [--json]

Audits source files using @ghchinoy/lustrous-lit for:
  CSP-01  Inline style= attributes in templates/HTML
  TOK-01  Hardcoded fallback in var(--lustrous-*, fallback)
  TOK-02  Unknown --lustrous-* CSS custom property name
  TOK-03  Raw hex color literals inside component styles
  ICO-01  Unregistered Lustrous icon name
  A11Y-01 <lustrous-icon-button> / <lustrous-togglable-icon-button> missing aria-label
  OVR-01  dismissedAt = 0 initialization (must be -Infinity)
  SSR-01  Unguarded this.attachInternals() call`);
  process.exit(0);
}

let asJson = false;
const targets = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--json") {
    asJson = true;
  } else if (args[i] === "--allow-custom-icons" && args[i + 1]) {
    for (const name of args[++i].split(",").map((s) => s.trim()).filter(Boolean)) {
      VALID_ICONS.add(name);
    }
  } else if (!args[i].startsWith("--")) {
    targets.push(args[i]);
  }
}
if (targets.length === 0) targets.push(".");

const findings = [];
const cwd = process.cwd();

function isTestOrStory(rel) {
  return (
    rel.endsWith(".test.ts") ||
    rel.endsWith(".test.tsx") ||
    rel.endsWith(".spec.ts") ||
    rel.endsWith(".stories.ts") ||
    rel.endsWith(".stories.tsx")
  );
}

function lineAt(content, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

function collectFiles(targetPath, acc = []) {
  const abs = resolve(cwd, targetPath);
  if (!existsSync(abs)) {
    console.error(`Path not found: ${targetPath}`);
    process.exit(2);
  }
  const st = statSync(abs);
  if (st.isFile()) {
    const rel = relative(cwd, abs).split("\\").join("/") || abs;
    if (!isTestOrStory(rel) && CODE_EXTS.has(extname(abs))) acc.push(abs);
    return acc;
  }
  for (const ent of readdirSync(abs, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(ent.name)) continue;
    const child = join(abs, ent.name);
    if (ent.isDirectory()) collectFiles(child, acc);
    else {
      const rel = relative(cwd, child).split("\\").join("/") || child;
      if (!isTestOrStory(rel) && CODE_EXTS.has(extname(child))) acc.push(child);
    }
  }
  return acc;
}

function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

function scanFile(fullPath) {
  const rel = relative(cwd, fullPath).split("\\").join("/") || fullPath;
  const ext = extname(fullPath);
  const content = readFileSync(fullPath, "utf8");
  const cleanContent = isPureHtml(ext) ? content.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " ")) : stripJsComments(content);
  const lines = cleanContent.split("\n");
  const isPureCss = ext === ".css";
  const isTokensSource = rel.endsWith("tokens.ts") || rel.endsWith("lustrous-theme.css") || rel.endsWith("theme-overrides.css");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // CSP-01: inline style= attribute in markup/templates
    if (!isPureCss && /(?:^|[\s<])style=(?:["'`$]|\{)/.test(line)) {
      findings.push({
        severity: "FAIL",
        rule: "CSP-01",
        file: rel,
        line: i + 1,
        message: "Inline style= attribute breaks strict style-src 'self' CSP; use a --_lustrous-* CSSOM property instead.",
      });
    }

    // TOK-01: var(--lustrous-*, fallback)
    for (const m of line.matchAll(/var\(\s*(--lustrous-[a-zA-Z0-9-]+)\s*,/g)) {
      const prop = m[1];
      if (!COMPONENT_CSS_PROPS.has(prop)) {
        findings.push({
          severity: "WARN",
          rule: "TOK-01",
          file: rel,
          line: i + 1,
          message: `Avoid hardcoded fallback in var(${prop}, ...); LustrousElement guarantees theme tokens on connect.`,
        });
      }
    }

    // TOK-02: unknown --lustrous-* token reference (skip dynamic prefix concatenations ending in `-`)
    if (!isTokensSource) {
      for (const m of line.matchAll(/--lustrous-[a-zA-Z0-9-]+/g)) {
        const prop = m[0];
        const nextChar = line[m.index + prop.length] ?? "";
        if (prop.endsWith("-") || nextChar === "$") continue;
        const after = line.slice(m.index + prop.length);
        if (/^\s*:/.test(after)) continue;
        if (!VALID_TOKENS.has(prop) && !COMPONENT_CSS_PROPS.has(prop)) {
          findings.push({
            severity: "FAIL",
            rule: "TOK-02",
            file: rel,
            line: i + 1,
            message: `Unknown Lustrous CSS token "${prop}". Run lookup-lustrous.mjs --tokens to inspect valid names.`,
          });
        }
      }
    }

    // OVR-01: dismissedAt = 0
    if (/\bdismissedAt\s*(?::[^=]+)?=\s*0\b/.test(line)) {
      findings.push({
        severity: "FAIL",
        rule: "OVR-01",
        file: rel,
        line: i + 1,
        message: "Initialize dismissedAt = -Infinity (not 0) so clicks within 300ms of page load are not dropped.",
      });
    }

    // SSR-01: unguarded this.attachInternals()
    if (
      /\bthis\.attachInternals\s*\(/.test(line) &&
      !/typeof\s+this\.attachInternals/.test(line) &&
      !/typeof\s+this\.attachInternals/.test(lines[i - 1] ?? "")
    ) {
      findings.push({
        severity: "FAIL",
        rule: "SSR-01",
        file: rel,
        line: i + 1,
        message: 'Guard this.attachInternals() with typeof this.attachInternals === "function" (or ?.) for @lit-labs/ssr safety.',
      });
    }

    // ICO-01: static icon name literals on Lustrous elements / renderIcon()
    for (const m of line.matchAll(
      /\b(?:(?:leading-|trailing-|selected-|off-)?icon|renderIcon\s*\()\s*(?:=\s*)?["']([A-Za-z0-9_-]+)["']/g,
    )) {
      const iconName = m[1];
      if (!VALID_ICONS.has(iconName)) {
        findings.push({
          severity: "WARN",
          rule: "ICO-01",
          file: rel,
          line: i + 1,
          message: `Icon "${iconName}" is not in LustrousCoreIconName (pass --allow-custom-icons if registered via registerLustrousIcons).`,
        });
      }
    }
    for (const m of line.matchAll(/<lustrous-icon\b[^>]*\bname\s*=\s*["']([A-Za-z0-9_-]+)["']/g)) {
      const iconName = m[1];
      if (!VALID_ICONS.has(iconName)) {
        findings.push({
          severity: "WARN",
          rule: "ICO-01",
          file: rel,
          line: i + 1,
          message: `Icon "${iconName}" on <lustrous-icon> is not in LustrousCoreIconName.`,
        });
      }
    }
  }

  // Multi-line check A11Y-01: <lustrous-icon-button ...> or <lustrous-togglable-icon-button ...> missing aria-label / aria-labelledby / label
  for (const m of cleanContent.matchAll(/(?<!["'])<lustrous-(?:togglable-)?icon-button\b([\s\S]*?)>/g)) {
    const attrs = m[1];
    if (!/\b(?:aria-label(?:ledby)?|label)\s*=/.test(attrs) && !/\.\.\./.test(attrs)) {
      findings.push({
        severity: "FAIL",
        rule: "A11Y-01",
        file: rel,
        line: lineAt(cleanContent, m.index),
        message: "Icon-only button is missing aria-label or aria-labelledby (WCAG 2.1 SC 4.1.2).",
      });
    }
  }

  // TOK-03: raw hex colors inside Lit css`...` blocks (excluding `--lustrous-*:` theme override declarations)
  if (!isTokensSource && (ext === ".ts" || ext === ".js")) {
    for (const block of cleanContent.matchAll(/\bcss`([\s\S]*?)`/g)) {
      const cssBody = block[1];
      for (const hex of cssBody.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        const lineNum = lineAt(cleanContent, block.index + hex.index);
        const srcLine = lines[lineNum - 1] ?? "";
        if (/--lustrous-[a-zA-Z0-9-]+\s*:/.test(srcLine)) continue;
        findings.push({
          severity: "WARN",
          rule: "TOK-03",
          file: rel,
          line: lineNum,
          message: `Hardcoded hex color "${hex[0]}" inside component css block; prefer --lustrous-color-* tokens.`,
        });
      }
    }
  }
}

function isPureHtml(ext) {
  return ext === ".html" || ext === ".vue" || ext === ".svelte";
}

const filesToScan = [];
for (const t of targets) collectFiles(t, filesToScan);

// Pass 1: auto-discover any custom icons registered via registerLustrousIcons({ ... }) across scanned files
for (const f of filesToScan) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/registerLustrousIcons\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
    for (const k of m[1].matchAll(/^\s*["']?([A-Za-z0-9_-]+)["']?\s*:/gm)) {
      VALID_ICONS.add(k[1]);
    }
  }
}

// Pass 2: run lint rules
for (const f of filesToScan) scanFile(f);

const fails = findings.filter((f) => f.severity === "FAIL").length;
const warns = findings.filter((f) => f.severity === "WARN").length;

if (asJson) {
  console.log(
    JSON.stringify(
      {
        status: fails > 0 ? "FAIL" : warns > 0 ? "WARN" : "PASS",
        summary: { fail: fails, warn: warns, total: findings.length },
        findings,
      },
      null,
      2,
    ),
  );
} else if (findings.length === 0) {
  console.log("PASS: 0 Lustrous CSP, token, icon, SSR, or accessibility issues found.");
} else {
  for (const f of findings) {
    console.log(`[${f.severity}] ${f.rule} ${f.file}:${f.line} — ${f.message}`);
  }
  console.log(`\nSummary: ${fails} FAIL, ${warns} WARN (${findings.length} total).`);
}

process.exit(fails > 0 ? 1 : 0);
