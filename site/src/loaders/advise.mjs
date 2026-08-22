// advise.mjs — the three findings that need a SKILL.md and its own resource
// inventory side by side (proposal §3.4 D2, §3.4 D4, §3.7 I4).
//
// The other advisories live next to the data they measure: D1 in
// frontmatter.mjs, D3 in links.mjs, I1 and MANIFEST-NAME-SKEW in
// enumerate.mjs, I3 in skills.ts. These three have no single home of that
// kind — each one is a statement about a FILE compared against a DIRECTORY —
// so they share a module rather than being scattered through the loader.
//
// Every function here REPORTS AND NEVER REPAIRS (§6.5). Nothing in this file
// rewrites a body, synthesizes a link, or invents a description.
//
// A NOTE ON THE NUMBERS IN THE PROPOSAL. §3.4 and §3.7 state instances that
// were measured when the proposal was written: one 670-line SKILL.md, two
// dead pointers at `macos-hig-reviewer/SKILL.md:42,48`, four orphans. Not one
// of those is written down here. Each function below states a CONDITION and
// applies it to every skill the enumerator found; where the derived
// population differs from the proposal's, the difference is a finding
// reported in reports/phase4-siteA.md, not a filter added here to make the
// two agree.

import { inlineCodeSpans } from "./markdown.mjs";

/**
 * The Agent Skills specification's progressive-disclosure guidance, quoted in
 * proposal §3.4 D2: "Keep your main `SKILL.md` under 500 lines". A guidance
 * number from another document, so it is named, cited, and used once.
 *
 * "Under 500" means 500 is allowed and 501 is not, which is why the
 * comparison below is `>` and why the reported line is this value plus one.
 */
export const SKILL_MD_LINE_GUIDANCE = 500;

/** The three per-skill resource directories §7.1's layout defines. */
export const RESOURCE_GROUPS = /** @type {const} */ (["references", "scripts", "assets"]);

/**
 * Counts lines the way a reader's editor does: one per newline, plus a final
 * unterminated line when the file does not end in one. `split("\n").length`
 * would report 671 for a 670-line file that ends in a newline, by counting
 * the empty string after the last one.
 *
 * @param {string} text
 * @returns {number}
 */
export function countLines(text) {
  if (text === "") return 0;
  const newlines = (text.match(/\n/g) ?? []).length;
  return text.endsWith("\n") ? newlines : newlines + 1;
}

/**
 * D2 — a SKILL.md longer than the spec's progressive-disclosure guidance.
 *
 * The whole file is measured, frontmatter included, because that is what the
 * guidance is about and what the reader's editor will show. Advisory only:
 * the site renders the file in full either way (§6.5).
 *
 * @param {string} raw       the SKILL.md bytes, before any transformation
 * @param {string} repoPath  repo-relative path, for the message
 * @returns {import("./enumerate.mjs").Advisory[]} zero or one
 */
export function adviseLength(raw, repoPath) {
  const lines = countLines(raw);
  if (lines <= SKILL_MD_LINE_GUIDANCE) return [];
  return [
    {
      code: "D2",
      file: repoPath,
      // The first line past the guidance — an openable place, and the one
      // the author would scroll to. Not the last line, which would name
      // where the file ends rather than where it crossed.
      line: SKILL_MD_LINE_GUIDANCE + 1,
      message:
        `this SKILL.md is ${lines} lines; the Agent Skills spec's ` +
        `progressive-disclosure guidance is to keep it under ` +
        `${SKILL_MD_LINE_GUIDANCE} and move detail into references/. ` +
        `Guidance, not a rule: the site renders every line as written and ` +
        `changes nothing.`,
    },
  ];
}

/**
 * Does `rest` name something that exists inside the group directory?
 *
 * `list` is the group's inventory: `null` when the directory itself is
 * absent, otherwise every entry the enumerator found. `assets/` is
 * inventoried at every depth and its entries carry slashes; `references/` and
 * `scripts/` are inventoried at their top level and carry a `kind`. Both
 * shapes are handled, so this predicate does not silently depend on which
 * lister produced the list.
 *
 * @param {import("./enumerate.mjs").ResourceEntry[]|null} list
 * @param {string} rest  path below the group root, no trailing slash; "" means
 *   the pointer names the group directory itself
 */
