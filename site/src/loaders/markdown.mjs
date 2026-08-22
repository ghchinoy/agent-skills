// markdown.mjs — the body transformation, and it is a CLOSED list of exactly
// two operations (proposal §6.5):
//
//   1. a CONDITIONAL, FENCE-AWARE leading-H1 strip, and
//   2. link rewriting.
//
// There is no third. No heading demotion, no prettifier, no smart quotes, no
// reflow. Every additional transformation is another chance to change what the
// author wrote, and the point of this site is that it does not.
//
// Two source-data facts drive the design:
//
//   I7 — `okf-author/SKILL.md` has `# Concepts` (line 71) and `# Schema`
//        (line 97) INSIDE fenced code blocks. A heading scan that is not
//        fence-aware mangles them.
//   D4 — link-shaped text inside a code SPAN is prose, not a link. The
//        `okf-v0.2-spec-summary.md` reference contains
//        `` `[customers](/tables/customers.md)` `` as a code span documenting
//        OKF's link syntax; rewriting it would corrupt an example.
//
// Both are handled by ONE mechanism: `protectedRanges()` marks every byte that
// markdown will render as code (fenced blocks AND inline code spans), and the
// link rewriter skips any match whose TARGET starts inside a protected range.
// Matching on the target — not on the whole match — is what lets
// `` [`../../references/x.md`](../../references/x.md) `` still be rewritten:
// its label is a code span, its target is not.

// ── Fence scanning, in ONE place ───────────────────────────────────────────
//
// There were two copies of this logic in this file, and they disagreed. The
// copy in `protectedRanges()` sliced with `open[1].length` — the length of the
// BACKTICK RUN — where it needed `open[0].length`, the length of the whole
// match INCLUDING the up-to-three spaces of indent CommonMark allows. So for
// an indented closing fence the slice started three characters early, `after`
// came back as the tail of the fence itself rather than "", and the fence
// never closed. Everything to end of file stayed "inside code" and was exempt
// from link rewriting.
//
// That was live in both shipped SKILL.md files (okf-author:197,
// okf-validate:160 — both fences sit inside a list item, so both are
// indented), and it made the §6.5 hard-error gate UNREACHABLE below those
// lines: a site-absolute link appended at EOF built clean and reached dist,
// while the same link higher up correctly failed the build.
//
// The one-character bug is fixed. The reason it is now one function is that
// two scanners meant two chances to get this wrong, and the second copy
// (`firstH1`) was in fact also wrong, differently: it closed a fence on any
// sufficiently long run of the same character, ignoring info strings, so a
// line like "```js" INSIDE a block would close it. CommonMark forbids an info
// string on a closing fence. One implementation, one behaviour, one place to
// fix next time.

/** A fence opener/closer match on a line, or `null`. */
function fenceMatch(line) {
  return /^ {0,3}(`{3,}|~{3,})/.exec(line);
}

/** True when `line` closes an open `fence` ({char, len}). */
function closesFence(line, fence) {
  const m = fenceMatch(line);
  if (!m) return false;
  if (m[1][0] !== fence.char || m[1].length < fence.len) return false;
  // A closing fence carries NO info string. Slice past the WHOLE match —
  // indent included — or an indented fence never closes.
  return line.slice(m[0].length).trim() === "";
}

/** The fence a line opens, or `null`. */
function opensFence(line) {
  const m = fenceMatch(line);
  return m ? { char: m[1][0], len: m[1].length } : null;
}

/**
 * Byte ranges that markdown will render as code: fenced code blocks (including
 * their fence lines) and inline code spans.
 *
 * @param {string} text
 * @returns {[number, number][]} sorted, non-overlapping-enough `[start, end)`
 */
export function protectedRanges(text) {
  const ranges = [];
  const lines = text.split("\n");
  let offset = 0;
  let fence = null; // { char: "`" | "~", len: number }

  for (const line of lines) {
    const start = offset;
    const end = offset + line.length;
    offset = end + 1; // for the "\n" removed by split

    if (fence) {
      ranges.push([start, end]);
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const open = opensFence(line);
    if (open) {
      fence = open;
      ranges.push([start, end]);
      continue;
    }
    for (const [s, e] of codeSpansIn(line)) ranges.push([start + s, start + e]);
  }
  return ranges;
}

/**
 * Inline code spans within ONE line, as `[start, end)` offsets into that line.
 * CommonMark: a run of N backticks opens a span that the next run of EXACTLY N
 * backticks closes. An unterminated run is literal text and protects nothing.
 */
function codeSpansIn(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      i += 1;
      continue;
    }
    let n = 0;
    while (line[i + n] === "`") n += 1;
    let j = i + n;
    let closed = false;
    while (j < line.length) {
      if (line[j] !== "`") {
        j += 1;
        continue;
      }
      let m = 0;
      while (line[j + m] === "`") m += 1;
      if (m === n) {
        out.push([i, j + m]);
        i = j + m;
        closed = true;
        break;
      }
      j += m;
    }
    if (!closed) i += n;
  }
  return out;
}

