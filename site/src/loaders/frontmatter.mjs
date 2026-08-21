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
        `skills-loader: ${file}:${frontmatterKeyLine(fmText, fmFirstLine, "metadata")} ` +
          `— \`metadata\` is ${Array.isArray(meta) ? "a sequence" : `${typeof meta}`}, ` +
          `not a mapping. The spec defines it as a map of string keys to ` +
          `string values.`,
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
            // Same C3 reasoning, same obligation to name a line.
            throw new Error(
              `skills-loader: ${file}:${frontmatterKeyLine(fmText, fmFirstLine, k, { nested: true })} ` +
                `— metadata.${k} is a sequence containing a ${typeof item} ` +
                `(${JSON.stringify(item)}). The spec allows string values; ` +
                `this site renders the declared list rather than stringifying ` +
                `it, but it will not coerce a non-string item. Quote it.`,
            );
          }
        }
      } else if (typeof v !== "string") {
        // C3. This used to be an advisory, and then the value fell through to
        // a Zod schema that accepts only string | string[] — so the build died
        // on Astro's generic "Invalid content entry frontmatter" with no file
        // and no line, which is exactly the diagnostic quality this loader
        // exists to avoid. It is a hard error here instead, and it names the
        // line.
        //
        // Hard error rather than coercion, deliberately: `String(v)` looks
        // harmless until `metadata.version: 1.10` renders as "1.1", because
        // YAML parsed it as a float before this code ever saw it. Silently
        // publishing a version number that is not the one the author wrote is
        // worse than refusing to publish. Quoting the value fixes it and
        // preserves the author's bytes.
        const shown =
          v === null ? "null (an empty YAML value)" : `${typeof v} (${JSON.stringify(v)})`;
        throw new Error(
          `skills-loader: ${file}:${frontmatterKeyLine(fmText, fmFirstLine, k, { nested: true })} ` +
            `— metadata.${k} is ${shown}, but the Agent Skills spec defines ` +
            `metadata as a map of string keys to string VALUES. This site ` +
            `renders declared bytes and will not coerce: YAML has already ` +
            `turned an unquoted 1.10 into 1.1 by this point, and publishing ` +
            `that as if the author wrote it would be a fabrication. Quote the ` +
            `value in the source frontmatter.`,
        );
      }
    }
  }

  return { declared, advisories };
}
