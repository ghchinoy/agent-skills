// spec-source.mjs — read `site/specification-source.json`, validate it, and
// hand the build the pinned spec revisions.
//
// Proposal §2 calls this "a technique worth stealing" from
// `agent-plugins-site/specification-source.json`: it converts "which version of
// the spec does this page describe?" from a thing someone remembers into a
// thing the build reads, and makes a spec bump a visible one-line diff.
//
// THE POINT IS THE READ, NOT THE FILE. Phase 5 AC5 says the file must exist,
// pin both specs, "and the build READS IT rather than hardcoding a version
// string." A JSON file nobody parses is documentation; the reason this module
// exists is that `/about/standards/` cannot render a version at all except
// through here, so a stale pin is a visibly stale page rather than an unread
// file. `tests/spec-source.test.mjs` asserts the complement: no spec version
// literal anywhere in `site/src`.
//
// ── WHY VALIDATION IS FATAL AND NOT A WARNING ────────────────────────────────
//
// Every throw below is a build failure. That is deliberate, and the reason is
// the standing question this repository's suite is written against: ASK WHAT
// RESULT WOULD HAVE COUNTED AS A FAILURE. A loader that fell back to "latest",
// or to `??` defaults, would make this file a pin that cannot fail — it would
// go green whether or not anyone had ever maintained it, which is precisely the
// class of check that confirms a reader in a stale citation while reporting
// success. So: unreadable, unparseable, missing a required field, or carrying a
// commit that is not a 40-hex sha, all stop the build.
//
// ── THE ABSENCE PROTOCOL, WHICH IS THE UNUSUAL PART ──────────────────────────
//
// AC5 asks for BOTH specs pinned "by version and commit". One of them has no
// version. **The Agent Skills specification declares no version of itself** —
// measured, with a positive control, at the commit pinned in the JSON; the
// predicates are in the file beside the values, because a figure ships with the
// predicate that produced it or it does not ship.
//
// Filling that key with "0.1.0" (the `skills-ref` LIBRARY version), or "1.0.0",
// or "unknown", or "n/a", would satisfy any is-non-empty assertion and would be
// a fabrication — the same move §12 answers with "Missing metadata shows as
// absent, not stubbed." So the key is genuinely absent.
//
// But a silently absent key and an absent key nobody noticed are the same
// bytes. So absence here is DECLARED: `declaredAbsent` names each omitted key
// with the predicate that established the omission. The invariants below make
// that a two-way gate, and both directions can fail:
//
//   • a key present in BOTH `declaredAbsent` and the entry  → throw.
//     Someone filled in a field we measured to be absent. This is the direction
//     that catches a future fabrication.
//   • a key in neither                                       → throw.
//     Someone dropped a field without recording that they had looked. This is
//     the direction that catches a silent loss — C10 in a JSON file.
//
// Neither direction is decorative: `tests/spec-source.test.mjs` mutates the
// parsed object both ways and requires a throw each time.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `site/`, derived from this module's own location rather than a cwd. */
const siteRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The pin file's path, written once and exported so tests cannot drift from it. */
export const SPEC_SOURCE_PATH = join(siteRoot, "specification-source.json");

/** Fields every pinned specification must either DECLARE or DECLARE ABSENT. */
export const PINNED_FIELDS = ["version", "status", "commit"];

/** Fields that may never be absent: without these there is no pin at all. */
export const REQUIRED_FIELDS = ["id", "name", "home", "repository", "commit"];

const SHA1 = /^[0-9a-f]{40}$/;

/**
 * Validates one specification entry. Throws on anything that would let a stale
 * or invented pin reach a page.
 *
 * @param {any} spec
 * @param {number} index position in the array, so an error names the entry even
 *   when the entry is too malformed to have an `id`.
 */