/**
 * Every inline code span OUTSIDE a fenced block, with the 1-based SOURCE line
 * it sits on and its content minus the delimiting backticks.
 *
 * `protectedRanges()` deliberately conflates the two kinds of code — it exists
 * to answer "may the rewriter touch this byte", and for that question a fence
 * and a span are the same answer. D4 asks a different question: which SPANS
 * did the author write as prose pointers at their own resources. A fenced
 * block is a transcript of something else (a shell session, a YAML sample)
 * and its contents are not this skill's claims about its own directory, so
 * fenced content is excluded rather than merely unrewritten.
 *
 * Reuses the same fence tracker as `protectedRanges()` for the reason the
 * header gives: two scanners meant two chances to get fences wrong, and both
 * copies were in fact wrong.
 *
 * @param {string} text
 * @returns {{text: string, line: number}[]} in source order
 */
export function inlineCodeSpans(text) {
  const out = [];
  const lines = text.split("\n");
  let fence = null;

  lines.forEach((line, i) => {
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      return;
    }
    const open = opensFence(line);
    if (open) {
      fence = open;
      return;
    }
    for (const [s, e] of codeSpansIn(line)) {
      // Strip the delimiters. The run length is symmetric by construction in
      // `codeSpansIn` — it closes on a run of EXACTLY the opening length.
      let n = 0;
      while (line[s + n] === "`") n += 1;
      let content = line.slice(s + n, e - n);
      // CommonMark: if the content both begins and ends with a space and is
      // not all spaces, one space is stripped from each end. That rule is what
      // lets an author write `` ` `code` ` `` at all, and it is a markdown
      // fact rather than a caller's preference, so it is applied here. Without
      // it a padded span would not match a caller's pattern and would be
      // skipped in silence.
      if (/^ .* $/.test(content) && content.trim() !== "") {
        content = content.slice(1, -1);
      }
      out.push({ text: content, line: i + 1 });
    }
  });
  return out;
}

/** True when `pos` falls inside any protected range. */
export function isProtected(ranges, pos) {
  for (const [s, e] of ranges) {
    if (pos >= s && pos < e) return true;
  }
  return false;
}

/** Offsets at which each 1-based line begins. */
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** 1-based line number of a byte offset. */
function lineOf(starts, pos) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * The CONDITIONAL leading-H1 strip. Starlight renders the frontmatter `title`
 * as the page H1, so a body that opens with its own H1 would render it twice.
 *
 * Conditional because it is not universal: `grill-with-beads/SKILL.md` (I2)
 * opens with no H1 at all, and a body whose first content is a fenced block
 * that happens to start with `#` must keep it (I7).
 *
 * Only the FIRST non-blank line is ever considered, and only when it is a
 * genuine ATX H1 outside a fence. Nothing further down the document is touched
 * — which is precisely why `# Concepts` at line 71 survives.
 *
 * `removed` is how many leading lines went, so the caller can keep reporting
 * SOURCE-FILE line numbers in advisories and build errors. A line number that
 * silently means "line of the post-transformation buffer" is worse than none:
 * it sends the reader to the wrong line of the right file.
 *
 * @param {string} body
 * @returns {{ body: string, stripped: string|null, line: number|null, removed: number }}
 */