function existsInGroup(list, rest) {
  if (list === null) return false;
  if (rest === "") return true;
  return list.some(
    (r) =>
      r.name === rest ||
      // a directory, named either as its own entry or by the files under it
      r.name.startsWith(`${rest}/`),
  );
}

/**
 * D4 — a bare code span pointing at a resource that is not there.
 *
 * Proposal §3.4 names `macos-hig-reviewer/SKILL.md:42,48` as the instance:
 * the text says the SwiftLint config is "in the `references/` directory" and
 * names `references/swiftlint.yml`, but that skill has no `references/` at
 * all — the file is at `assets/swiftlint.yml`. §3.4's ruling is explicit and
 * this function implements exactly it: "It is a bare code span, not a link,
 * so there is nothing to rewrite — render it verbatim, synthesize no link,
 * emit an advisory".
 *
 * WHY THIS ONLY EVER SEES BARE SPANS. A code span used as a markdown link
 * LABEL cannot reach this advisory: links.mjs resolves the link's target
 * first and throws a build error on a target it cannot resolve, so a dead
 * pointer written as a link fails the build rather than arriving here. That
 * is a property of the pipeline, not a filter applied below; there is no
 * dead-link case for this function to be careful about.
 *
 * Fenced blocks are excluded — see `inlineCodeSpans`.
 *
 * @param {string} raw   the SKILL.md bytes, before any transformation, so the
 *   reported line is a true source line with no offset arithmetic
 * @param {{repoPath: string, repoDir: string, resources: Record<string, import("./enumerate.mjs").ResourceEntry[]|null>}} skill
 * @returns {import("./enumerate.mjs").Advisory[]}
 */