export function validateSpec(spec, index) {
  const where = `specification-source.json specifications[${index}]`;

  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error(`${where} is not an object.`);
  }

  for (const field of REQUIRED_FIELDS) {
    if (typeof spec[field] !== "string" || spec[field].trim() === "") {
      throw new Error(
        `${where} declares no ${field}. Every pinned specification needs one; ` +
          `a pin missing its ${field} is not a pin.`,
      );
    }
  }

  if (!SHA1.test(spec.commit)) {
    throw new Error(
      `${where} (${spec.id}) has commit ${JSON.stringify(spec.commit)}, which is ` +
        `not a 40-character hex sha. An abbreviated or symbolic commit is not a ` +
        `pin: it can resolve to different objects at different times.`,
    );
  }

  const absent = spec.declaredAbsent;
  if (absent === null || typeof absent !== "object" || Array.isArray(absent)) {
    throw new Error(
      `${where} (${spec.id}) has no declaredAbsent object. Write {} if every ` +
        `field is declared — an omitted declaredAbsent is indistinguishable ` +
        `from one nobody wrote.`,
    );
  }

  for (const field of PINNED_FIELDS) {
    const declared = typeof spec[field] === "string" && spec[field].trim() !== "";
    const markedAbsent = Object.prototype.hasOwnProperty.call(absent, field);

    if (declared && markedAbsent) {
      throw new Error(
        `${where} (${spec.id}) declares ${field}=${JSON.stringify(spec[field])} ` +
          `AND lists ${field} in declaredAbsent. One of those is wrong. If the ` +
          `upstream specification has started declaring a ${field}, remove the ` +
          `declaredAbsent entry in the same commit that adds the value, and say ` +
          `where the value came from.`,
      );
    }

    if (!declared && !markedAbsent) {
      throw new Error(
        `${where} (${spec.id}) has neither a ${field} nor a declaredAbsent.${field} ` +
          `entry. A field can be absent — some specifications genuinely do not ` +
          `declare one — but the absence has to be RECORDED, with the predicate ` +
          `that established it. An unrecorded absence and an oversight are the ` +
          `same bytes.`,
      );
    }

    if (markedAbsent) {
      const record = absent[field];
      if (
        record === null ||
        typeof record !== "object" ||
        typeof record.reason !== "string" ||
        record.reason.trim() === "" ||
        typeof record.predicate !== "string" ||
        record.predicate.trim() === ""
      ) {
        throw new Error(
          `${where} (${spec.id}) marks ${field} absent without both a reason and ` +
            `a predicate. A figure ships with the predicate that produced it, and ` +
            `so does a ZERO: an absence nobody can re-derive is an assertion, not ` +
            `a measurement.`,
        );
      }
    }
  }

  return spec;
}

/**
 * Parses and validates the whole pin file.
 *
 * Separated from `loadSpecSource()` so tests can drive it with a mutated object
 * without touching the real file — which is how the two-way gate above is
 * proven able to fail.
 *
 * @param {any} data parsed JSON
 */
export function validateSpecSource(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("specification-source.json does not contain a JSON object.");
  }
  if (!Array.isArray(data.specifications) || data.specifications.length === 0) {
    throw new Error(
      "specification-source.json has no non-empty `specifications` array. The " +
        "file exists to pin the standards this site was built against; an empty " +
        "one pins nothing while looking like it does.",
    );
  }

  data.specifications.forEach(validateSpec);

  const ids = data.specifications.map((s) => s.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) {
    throw new Error(
      `specification-source.json pins ${dupes.join(", ")} more than once. Two ` +
        `entries for one standard means one of them is being ignored and nobody ` +
        `can tell which.`,
    );
  }

  return data;
}

/**
 * Reads, parses and validates `site/specification-source.json`.
 *
 * @returns {Promise<{measuredAt: string, specifications: any[]}>}
 */
export async function loadSpecSource() {
  let raw;
  try {
    raw = await readFile(SPEC_SOURCE_PATH, "utf8");
  } catch (err) {
    throw new Error(
      `spec-source: cannot read ${SPEC_SOURCE_PATH}. This file is the only ` +
        `place the site learns which revision of each standard it was built ` +
        `against, and nothing falls back to a default — a default here would be ` +
        `a version string the build invented. ${err.message}`,
    );
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`spec-source: ${SPEC_SOURCE_PATH} is not valid JSON. ${err.message}`);
  }

  return validateSpecSource(data);
}

/**
 * The one-line human rendering of a pin, used by `/about/standards/`.
 *
 * Absence renders as absence: a specification with no declared version gets no
 * version clause, not "version unknown". The sentence is assembled from the
 * clauses that have values, so it is shorter when there is less to say.
 *
 * @param {any} spec a validated entry
 */
export function pinSentence(spec) {
  const clauses = [];
  if (spec.version) clauses.push(`version \`${spec.version}\``);
  if (spec.status) clauses.push(`status \`${spec.status}\``);
  clauses.push(`commit \`${spec.commit}\``);
  return clauses.join(", ");
}