export function stripLeadingH1(body) {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i += 1;
  if (i >= lines.length) return { body, stripped: null, line: null, removed: 0 };

  // A fence opener at the top means the document opens with code, not a
  // heading. Nothing is stripped.
  if (opensFence(lines[i])) {
    return { body, stripped: null, line: null, removed: 0 };
  }
  if (!/^# +\S/.test(lines[i])) return { body, stripped: null, line: null, removed: 0 };

  const stripped = lines[i].replace(/^# +/, "").trim();
  const line = i + 1;
  let j = i + 1;
  while (j < lines.length && lines[j].trim() === "") j += 1;
  return { body: lines.slice(j).join("\n"), stripped, line, removed: j };
}

/**
 * The H1 of a reference file, which is the ONLY source its page title may come
 * from (§3.6). Fence-aware, and `null` when there is none — the caller turns
 * that into a hard build error rather than prettifying the filename into a
 * title nobody wrote.
 */
export function firstH1(text) {
  const lines = text.split("\n");
  let fence = null;
  for (const line of lines) {
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const open = opensFence(line);
    if (open) {
      fence = open;
      continue;
    }
    const m = /^# +(\S.*)$/.exec(line);
    if (m) return m[1].trimEnd();
  }
  return null;
}

// binder's `rewriteLinks()` regex, lifted unchanged (proposal §6.5 says to):
// it matches inline links and images, including angle-bracket targets and
// optional titles.
const LINK_RE = /(!?\[[^\]]*\])\(\s*(<[^>]+>|[^)\s]+)((?:\s+"[^"]*")?)\s*\)/g;

/**
 * Rewrites every markdown link and image target in `body` using `resolve`.
 *
 * `resolve(target, ctx)` receives `{ line, isImage, raw }` and MUST return a
 * string or throw. It is never given a target inside code — those are skipped
 * before it is called.
 *
 * `lineOffset` is added to every line number handed to `resolve`, so what an
 * advisory or a build error prints is the line in the SOURCE FILE — past the
 * frontmatter and past whatever the H1 strip removed — not a line in an
 * intermediate buffer the reader cannot open.
 *
 * @param {string} body
 * @param {(target: string, ctx: {line:number,isImage:boolean,raw:string}) => string} resolve
 * @param {{lineOffset?: number}} [opts]
 * @returns {{ body: string, rewrites: {line:number,from:string,to:string}[] }}
 */
export function rewriteLinks(body, resolve, opts = {}) {
  const lineOffset = opts.lineOffset ?? 0;
  const ranges = protectedRanges(body);
  const starts = lineStarts(body);
  const rewrites = [];

  const out = body.replace(LINK_RE, (whole, label, target, title, index) => {
    // Offset of the target itself, past "[label](" and any leading whitespace.
    const afterParen = index + label.length + 1;
    const rest = whole.slice(label.length + 1);
    const lead = rest.length - rest.trimStart().length;
    const targetStart = afterParen + lead;

    // Inside a fence or a code span: this is code, not a link. Untouched.
    if (isProtected(ranges, targetStart)) return whole;

    const bare = target.replace(/^</, "").replace(/>$/, "");
    const line = lineOf(starts, index) + lineOffset;
    const rewritten = resolve(bare, {
      line,
      isImage: label.startsWith("!"),
      raw: whole,
    });
    if (rewritten !== bare) rewrites.push({ line, from: bare, to: rewritten });
    return `${label}(${rewritten}${title})`;
  });

  return { body: out, rewrites };
}
