// frontmatter.mjs — parsing and validating the DECLARED half of a SKILL.md.
//
// Parsed with a real YAML parser, never a regex (I8: three descriptions in the
// repo are double-quoted because they contain apostrophes, and two are long
// enough to wrap; a regex gets both wrong).
//
// The Agent Skills top-level vocabulary is CLOSED at exactly six names. That is
// why the check below is an allowlist rather than a passthrough: a seventh
// top-level key is not a field this site can render, because the format does
// not have one. Both standards tell clients to REPORT AND IGNORE unknown
// fields rather than assign them semantics (Agent Plugins §5.2 says so
// normatively), so an unknown key becomes an advisory and is dropped from the
// data the templates see. Rendering it would be inventing a field.
//
// `metadata` is the deliberate exception: the spec defines it as an arbitrary
// key-value mapping for "additional properties not defined by the Agent Skills
// spec", so its INNER vocabulary stays open and a new `metadata.homepage`
// tomorrow renders in a generic labelled row.

import { parse as parseYaml } from "yaml";

/** The closed six-name top-level vocabulary. Order is the spec's. */
export const ALLOWED_FIELDS = [
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
];

const FM_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Splits a `SKILL.md` into its YAML frontmatter and its body.
 *
 * @param {string} raw
 * @param {string} file  repo-relative path, for error messages
 * `bodyFirstLine` is the SOURCE-FILE line the body's first line occupies, so
 * every downstream advisory and build error can name a line the reader can
 * actually open.
 *
 * @returns {{data: object, body: string, fmText: string, fmFirstLine: number, bodyFirstLine: number}}
 */
export function splitFrontmatter(raw, file) {
  const m = FM_RE.exec(raw);
  if (!m) {
    throw new Error(
      `skills-loader: ${file} has no parseable YAML frontmatter block. ` +
        `Agent Skills requires \`name\` and \`description\` in frontmatter.`,
    );
  }
  const fmText = m[1];
  const body = raw.slice(m[0].length);
  let data;
  try {
    data = parseYaml(fmText);
  } catch (err) {
    throw new Error(`skills-loader: ${file} frontmatter is not valid YAML: ${err.message}`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`skills-loader: ${file} frontmatter is not a YAML mapping.`);
  }
  // The `---` opener occupies line 1, so frontmatter key N sits at file line
  // N + 1. The body starts on the line after the closing `---`.
  const consumedLines = (m[0].match(/\n/g) ?? []).length;
  return { data, body, fmText, fmFirstLine: 2, bodyFirstLine: consumedLines + 1 };
}