export function adviseDeadPointers(raw, skill) {
  const out = [];
  const groups = RESOURCE_GROUPS.join("|");
  const shape = new RegExp(`^(${groups})/(.*)$`);

  for (const span of inlineCodeSpans(raw)) {
    const m = shape.exec(span.text);
    if (!m) continue;
    const [, group, tail] = m;
    // An anchor or a query on a bare prose pointer is not a thing anyone
    // writes, but stripping them costs nothing and a false D4 costs the
    // reader's trust.
    const rest = tail.replace(/[#?].*$/, "").replace(/\/$/, "");
    if (existsInGroup(skill.resources[group], rest)) continue;

    const named = rest === "" ? `${group}/` : `${group}/${rest}`;
    const where =
      skill.resources[group] === null
        ? `${skill.repoDir}/ has no ${group}/ directory`
        : `${skill.repoDir}/${group}/ holds nothing at "${rest}"`;
    out.push({
      code: "D4",
      file: skill.repoPath,
      line: span.line,
      message:
        `this text points at "${named}", but ${where}. It is a bare code ` +
        `span and not a link, so the site renders it verbatim and ` +
        `synthesizes no link to a file that does not exist.`,
    });
  }
  return out;
}

/**
 * I4 — a resource file its own SKILL.md never mentions.
 *
 * THE EMITTED NOUN IS "undescribed", NOT "orphan", AND THE INTERNAL NAMES ARE
 * LEFT ALONE. An orphan is a thing with no parent, and that word invites
 * deleting the file. This condition does not establish that: the review found
 * assets/example-bundle/references/skills/run-on-bq.md flagged here while
 * index.md links it with a title and a purpose, so a reader who acted on the
 * old noun would have deleted a file with a live inbound reference. The
 * remedy the message should provoke is to DESCRIBE the file, which is correct
 * for all nine — including run-on-bq.md, whose own SKILL.md genuinely does
 * not. `adviseOrphans` and the I4 code keep their names because renaming them
 * widens the diff without reaching a reader.
 *
 * THE PREDICATE, AND WHY IT IS THIS ONE. Proposal §3.7 states the population
 * in its own words: "Orphan resources. Four files their `SKILL.md` never
 * mentions". Applied literally to every resource file this repo ships, that
 * condition selects NINE files, not four; the proposal's four are all of them
 * references, and reaching exactly four requires adding a clause — "and only
 * count references/" — that §3.7 does not state and its own heading
 * contradicts. Restricting the condition to reproduce the stated number would
 * be tuning the code against the figure. So the condition below is the one
 * §3.7 states, the derived population is nine, and the divergence in both
 * count AND membership is reported in reports/phase4-siteA.md.
 *
 * "Mentions" is a plain substring test over the whole file, frontmatter and
 * fences included, against the file's path within its group and against its
 * bare name. Deliberately GENEROUS: this advisory is an accusation that the
 * author documented nothing, and the cheap error to make is to stay quiet.
 *
 * WHAT THIS PREDICATE DOES NOT ESTABLISH, AND THE MESSAGE NO LONGER CLAIMS.
 * It reads ONE file — the owning SKILL.md. It therefore establishes nothing
 * about the repository as a whole, and until the Phase 4 review it printed a
 * message that read as if it did. Measured counter-example, from that review:
 * assets/example-bundle/references/skills/run-on-bq.md is flagged here and is
 * described in TWO other repository files — example-bundle/index.md links it
 * with the text "executor run instructions", and computations/revenue.md
 * names it as `resource:`. The finding is real; the old wording was not.
 *
 * THE TWO-VARIANT DEFENCE THAT USED TO SIT HERE WAS ONE LOSS PROFILE, NOT
 * TWO, and it is withdrawn rather than restated. A token-boundary variant
 * that refuses matches glued to an identifier character does select the same
 * nine files with symmetric difference zero — but BOTH variants match on
 * BASENAME, so they share a blind spot and their agreement follows from that
 * shared construction rather than from evidence. Two renderings of one
 * predicate are not two predicates. The
 * review measured genuinely different profiles: a fence-and-link-aware
 * structural variant gives 7 and a path-anchored variant gives 17.
 *
 * THE CONSEQUENCE OF THE BASENAME PROFILE, WHICH A READER OF THIS POPULATION
 * MUST KNOW. Of the 9 bundle files, exactly the 2 whose basenames do not
 * collide with unrelated prose elsewhere in okf-author/SKILL.md are flagged.
 * The other bundle basenames — index.md, log.md, revenue.md, customers.md,
 * orders.md — occur in that SKILL.md 9, 3, 1, 2 and 2 times respectively.
 * THOSE ARE OCCURRENCES, NOT LINES, and the distinction is not pedantic: the
 * first figure read 8 until the review, because it had been measured
 * line-oriented and SKILL.md line 77 carries `index.md` twice ("Root
 * `index.md` is the only `index.md` permitted to carry frontmatter"). The
 * other four agree under both units only because none of them happens to
 * double up on a line, which makes them correct rather than checked. Every
 * one of these occurrences is about the OKF FORMAT rather than about a bundle
 * file (e.g. "Reserved filenames (`index.md`, `log.md`) are not concepts"). So the partition of the bundle into orphan and not-orphan here
 * is produced by ACCIDENTAL BASENAME COLLISION, not by documentation. That is
 * a property of this predicate, it is disclosed rather than tuned away, and
 * it is the reason the message above is scoped to this one file.
 *
 * No line number. The finding is an ABSENCE — there is no line in SKILL.md
 * where the mention fails to be — and `line: null` is how this loader says
 * so. Inventing one to satisfy a "file and line" phrasing would be inventing
 * data, which is the one thing this loader must never do. `file` is the
 * orphan itself, because that is the artifact a reader would open.
 *
 * @param {string} raw
 * @param {{repoPath: string, repoDir: string, resources: Record<string, import("./enumerate.mjs").ResourceEntry[]|null>}} skill
 * @returns {import("./enumerate.mjs").Advisory[]}
 */
export function adviseOrphans(raw, skill) {
  const out = [];
  for (const group of RESOURCE_GROUPS) {
    for (const entry of skill.resources[group] ?? []) {
      if (entry.kind !== "file") continue;
      const bare = entry.name.slice(entry.name.lastIndexOf("/") + 1);
      if (raw.includes(entry.name) || raw.includes(bare)) continue;
      out.push({
        code: "I4",
        file: `${skill.repoDir}/${group}/${entry.name}`,
        line: null,
        message:
          `undescribed resource: ${skill.repoPath} never mentions this file ` +
          `by name, so this page carries no description for it. It is ` +
          `listed on the skill page by its real filename. THIS CHECKS THE ` +
          `OWNING SKILL.md ONLY — another file in the repository may ` +
          `describe it.`,
      });
    }
  }
  return out;
}