/** 1-based file line of the first top-level frontmatter key named `key`. */
export function frontmatterKeyLine(fmText, fmFirstLine, key, { nested = false } = {}) {
  const lines = fmText.split("\n");
  const re = nested
    ? new RegExp(`^\\s+${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`)
    : new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`);
  for (let i = 0; i < lines.length; i += 1) {
    if (re.test(lines[i])) return fmFirstLine + i;
  }
  return null;
}

/**
 * Validates declared frontmatter against the closed vocabulary and returns
 * ONLY the declared fields, plus advisories.
 *
 * Absence is represented as absence: a field the author did not declare is not
 * present on the returned object, so a template branches on `undefined` rather
 * than on a sentinel. There is no default value anywhere in this function.
 *
 * @param {object} data      parsed YAML mapping
 * @param {object} opts
 * @param {string} opts.file        repo-relative path
 * @param {string} opts.fmText
 * @param {number} opts.fmFirstLine
 * @param {string} opts.expectedName  the directory name (the spec requires a match)
 *
 * The returned shape is the closed vocabulary itself. `name` and `description`
 * are non-optional because this function throws rather than return without
 * them; the other four are absent when undeclared, never defaulted.
 *
 * @typedef {object} DeclaredFields
 * @property {string} name
 * @property {string} description
 * @property {string} [license]
 * @property {string} [compatibility]
 * @property {string} ["allowed-tools"]
 * @property {Record<string, string|string[]>} [metadata]
 *
 * @returns {{declared: DeclaredFields, advisories: import("./enumerate.mjs").Advisory[]}}
 */
export function analyzeDeclared(data, { file, fmText, fmFirstLine, expectedName }) {
  /** @type {import("./enumerate.mjs").Advisory[]} */
  const advisories = [];
  // Built key by key from an allowlist, so it is `any` in here and
  // `DeclaredFields` on the way out — the two required fields are enforced by
  // the throw below, which a structural type cannot express.
  /** @type {any} */
  const declared = {};

  for (const key of Object.keys(data)) {
    if (!ALLOWED_FIELDS.includes(key)) {
      advisories.push({
        code: "UNKNOWN-FIELD",
        file,
        line: frontmatterKeyLine(fmText, fmFirstLine, key),
        message:
          `unknown top-level frontmatter key "${key}". The Agent Skills ` +
          `top-level vocabulary is closed at ${ALLOWED_FIELDS.join(", ")}; ` +
          `both standards say to report and ignore unknown fields rather ` +
          `than assign them semantics, so this key is NOT rendered.`,
      });
      continue;
    }
    declared[key] = data[key];
  }

  // ── Required by the spec. Missing is a build error, not an advisory: there
  //    is no honest page to render without them.
  for (const req of ["name", "description"]) {
    if (typeof declared[req] !== "string" || declared[req].trim() === "") {
      throw new Error(
        `skills-loader: ${file} declares no non-empty \`${req}\`. Agent ` +
          `Skills requires it, and this site renders only what is declared.`,
      );
    }
  }

  if (expectedName && declared.name !== expectedName) {
    advisories.push({
      code: "NAME-DIR-SKEW",
      file,
      line: frontmatterKeyLine(fmText, fmFirstLine, "name"),
      message:
        `frontmatter \`name\` is "${declared.name}" but the skill directory ` +
        `is "${expectedName}"; Agent Skills requires them to match.`,
    });
  }

  // ── D1: metadata values that are sequences, not strings ────────────────────
  // The spec's table defines `metadata` as a map from string keys to string
  // VALUES, and the reference implementation coerces with `str(v)` — so a
  // conformant-but-literal client renders this repo's `sources` as the literal
  // string "['Open Knowledge Format (OKF) SPEC.md v0.2 — …']", Python-repr
  // brackets and all. This site renders the list the author actually wrote,
  // because the intent is unambiguous and the bracketed repr would be strictly
  // worse to read — and it reports the deviation so the normalisation is never
  // silent. Render generously, report accurately.
  if (declared.metadata !== undefined) {
    const meta = declared.metadata;
    if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
      throw new Error(
        `skills-loader: ${file} declares \`metadata\` that is not a mapping.`,
      );
    }
    for (const [k, v] of Object.entries(meta)) {
      if (Array.isArray(v)) {
        advisories.push({
          code: "D1",
          file,
          line: frontmatterKeyLine(fmText, fmFirstLine, k, { nested: true }),
          message:
            `metadata.${k} is a YAML sequence of ${v.length} ` +
            `item${v.length === 1 ? "" : "s"}; the Agent Skills spec defines ` +
            `metadata as a map of string keys to string VALUES. Rendered as ` +
            `the declared list, NOT stringified.`,
        });
        for (const item of v) {
          if (typeof item !== "string") {
            throw new Error(
              `skills-loader: ${file} metadata.${k} contains a non-string item.`,
            );
          }
        }
      } else if (typeof v !== "string") {
        advisories.push({
          code: "D1",
          file,
          line: frontmatterKeyLine(fmText, fmFirstLine, k, { nested: true }),
          message:
            `metadata.${k} is ${typeof v}, not a string, which the spec's ` +
            `metadata table calls for.`,
        });
      }
    }
  }

  return { declared, advisories };
}
