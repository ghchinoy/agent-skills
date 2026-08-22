// workflows.test.mjs — PHASE 2's two new workflow files, as a gate.
//
// Phase 1 shipped no workflows and pins.test.mjs asserted their ABSENCE. Phase 2
// ships both, so that assertion is replaced by this file: the properties the
// workflows have to hold are now checked on every run rather than eyeballed
// once in a pull request.
//
// The load-bearing property is the deploy lesson. A sibling project deploys its
// docs on `push: tags: ['v*']` and its `github-pages` environment protection
// rejects `v*` tag refs, so the deploy fires at release time and dies at the
// environment gate. That is an observed failure, not a hypothesis.
//
// TWO tests hold it, and an earlier version of this comment credited the wrong
// one. The trigger test below checks that `push:` is `main`-only and that no
// `tags:` filter exists. THE TRIGGER LIST IS NOT WHAT CLOSES THE HOLE:
// `workflow_dispatch` carries no ref restriction, and `gh workflow run --ref
// v1.0.0` lands `refs/tags/...` at the environment gate through a trigger that
// looks harmless. What actually closes it is the job-level
// `if: github.ref == 'refs/heads/main'`, asserted by "docs.yml cannot deploy
// from a tag ref — including via workflow_dispatch" further down. Saying the
// trigger is "the only thing standing between this repo and repeating it" is
// the R3 over-claim, corrected in three places last round and still surviving
// here; it is fix-round-2 finding F5.
//
// A comment saying "do not use a tag trigger" is not a gate. These two are.
//
// Every detector here carries a control, because a detector nobody has proven
// can fire is not a gate — the pattern the Phase 1 suite is built on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

import { repoRoot, siteRoot } from "./_helpers.mjs";

const WORKFLOWS = join(repoRoot, ".github", "workflows");
const DOCS = join(WORKFLOWS, "docs.yml");
const SITE_CI = join(WORKFLOWS, "site-ci.yml");
const VALIDATE = join(WORKFLOWS, "validate.yml");

/**
 * EVERY workflow file in the directory, read from the directory.
 *
 * R1's class, found in this file by re-grepping after fixing it in pins.test.mjs:
 * `every action is pinned to an explicit ref` iterated a hand-written list of two
 * while the directory holds three. validate.yml belongs to the repo rather than to
 * Phase 2 and is zero-diff by ruling — but that is a reason not to CHANGE it, and
 * it was being used as a reason not to CHECK it. Measured before extending the
 * scan: its two actions are already pinned, so covering it costs no diff at all.
 * The gap was never a conflict with the ruling; nobody had looked.
 */
async function allWorkflows() {
  const names = (await readdir(WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f)).sort();
  return Promise.all(names.map(async (name) => ({ name, wf: await load(join(WORKFLOWS, name)) })));
}

/**
 * Workflows a given test does not apply to, keyed by test, each with a reason and
 * a PREDICATE that decides applicability from the file's content rather than from
 * its name. A named skip goes stale silently; a predicate cannot, because the
 * tests below assert the predicate's verdict matches this list exactly.
 */
const APPLICABILITY = {
  "node floor": {
    applies: (wf) =>
      Object.values(wf.jobs ?? {}).some((j) =>
        (j.steps ?? []).some((s) => String(s.uses ?? "").startsWith("actions/setup-node@")),
      ),
    reason: "validate.yml sets up Python and never installs Node, so a Node floor says nothing about it",
  },
  "npm ci": {
    applies: (wf) =>
      Object.values(wf.jobs ?? {}).some((j) =>
        (j.steps ?? []).some((s) => /\bnpm\b/.test(String(s.run ?? ""))),
      ),
    reason: "validate.yml runs a shell validator and no npm commands, so there is no install to make reproducible",
  },
  "content paths": {
    applies: (wf) => {
      const on = triggers(wf);
      return Boolean(on.push?.paths ?? on.pull_request?.paths);
    },
    reason:
      "validate.yml deliberately carries no paths filter — it runs on every push to main, " +
      "which is a stronger trigger than the one this test checks for, not a weaker one",
  },
};

/** The content globs both workflows must watch, independent of either file. */
const CONTENT_PATHS = [
  "plugins/**",
  ".claude-plugin/**",
  "README.md",
  "CONTRIBUTING.md",
  "site/**",
];

const exists = async (p) => {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const raw = (p) => readFile(p, "utf8");
const load = async (p) => parse(await raw(p));

/** `on:` is a string key here, not YAML 1.1's boolean `true` — the `yaml`
 *  package parses to the 1.2 core schema. Read through a helper anyway so a
 *  parser change cannot silently turn every trigger assertion vacuous. */
function triggers(wf) {
  const on = wf.on ?? wf[true];
  assert.ok(on && typeof on === "object", "the workflow declares no `on:` triggers");
  return on;
}

/**
 * Every way this workflow could be started BY A TAG. Returns the offending
 * paths, so a failure names the mechanism rather than just saying "no".
 *
 * `release` and `create` are included because both fire on tag creation without
 * the word "tags" appearing anywhere — banning only `push.tags` would be a gate
 * aimed at one instance of the class.
 */
export function tagTriggers(wf) {
  const on = wf.on ?? wf[true];
  const found = [];
  const names = Array.isArray(on) ? on : typeof on === "string" ? [on] : Object.keys(on ?? {});
  for (const name of names) {
    const cfg = Array.isArray(on) || typeof on === "string" ? undefined : on[name];
    if (name === "release" || name === "create") found.push(name);
    if (cfg && typeof cfg === "object") {
      if (cfg.tags) found.push(`${name}.tags`);
      if (cfg["tags-ignore"]) found.push(`${name}.tags-ignore`);
    }
  }
  return found;
}

/**
 * Every place a failure could be SWALLOWED: `continue-on-error` at job level or
 * at step level. Returns the offending paths so a failure names the spot.
 *
 * Review found that adding `continue-on-error: true` to the live-check job left
 * the whole suite green — the AC3 gate could be neutered and nothing noticed,
 * which is the "gate that cannot fire" shape one level up. Anything truthy
 * counts, including an `${{ }}` expression, because a condition nobody has
 * evaluated is not a promise that the step is hard-failing.
 */
export function softFailures(wf) {
  const out = [];
  for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
    if (job["continue-on-error"]) out.push(jobName);
    for (const [i, step] of (job.steps ?? []).entries()) {
      if (step["continue-on-error"]) {
        out.push(`${jobName}.steps[${i}] (${step.name ?? step.uses ?? step.run ?? "?"})`);
      }
    }
  }
  return out;
}

/** Job name -> its `if:`, for the jobs that have one. `if: false` is a job that
 *  never runs, so the VALUE matters and not merely the key's presence. */
export function jobConditions(wf) {
  const out = {};
  for (const [name, job] of Object.entries(wf.jobs ?? {})) {
    if (job.if !== undefined) out[name] = job.if;
  }
  return out;
}

/**
 * Does this condition confine the job to BRANCH refs?
 *
 * The trigger list is not enough on its own: `workflow_dispatch` has no ref
 * restriction, and `gh workflow run --ref v1.2.3` lands `refs/tags/v1.2.3` at
 * the environment gate — reproducing §10.1's failure through the one trigger
 * that looks harmless. Only a job-level `if:` closes that.
 *
 * Accepts equality against a specific branch ref, or the `refs/heads/` prefix
 * test. Deliberately REJECTS `startsWith(github.ref, 'refs/')`, which admits
 * every tag while looking like a guard.
 */
export function guardsAgainstTagRefs(cond) {
  const c = String(cond ?? "").replace(/\s+/g, "");
  if (/github\.ref==['"]refs\/heads\/[^'"]+['"]/.test(c)) return true;
  if (/startsWith\(github\.ref,['"]refs\/heads\/['"]\)/.test(c)) return true;
  return false;
}

/** First step whose `uses:` starts with `prefix`. */
function stepWith(wf, prefix) {
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (String(step.uses ?? "").startsWith(prefix)) return step;
    }
  }
  return undefined;
}

/** Every `uses:` in a workflow, as written. */
export function usesIn(wf) {
  const out = [];
  for (const job of Object.values(wf.jobs ?? {})) {
    for (const step of job.steps ?? []) if (step.uses) out.push(step.uses);
  }
  return out;
}

/** Every `run:` in a workflow, as written. */
function runsIn(wf) {
  const out = [];
  for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
    for (const step of job.steps ?? []) if (step.run) out.push({ job: jobName, ...step });
  }
  return out;
}

/**
 * Anything that would make a workflow publish to Pages. Used to assert the PR
 * workflow does not.
 */
export function deploymentSurface(wf) {
  const found = [];
  for (const u of usesIn(wf)) {
    if (/actions\/(deploy-pages|upload-pages-artifact|configure-pages)@/.test(u)) found.push(u);
  }
  const perms = { ...(wf.permissions ?? {}) };
  for (const job of Object.values(wf.jobs ?? {})) Object.assign(perms, job.permissions ?? {});
  if (perms.pages && perms.pages !== "none") found.push(`permissions.pages: ${perms.pages}`);
  if (perms["id-token"] && perms["id-token"] !== "none") {
    found.push(`permissions.id-token: ${perms["id-token"]}`);
  }
  for (const job of Object.values(wf.jobs ?? {})) {
    const env = typeof job.environment === "string" ? job.environment : job.environment?.name;
    if (env === "github-pages") found.push("environment: github-pages");
  }
  return found;
}

// ── the files exist, and the repo's own workflow is untouched ───────────────

test("Phase 2 ships docs.yml and site-ci.yml, and validate.yml is still present", async () => {
  // The inverse of Phase 1's assertion, which required both to be ABSENT. If a
  // later phase deletes one, this says so instead of quietly losing the gate.
  assert.ok(await exists(DOCS), ".github/workflows/docs.yml is missing");
  assert.ok(await exists(SITE_CI), ".github/workflows/site-ci.yml is missing");
  // AC6: the repository's pre-existing workflow must still be there. This
  // suite does not own its contents and deliberately does not pin them — it is
  // not the site's file — but its disappearance is the site's problem.
  assert.ok(await exists(VALIDATE), "the repository's existing validate.yml has gone missing");
});

// ── the deploy lesson ───────────────────────────────────────────────────────

// NOT titled "cannot be triggered by a tag" — that was the second surviving R3
// over-claim (F5). This test proves the TRIGGER LIST carries no tag entry. It
// says nothing about `workflow_dispatch`, which can be aimed at a tag; the ref
// guard is what stops that, and it has its own test.
test("docs.yml's push trigger is main-only and declares no tag filter", async () => {
  const wf = await load(DOCS);
  const on = triggers(wf);
  assert.deepEqual(on.push?.branches, ["main"], "docs.yml does not deploy on push to main");
  assert.deepEqual(
    tagTriggers(wf),
    [],
    "docs.yml declares a tag trigger — the github-pages environment rejects tag refs, and the job-level ref guard is the only other thing that would stop it",
  );
  // …and the branch filter is not merely present but exclusive: no second
  // branch, and no branches-ignore that would let arbitrary refs through.
  assert.equal(on.push.branches.length, 1);
  assert.equal(on.push["branches-ignore"], undefined);
});

test("tag-trigger control: the detector fires on every tag-shaped trigger", () => {
  // POSITIVE — each of these is a real way to start a workflow from a tag.
  assert.deepEqual(tagTriggers({ on: { push: { tags: ["v*"] } } }), ["push.tags"]);
  assert.deepEqual(tagTriggers({ on: { release: { types: ["published"] } } }), ["release"]);
  assert.deepEqual(tagTriggers({ on: { create: null } }), ["create"]);
  assert.deepEqual(
    tagTriggers({ on: { push: { branches: ["main"], "tags-ignore": ["v*"] } } }),
    ["push.tags-ignore"],
  );
  // NEGATIVE (near miss) — the shape docs.yml actually uses, and a couple of
  // triggers that merely mention branches, must stay silent. Without this the
  // test above would pass on a detector that condemned everything.
  assert.deepEqual(tagTriggers({ on: { push: { branches: ["main"] }, workflow_dispatch: {} } }), []);
  assert.deepEqual(tagTriggers({ on: { pull_request: { paths: ["site/**"] } } }), []);
  assert.deepEqual(tagTriggers({ on: ["push"] }), []);
});

// ── paths: the gate §9.1 is built around ────────────────────────────────────

test("every workflow with a paths filter watches plugins/** — a content change builds the site", async () => {
  // This is the whole argument for the site living in this repo. If plugins/**
  // ever drops out of either filter, a malformed SKILL.md merges green and the
  // site breaks afterwards, detached from its cause.
  const { applies, reason } = APPLICABILITY["content paths"];
  const all = await allWorkflows();
  assert.ok(all.length >= 3, `expected at least 3 workflow files, enumerated ${all.length}`);
  const subject = all.filter((w) => applies(w.wf));
  const skipped = all.filter((w) => !applies(w.wf)).map((w) => w.name);
  assert.ok(reason.length > 40, "the skip has no stated reason");
  assert.ok(subject.length >= 2, `only ${subject.length} workflow(s) are in scope: ${skipped.join(", ")}`);
  for (const { name, wf } of subject) {
    const on = triggers(wf);
    const paths = on.push?.paths ?? on.pull_request?.paths;
    assert.ok(Array.isArray(paths), `${name} declares no paths filter`);
    for (const p of CONTENT_PATHS) {
      assert.ok(paths.includes(p), `${name} does not watch ${p}`);
    }
  }
});

test("each workflow watches itself, and site-ci also watches docs.yml", async () => {
  // A workflow that does not watch its own file cannot be tested by changing
  // it. site-ci additionally watches docs.yml so an edit to the deploy workflow
  // is at least built and tested on the pull request; docs.yml does not watch
  // site-ci.yml, because site-ci has no effect on what gets deployed.
  const docs = triggers(await load(DOCS));
  const ci = triggers(await load(SITE_CI));
  assert.ok(docs.push.paths.includes(".github/workflows/docs.yml"));
  assert.ok(!docs.push.paths.includes(".github/workflows/site-ci.yml"));
  assert.ok(ci.pull_request.paths.includes(".github/workflows/site-ci.yml"));
  assert.ok(ci.pull_request.paths.includes(".github/workflows/docs.yml"));
});

test("the two filters agree on the content globs, exactly", async () => {
  // "Same paths filter" (proposal §10.2), asserted as set equality over the
  // non-workflow globs rather than as two lists that happen to look alike.
  const docs = triggers(await load(DOCS)).push.paths;
  const ci = triggers(await load(SITE_CI)).pull_request.paths;
  const content = (ps) => ps.filter((p) => !p.startsWith(".github/")).sort();
  assert.deepEqual(content(docs), content(ci));
  assert.deepEqual(content(docs), [...CONTENT_PATHS].sort());
});

// ── site-ci does not deploy ─────────────────────────────────────────────────

test("site-ci.yml builds and tests, and has no way to deploy", async () => {
  const wf = await load(SITE_CI);
  const on = triggers(wf);
  assert.ok(on.pull_request, "site-ci.yml does not run on pull_request");
  assert.equal(on.push, undefined, "site-ci.yml also runs on push — that is docs.yml's job");
  assert.deepEqual(
    deploymentSurface(wf),
    [],
    "site-ci.yml has a route to publishing; it runs on unreviewed pull requests",
  );
  assert.equal(wf.permissions?.contents, "read");

  const runs = runsIn(wf).map((s) => s.run.trim());
  assert.ok(runs.some((r) => r === "npm ci"), "site-ci.yml does not run `npm ci`");
  assert.ok(runs.some((r) => r === "npm run build"), "site-ci.yml does not build");
  assert.ok(runs.some((r) => r === "npm test"), "site-ci.yml does not run the suite");
  // Order matters: most of the suite asserts on dist/, so a test run that came
  // first would be asserting on whatever the last build left behind — or on
  // nothing at all in CI.
  assert.ok(
    runs.indexOf("npm run build") < runs.indexOf("npm test"),
    "`npm test` runs before `npm run build`; the suite reads dist/",
  );
});

test("deploy-surface control: the detector fires on each publishing route", () => {
  // POSITIVE — every shape that would let a PR workflow publish.
  assert.deepEqual(
    deploymentSurface({ jobs: { a: { steps: [{ uses: "actions/deploy-pages@v4" }] } } }),
    ["actions/deploy-pages@v4"],
  );
  assert.deepEqual(
    deploymentSurface({ jobs: { a: { steps: [{ uses: "actions/upload-pages-artifact@v3" }] } } }),
    ["actions/upload-pages-artifact@v3"],
  );
  assert.deepEqual(deploymentSurface({ permissions: { pages: "write" } }), ["permissions.pages: write"]);
  assert.deepEqual(
    deploymentSurface({ jobs: { a: { environment: "github-pages" } } }),
    ["environment: github-pages"],
  );
  assert.deepEqual(
    deploymentSurface({ jobs: { a: { environment: { name: "github-pages" } } } }),
    ["environment: github-pages"],
  );
  // …and a job-level permission block, which a workflow-level-only check misses.
  assert.deepEqual(
    deploymentSurface({ jobs: { a: { permissions: { "id-token": "write" }, steps: [] } } }),
    ["permissions.id-token: write"],
  );
  // NEGATIVE (near miss) — an ordinary build job, and an artifact upload that
  // is NOT the Pages one, must stay silent. `upload-artifact` differs from
  // `upload-pages-artifact` by one word and docs.yml uses both.
  assert.deepEqual(
    deploymentSurface({
      permissions: { contents: "read" },
      jobs: {
        a: {
          steps: [{ uses: "actions/checkout@v4" }, { uses: "actions/upload-artifact@v4" }],
        },
      },
    }),
    [],
  );
});

test("docs.yml DOES deploy — the control for the test above", async () => {
  // If `deploymentSurface` silently stopped matching, the site-ci assertion
  // would pass for the wrong reason. The workflow that is supposed to publish
  // is the fixture that proves it still matches real files.
  const wf = await load(DOCS);
  const surface = deploymentSurface(wf);
  for (const want of [
    "actions/configure-pages@v5",
    "actions/upload-pages-artifact@v3",
    "actions/deploy-pages@v4",
    "permissions.pages: write",
    "permissions.id-token: write",
    "environment: github-pages",
  ]) {
    assert.ok(surface.includes(want), `docs.yml no longer has ${want}`);
  }
  assert.equal(wf.concurrency?.group, "pages", "overlapping deploys are not serialised");
});

// ── toolchain ───────────────────────────────────────────────────────────────

test("every action is pinned to an explicit ref", async () => {
  // EVERY means every, and it did not. See allWorkflows() above.
  const all = await allWorkflows();
  assert.ok(all.length >= 3, `expected at least 3 workflow files, enumerated ${all.length}`);
  assert.ok(
    all.some((w) => w.name === "validate.yml"),
    "the enumeration no longer reaches validate.yml, which is the file the old named list missed",
  );
  let checked = 0;
  for (const { name, wf } of all) {
    for (const u of usesIn(wf)) {
      checked += 1;
      assert.match(
        u,
        /@(v\d+(?:\.\d+){0,2}|[0-9a-f]{40})$/,
        `${u} is not pinned to a version tag or a commit sha`,
      );
    }
  }
  assert.ok(checked >= 6, `only ${checked} action refs were examined across ${all.length} workflows`);
});

test("CONTROL: the workflow scan is a directory read, and every skip is earned", async () => {
  // Dimension one — the enumeration is the DIRECTORY, not a list that happens to
  // agree with it today. Compared against an independent listing, so a regression
  // to a hand-written array shows up as a set difference rather than as silence.
  const onDisk = (await readdir(WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f)).sort();
  assert.deepEqual((await allWorkflows()).map((w) => w.name), onDisk);
  assert.ok(onDisk.length >= 3, `the directory holds ${onDisk.length} workflows`);
  assert.ok(
    onDisk.includes("validate.yml"),
    "validate.yml is the file every named list in this file used to miss — if it is gone, " +
      "delete this control rather than let it pass vacuously",
  );

  // Dimension two — each applicability predicate DISCRIMINATES. A predicate that
  // returns true for everything turns "skipped for a reason" into "skipped".
  const nodeJob = { jobs: { a: { steps: [{ uses: "actions/setup-node@v4" }] } } };
  const pyJob = { jobs: { a: { steps: [{ uses: "actions/setup-python@v5" }] } } };
  const npmJob = { jobs: { a: { steps: [{ run: "npm ci" }] } } };
  const shJob = { jobs: { a: { steps: [{ run: "./scripts/validate-plugins.sh" }] } } };
  const pathed = { on: { push: { paths: ["site/**"] } }, jobs: {} };
  const unpathed = { on: { push: { branches: ["main"] } }, jobs: {} };

  assert.equal(APPLICABILITY["node floor"].applies(nodeJob), true);
  assert.equal(APPLICABILITY["node floor"].applies(pyJob), false, "the Node predicate accepts a Python job");
  assert.equal(APPLICABILITY["npm ci"].applies(npmJob), true);
  assert.equal(APPLICABILITY["npm ci"].applies(shJob), false, "the npm predicate accepts a shell-only job");
  assert.equal(APPLICABILITY["content paths"].applies(pathed), true);
  assert.equal(APPLICABILITY["content paths"].applies(unpathed), false, "the paths predicate accepts a file with no filter");

  // Dimension three — on the REAL files the verdicts are the ones claimed, and
  // the skip set is exactly validate.yml. This is the assertion that would have
  // caught the original defect: it states the denominator and the exclusions
  // together, so covering 2 of 3 cannot read as covering all of them.
  const all = await allWorkflows();
  for (const key of Object.keys(APPLICABILITY)) {
    const skipped = all.filter((w) => !APPLICABILITY[key].applies(w.wf)).map((w) => w.name);
    assert.deepEqual(skipped, ["validate.yml"], `"${key}" skips ${skipped.join(", ") || "nothing"}`);
  }
});

test("action-pin control: the detector rejects the unpinned forms", () => {
  const pinned = /@(v\d+(?:\.\d+){0,2}|[0-9a-f]{40})$/;
  for (const bad of [
    "actions/checkout",
    "actions/checkout@main",
    "actions/checkout@master",
    "actions/checkout@latest",
    "actions/checkout@releases/v1",
  ]) {
    assert.ok(!pinned.test(bad), `the pin detector accepts "${bad}"`);
  }
  for (const good of [
    "actions/checkout@v4",
    "actions/setup-node@v4.0.2",
    "actions/deploy-pages@0123456789abcdef0123456789abcdef01234567",
  ]) {
    assert.ok(pinned.test(good), `the pin detector rejects the valid pin "${good}"`);
  }
});

test("the Node the workflows install satisfies engines.node", async () => {
  // §10.4 sets the floor at 22.19.0 and both workflows say `node-version: 22`.
  // Two numbers in two files that must agree; asserted rather than assumed.
  const manifest = JSON.parse(await readFile(join(siteRoot, "package.json"), "utf8"));
  const floor = manifest.engines.node.match(/^>=\s*(\d+)\./);
  assert.ok(floor, `engines.node is "${manifest.engines.node}" — expected a >=MAJOR.x floor`);

  const { applies, reason } = APPLICABILITY["node floor"];
  const all = await allWorkflows();
  assert.ok(all.length >= 3, `expected at least 3 workflow files, enumerated ${all.length}`);
  const subject = all.filter((w) => applies(w.wf));
  const skipped = all.filter((w) => !applies(w.wf)).map((w) => w.name);
  assert.ok(reason.length > 40, "the skip has no stated reason");
  assert.ok(subject.length >= 2, `only ${subject.length} workflow(s) are in scope: ${skipped.join(", ")}`);
  for (const { name, wf } of subject) {
    const versions = [];
    for (const job of Object.values(wf.jobs)) {
      for (const step of job.steps ?? []) {
        if (String(step.uses ?? "").startsWith("actions/setup-node@")) {
          versions.push(String(step.with?.["node-version"] ?? ""));
        }
      }
    }
    assert.ok(versions.length > 0, `${name} never sets up Node`);
    for (const v of versions) {
      assert.match(v, /^\d+/, `${name} requests node-version "${v}"`);
      assert.ok(
        Number(v.split(".")[0]) >= Number(floor[1]),
        `${name} installs Node ${v}, below the declared floor ${manifest.engines.node}`,
      );
    }
  }
});

test("installs are reproducible: `npm ci` in site/, never `npm install`", async () => {
  const { applies, reason } = APPLICABILITY["npm ci"];
  const all = await allWorkflows();
  assert.ok(all.length >= 3, `expected at least 3 workflow files, enumerated ${all.length}`);
  const subject = all.filter((w) => applies(w.wf));
  const skipped = all.filter((w) => !applies(w.wf)).map((w) => w.name);
  assert.ok(reason.length > 40, "the skip has no stated reason");
  assert.ok(subject.length >= 2, `only ${subject.length} workflow(s) are in scope: ${skipped.join(", ")}`);
  for (const { name, wf } of subject) {
    const npmSteps = runsIn(wf).filter((s) => /\bnpm\b/.test(s.run));
    assert.ok(npmSteps.length > 0, `${name} runs no npm commands`);
    for (const step of npmSteps) {
      assert.ok(
        !/\bnpm\s+(i|install)\b/.test(step.run),
        `${name} runs "${step.run.trim()}" — use npm ci, which honours the lockfile`,
      );
      assert.equal(
        step["working-directory"],
        "site",
        `${name} runs "${step.run.trim()}" outside site/; site/ is self-contained, not a workspace`,
      );
    }
    for (const step of wf.jobs
      ? Object.values(wf.jobs).flatMap((j) => j.steps ?? [])
      : []) {
      if (String(step.uses ?? "").startsWith("actions/setup-node@") && step.with?.cache) {
        assert.equal(step.with["cache-dependency-path"], "site/package-lock.json");
      }
    }
  }
});

// ── AC3's gate exists and is wired to the deploy ────────────────────────────

test("docs.yml checks the live deployment after deploying, and the checker exists", async () => {
  // AC3 is the one criterion no filesystem test can establish. It is only true
  // if something fetches the published URL, so the thing that fetches it is
  // part of the deploy workflow rather than a command someone remembers to run.
  const wf = await load(DOCS);
  const verify = Object.entries(wf.jobs).find(([, j]) =>
    (j.steps ?? []).some((s) => /check-live-links\.mjs/.test(String(s.run ?? ""))),
  );
  assert.ok(verify, "docs.yml never runs the live link check");
  const [name, job] = verify;
  assert.ok(
    [].concat(job.needs ?? []).includes("build-deploy"),
    `${name} does not wait for the deploy — it would check the PREVIOUS deployment`,
  );
  assert.ok(await exists(join(siteRoot, "scripts", "check-live-links.mjs")));

  // The URL comes from the deploy step's own output, not from a literal. A
  // hard-coded URL here is how a check ends up verifying a site that is not the
  // one that was just published.
  const step = job.steps.find((s) => /check-live-links\.mjs/.test(String(s.run ?? "")));
  assert.match(
    JSON.stringify(step.env ?? {}),
    /needs\.build-deploy\.outputs\.page_url/,
    "the live check is not pointed at the URL the deploy reported",
  );
  assert.equal(wf.jobs["build-deploy"].outputs?.page_url?.includes("page_url"), true);
});

// ── Fix round 1: the findings review raised, each with its control ──────────

test("docs.yml publishes the BUILD OUTPUT, and the live check compares the same bytes", async () => {
  // R1. `path: site/dist` on the Pages upload was asserted by NOTHING: review
  // mutated it to `site` — which publishes the SOURCE tree, node_modules and
  // all, and no site at the URL — and the whole suite stayed green. The deploy
  // path is the one thing in this workflow that cannot be caught by a test of
  // the built output, because it decides what the built output even is.
  const wf = await load(DOCS);

  const pages = stepWith(wf, "actions/upload-pages-artifact@");
  assert.ok(pages, "docs.yml never uploads a Pages artifact");
  assert.equal(
    pages.with?.path,
    "site/dist",
    "the Pages artifact is not the build output — this deploys the wrong directory",
  );

  // verify-live has to compare against the bytes that were DEPLOYED, so the
  // hand-off has to actually connect. A name mismatch here makes the download
  // fail; a path mismatch makes the checker compare against an empty dir.
  const up = stepWith(wf, "actions/upload-artifact@");
  assert.ok(up, "the deployed dist is never uploaded for the live check");
  assert.equal(up.with?.path, "site/dist", "the live check is handed something other than the deploy");
  const down = stepWith(wf, "actions/download-artifact@");
  assert.ok(down, "verify-live never downloads the deployed dist");
  assert.equal(
    down.with?.name,
    up.with?.name,
    "the artifact uploaded and the artifact downloaded are different names — the hand-off is broken",
  );
  assert.equal(down.with?.path, "site/dist", "the downloaded dist does not land where the checker looks");
});

test("no job or step in docs.yml can fail quietly, and only the deploy job is conditional", async () => {
  // R2. Review neutered the AC3 gate two ways — `continue-on-error: true` on
  // verify-live, and `if: false` — and the suite passed both times. A gate that
  // can be switched off without any test noticing is decoration.
  const wf = await load(DOCS);

  assert.deepEqual(
    softFailures(wf),
    [],
    "something in the deploy workflow is allowed to fail without failing the run",
  );

  // Exactly one job may carry an `if:`, and it is the ref guard on the deploy.
  // Anything else conditional is a job that might silently not run.
  assert.deepEqual(
    Object.keys(jobConditions(wf)).sort(),
    ["build-deploy"],
    "an unexpected job in docs.yml is conditional — a job that can skip is a check that can vanish",
  );
  const verify = Object.entries(wf.jobs).find(([, j]) =>
    (j.steps ?? []).some((s) => /check-live-links\.mjs/.test(String(s.run ?? ""))),
  );
  assert.equal(
    verify[1].if,
    undefined,
    "the live check is conditional — AC3 must not be skippable",
  );
});

test("soft-failure control: the detector fires on every shape of swallowed failure", () => {
  // Positives.
  const jobLevel = { jobs: { a: { "continue-on-error": true, steps: [] } } };
  assert.deepEqual(softFailures(jobLevel), ["a"]);

  const stepLevel = {
    jobs: { a: { steps: [{ name: "ok" }, { name: "soft", "continue-on-error": true }] } },
  };
  assert.equal(softFailures(stepLevel).length, 1);
  assert.match(softFailures(stepLevel)[0], /steps\[1\]/);

  // An expression is not a promise. Nobody has evaluated it here, so it counts.
  const expr = { jobs: { a: { steps: [{ run: "x", "continue-on-error": "${{ github.event_name }}" }] } } };
  assert.equal(expr.jobs.a.steps.length, 1);
  assert.equal(softFailures(expr).length, 1);

  // Near misses that must NOT fire: explicitly hard-failing, and absent.
  assert.deepEqual(softFailures({ jobs: { a: { "continue-on-error": false, steps: [] } } }), []);
  assert.deepEqual(softFailures({ jobs: { a: { steps: [{ run: "x", "continue-on-error": false }] } } }), []);
  assert.deepEqual(softFailures({ jobs: { a: { steps: [{ run: "x" }] } } }), []);
  assert.deepEqual(softFailures({}), []);
});

test("docs.yml cannot deploy from a tag ref — including via workflow_dispatch", async () => {
  // R3. The trigger list bans tags, and the existing test above proves it. But
  // `workflow_dispatch` accepts ANY ref: `gh workflow run docs.yml --ref v1.0.0`
  // is a supported invocation, and review pointed out that the negative control
  // for the tag-trigger detector explicitly whitelists `workflow_dispatch` —
  // so the one trigger that can carry a tag was the one nothing checked.
  const wf = await load(DOCS);
  const deploy = wf.jobs["build-deploy"];
  assert.ok(deploy, "docs.yml has no build-deploy job");
  assert.ok(
    guardsAgainstTagRefs(deploy.if),
    `build-deploy does not confine itself to branch refs (if: ${deploy.if}) — ` +
      "a dispatch against a tag would reach the environment gate and fail there",
  );
});

test("ref-guard control: the detector accepts real guards and rejects lookalikes", () => {
  // Positives — both spellings that actually exclude tags.
  assert.equal(guardsAgainstTagRefs("github.ref == 'refs/heads/main'"), true);
  assert.equal(guardsAgainstTagRefs("github.ref=='refs/heads/main'"), true);
  assert.equal(guardsAgainstTagRefs('github.ref == "refs/heads/main"'), true);
  assert.equal(guardsAgainstTagRefs("startsWith(github.ref, 'refs/heads/')"), true);

  // THE KEY NEAR MISS. This looks like a ref guard, reads like a ref guard, and
  // admits every tag in the repository. If the detector accepts this it is not
  // a gate.
  assert.equal(guardsAgainstTagRefs("startsWith(github.ref, 'refs/')"), false);

  // Other lookalikes.
  assert.equal(guardsAgainstTagRefs("github.ref != 'refs/tags/v1'"), false);
  assert.equal(guardsAgainstTagRefs("github.event_name == 'push'"), false);
  assert.equal(guardsAgainstTagRefs("startsWith(github.ref, 'refs/tags/')"), false);
  assert.equal(guardsAgainstTagRefs(undefined), false);
  assert.equal(guardsAgainstTagRefs(""), false);
});

test("an in-flight Pages deploy is allowed to finish; a superseded PR build is not", async () => {
  // O2, and a DELIBERATE DEVIATION FROM PROPOSAL §10.2, which prescribes
  // `cancel-in-progress: true` for the deploy. Ruled in Phase 2 review and
  // asserted here so that a later phase reading §10.2 cannot helpfully restore
  // `true` without this going red and pointing at the reason. With `true`, a
  // second push to main inside the window kills run #1 mid-`deploy-pages` or
  // inside verify-live's retry window: a deployment in flight and an AC3 check
  // that never reported. A cancelled run is neither green nor red.
  const docs = await load(DOCS);
  assert.equal(docs.concurrency?.group, "pages");
  assert.equal(
    docs.concurrency?.["cancel-in-progress"],
    false,
    "a running Pages DEPLOY can now be cancelled part-way — see the comment at the " +
      "concurrency block in docs.yml before changing this back",
  );

  // The other direction, so this is a statement about the trade and not a
  // blanket preference: superseding a queued PR BUILD is cheap and correct.
  const ci = await load(SITE_CI);
  assert.equal(
    ci.concurrency?.["cancel-in-progress"],
    true,
    "PR builds no longer supersede each other — stale runs will pile up",
  );
  assert.notEqual(
    ci.concurrency?.group,
    docs.concurrency?.group,
    "the PR workflow shares a concurrency group with the deploy — a PR would cancel a deploy",
  );
});

test("every job in docs.yml has a timeout, and the live checker stays inside it", async () => {
  // O6. The live check retries against a site that may not be up yet. Against a
  // server that accepts connections and never answers, per-request timeouts
  // alone do not bound the run, and a wedged job holds the `pages` concurrency
  // group — which, with cancel-in-progress now false, means the NEXT deploy
  // waits behind it rather than replacing it. The two settings are related.
  const wf = await load(DOCS);
  for (const [name, job] of Object.entries(wf.jobs)) {
    const t = job["timeout-minutes"];
    assert.equal(typeof t, "number", `job ${name} has no timeout-minutes — it can hang for 6 hours`);
    assert.ok(t <= 30, `job ${name} has a ${t}-minute timeout, which is not a bound worth having`);
  }

  // The relation between the script's own budget and the job timeout is the
  // next test's job. It used to be a trailing `budget < timeout` assertion here,
  // which is satisfied by a one-minute gap and so guards nothing.
});

test("the SCRIPT stops the run, not the job timeout", async () => {
  // O6. The two numbers are the checker's own 15-minute budget and verify-live's
  // timeout-minutes: 20, and they live in different files. The property is that
  // THE SCRIPT ALWAYS GETS TO REPORT ITS OWN FAILURE. An opaque CI kill and a
  // clean deadline failure look completely different to whoever reads the log:
  // one says "the job was killed", the other says "0s left of the 15-minute
  // budget, not enough for another attempt".
  //
  // MEASURED, not projected. Against a server that accepts connections and
  // never answers, the whole run took 900s — 15.0 minutes exactly, exit 1, five
  // attempts, 40 requests each. It landed on the deadline rather than near it
  // because the budget is a SCHEDULER, not a wall: it declines to start an
  // attempt it cannot finish. So the script cannot exceed its budget, and the
  // gap to timeout-minutes is not headroom for the script at all.
  //
  // WHAT THE GAP IS FOR, AND WHY THE FLOOR IS 4. The gap covers everything the
  // job does AROUND the script — checkout, setup-node, npm ci,
  // download-artifact, teardown — which is inside timeout-minutes and outside
  // the budget.
  //
  // MEASURED ON THIS REPOSITORY'S OWN DEPENDENCY TREE, not inferred from a
  // sibling. site-ci run 32525192116, per-step: checkout 1s, setup-node 2s,
  // npm ci 6s, build 3s, typecheck + suite 20s. verify-live does not build and
  // does not run the suite; it does checkout, setup-node, npm ci,
  // download-artifact and teardown, so its non-script overhead is about TEN
  // SECONDS. A 4-minute floor is roughly 24x that.
  //
  // This replaces an earlier estimate that leaned on a sibling project's 32s
  // whole-job figure and carried npm ci against Astro, Starlight and Pagefind
  // as a provisional term — the worry being that our dependency tree might be
  // heavier than theirs. It is 6s with setup-node's cache. The term is retired
  // rather than left standing as a caveat nobody re-checked.
  //
  // The floor is therefore a DRIFT GUARD, not a safety margin. 4 and 5 protect
  // against nothing different at this scale, and the number is arbitrary — but
  // an arbitrary constant with a documented basis is a different object from
  // the same constant without one, so the basis is here rather than in a commit
  // message nobody will find.
  const wf = await load(DOCS);
  // Found by the step that RUNS the script, not by job name: renaming the job
  // must not silently retire this check.
  const found = Object.entries(wf.jobs).filter(([, j]) =>
    (j.steps ?? []).some((s) => /check-live-links\.mjs/.test(String(s.run ?? ""))),
  );
  assert.equal(found.length, 1, `expected exactly one job to run the live checker, found ${found.length}`);
  const [jobName, job] = found[0];
  const timeout = job["timeout-minutes"];
  assert.equal(typeof timeout, "number", `${jobName} has no timeout-minutes — the job is unbounded`);

  const script = await raw(join(siteRoot, "scripts", "check-live-links.mjs"));
  const m = /const TOTAL_BUDGET_MS = (\d+) \* 60_000;/.exec(script);
  assert.ok(m, "could not read the checker's overall budget from its source");
  const budget = Number(m[1]);

  assert.ok(
    budget <= timeout - 4,
    `the checker's ${budget}-minute budget leaves only ${timeout - budget} minute(s) in ${jobName} for ` +
      `setup and teardown before timeout-minutes (${timeout}) kills the job instead. The job ` +
      `timeout must stay the BACKSTOP for a wedged script, never the thing that stops a normal ` +
      `slow run — a killed job cannot say why it stopped.`,
  );

  // ...and the CLI default must be the same budget, or a workflow that passes
  // no flag gets a different deadline from the one asserted here.
  assert.match(
    script,
    /deadlineMinutes: TOTAL_BUDGET_MS \/ 60_000/,
    "the --deadline-minutes default is not the budget this test just checked",
  );
});

// THE DEPLOY-GATE DECISION, FACTORED OUT OF THE TEST SO IT CAN BE DRIVEN ON
// INPUT THAT IS NOT THE REAL FILE.
//
// It was inline, and inline is why it had no control: docs.yml complies, so the
// only way to red the detector was to mutate the real workflow and revert it,
// which is a thing a human does once and CI never does. The round-3 review ran
// five such mutations by hand and all five reddened correctly — so this is not a
// repair of a broken detector, it is the regression risk being institutionalised
// on the pattern test 181 already set for `verify-live`.
//
// Returns violation CODES instead of throwing, so the test below can attach the
// long diagnostics and the control can enumerate directions independently.
function gradeDeployGate(docs, ci) {
  const testStep = (j) =>
    (j.steps ?? []).find((s) => /(^|&&|;|\s)npm test(\s|$)/.test(String(s.run ?? "")));
  const codes = [];
  const ctx = {};

  const ciJob = Object.values(ci.jobs ?? {}).find((j) => testStep(j));
  if (!ciJob) codes.push("ci-reference-gone");

  // By what the job DOES, not by its name — a rename must not retire this.
  const deployers = Object.entries(docs.jobs ?? {}).filter(([, j]) =>
    (j.steps ?? []).some((s) => /actions\/deploy-pages@/.test(String(s.uses ?? ""))),
  );
  ctx.deployerCount = deployers.length;
  if (deployers.length !== 1) {
    codes.push("deployers-not-exactly-one");
    return { codes, ctx };
  }

  const [deployName, deployJob] = deployers[0];
  ctx.deployName = deployName;
  const steps = deployJob.steps ?? [];
  const at = (pred) => steps.findIndex(pred);
  const testAt = at((s) => /(^|&&|;|\s)npm test(\s|$)/.test(String(s.run ?? "")));
  const deployAt = at((s) => /actions\/deploy-pages@/.test(String(s.uses ?? "")));
  const configureAt = at((s) => /actions\/configure-pages@/.test(String(s.uses ?? "")));
  const buildAt = at((s) => /npm run build/.test(String(s.run ?? "")));
  ctx.testAt = testAt;

  if (testAt < 0) {
    codes.push("no-suite-on-deploy-path");
    return { codes, ctx };
  }
  // ORDER, NOT MERE PRESENCE. A test step after deploy-pages is a detector, not
  // a gate, and it satisfies a presence-only assertion perfectly.
  if (!(testAt < deployAt)) codes.push("suite-after-deploy");
  if (!(configureAt < 0 || testAt < configureAt)) codes.push("suite-after-configure-pages");
  // SAME COMMAND, not merely some command containing the word test. Two gates
  // running different subsets is a gate whose coverage nobody can state, and the
  // failure is silent: both green, one of them narrower.
  if (ciJob && String(steps[testAt].run).trim() !== String(testStep(ciJob).run).trim()) {
    codes.push("command-differs-from-pull-request-path");
  }
  if (steps[testAt]["working-directory"] !== "site") codes.push("wrong-working-directory");
  // The suite reads dist/, so a gate placed before the build tests nothing.
  if (!(buildAt >= 0 && buildAt < testAt)) codes.push("suite-before-build");
  return { codes, ctx };
}

test("the ref that DEPLOYS runs the same suite the pull request runs", async () => {
  // FOUND BY THE INDEPENDENT DESIGN READ, AND IT IS STRUCTURAL RATHER THAN
  // TEXTUAL. Every other test in this file asks whether a gate is correct. This
  // one asks whether the gate is on the path.
  //
  // `main` has no branch protection and no rulesets — the design read checked
  // the API rather than assuming — and `site-ci.yml` triggers only on
  // `pull_request`. So nothing required the suite to have RUN on the commit
  // docs.yml deploys. A direct push to `main`, an admin merge, or a merge whose
  // paths filter did not match, each reaches `deploy-pages` having executed
  // zero tests. Two rounds of gate-building sat on a path the deploy did not
  // traverse, and every one of those gates was individually green.
  //
  // Repository settings are the owner's. This asserts the part that is ours.
  const { codes, ctx } = gradeDeployGate(await load(DOCS), await load(SITE_CI));
  const has = (c) => codes.includes(c);
  const job = ctx.deployName;

  assert.ok(
    !has("ci-reference-gone"),
    "site-ci.yml no longer runs `npm test` — this test's reference point is gone",
  );
  assert.equal(ctx.deployerCount, 1, `expected exactly one deploying job, found ${ctx.deployerCount}`);
  assert.ok(
    !has("no-suite-on-deploy-path"),
    `${job} deploys to Pages without running the suite on the ref it deploys. ` +
      `site-ci.yml is pull_request-only and main has no required checks, so nothing else ` +
      `guarantees these tests ran against this commit.`,
  );
  assert.ok(
    !has("suite-after-deploy"),
    `${job} runs the suite AFTER deploying — that detects a bad deploy, it does not prevent one`,
  );
  assert.ok(
    !has("suite-after-configure-pages"),
    `${job} runs the suite after Configure Pages — a red suite would leave Pages deployment ` +
      `state already touched`,
  );
  assert.ok(
    !has("command-differs-from-pull-request-path"),
    "the deploy path and the pull-request path run DIFFERENT test commands",
  );
  assert.ok(
    !has("wrong-working-directory"),
    "the suite on the deploy path runs from the wrong directory",
  );
  assert.ok(
    !has("suite-before-build"),
    "the suite runs before the build, so it would assert against an absent or stale dist/",
  );

  // EXHAUSTIVE, so a direction added to the grader cannot be reported by nobody.
  // Without this, a future code with no matching assertion above would be
  // computed, returned, and silently discarded — a detector that runs and is not
  // read, which is the same as no detector.
  assert.deepEqual(codes, [], `deploy-gate violations with no diagnostic above: ${codes.join(", ")}`);
});

test("CONTROL: the deploy-gate detector can fail, in every direction it asserts", async () => {
  // Synthetic, for the reason test 181's control is synthetic: docs.yml complies,
  // so reddening this against the real file means breaking the tree. The five
  // mutations the round-3 review ran by hand are the first five rows here, plus
  // the two the review did not run.
  const npmTest = { run: "npm test", "working-directory": "site" };
  const build = { run: "npm run build", "working-directory": "site" };
  const deploy = { uses: "actions/deploy-pages@v4" };
  const configure = { uses: "actions/configure-pages@v5" };
  const ci = { jobs: { build: { steps: [{ run: "npm test", "working-directory": "site" }] } } };
  const docsWith = (steps) => ({ jobs: { "build-deploy": { steps } } });

  // The real docs.yml order, read from the file rather than imagined: build,
  // npm test, configure-pages, deploy-pages. I first wrote this fixture with
  // configure-pages FIRST and the grader reddened it, correctly — recorded here
  // because a control whose positive half was wrong is exactly how a control
  // gets quietly relaxed to match whatever the code does.
  const good = [build, npmTest, configure, deploy];
  const grade = (steps) => gradeDeployGate(docsWith(steps), ci).codes;

  // The positive half. If this stops holding, every negative below is vacuous.
  assert.deepEqual(grade(good), [], "the compliant shape no longer grades clean");

  const cases = [
    ["delete the npm test step", [build, configure, deploy], ["no-suite-on-deploy-path"]],
    // Two codes, not one, and that is the honest reading: moving the step past
    // deploy-pages also moves it past configure-pages.
    ["move it after deploy-pages", [build, configure, deploy, npmTest],
      ["suite-after-deploy", "suite-after-configure-pages"]],
    ["change it to npm run typecheck",
      [build, { run: "npm run typecheck", "working-directory": "site" }, configure, deploy],
      ["no-suite-on-deploy-path"]],
    ["move it before npm run build", [npmTest, build, configure, deploy], ["suite-before-build"]],
    ["working-directory .", [build, { run: "npm test", "working-directory": "." }, configure, deploy],
      ["wrong-working-directory"]],
    ["run it after Configure Pages", [build, configure, npmTest, deploy],
      ["suite-after-configure-pages"]],
    ["run a narrower command", [build,
      { run: "npm test -- tests/pins.test.mjs", "working-directory": "site" }, configure, deploy],
      ["command-differs-from-pull-request-path"]],
  ];

  for (const [name, steps, expected] of cases) {
    assert.deepEqual(grade(steps), expected, `mutation "${name}" was not detected as expected`);
  }

  // Structural directions, which the five hand mutations did not reach.
  assert.deepEqual(
    gradeDeployGate({ jobs: { a: { steps: [deploy] }, b: { steps: [deploy] } } }, ci).codes,
    ["deployers-not-exactly-one"],
    "two deploying jobs is not detected — the gate would grade only one of them",
  );
  assert.ok(
    gradeDeployGate(docsWith(good), { jobs: { build: { steps: [build] } } }).codes.includes(
      "ci-reference-gone",
    ),
    "a site-ci.yml with no npm test is not detected, so the comparison would be against nothing",
  );

  // And the real file through the same grader, pinning the synthetics to the
  // thing the test above actually asserts.
  assert.deepEqual(gradeDeployGate(await load(DOCS), await load(SITE_CI)).codes, []);
});

// THE FIX FOR AN INSTANCE OF A CLASS CREATED A NEW INSTANCE OF THE SAME CLASS,
// and that is the reason this test exists rather than any property of checkout.
//
// F9 was a mirrored constant whose ORIGIN COMPONENT had no coupling:
// `DEFAULT_URL` was a hand-written fourth copy of the deployed URL, and moving
// `SITE` while leaving it stale left 171 of 171 tests passing. Its base
// component was already coupled — moving `BASE` the same way turned one red.
// Graded by mutating each component separately, one at a time: moving both at
// once leaves 168 passing and 3 red, all of the red from the coupled half, which
// reads as coupled and hides the gap.
// Closing it made the checker IMPORT that file — which is right, and which gave
// `check-live-links.mjs` its first repo-source dependency. Before F9 the script
// imported only `node:` builtins and would have run against a checkout of
// nothing but itself. Now `verify-live` depends on the source tree.
//
// So closing a coupling gap by adding a dependency produced an IMPORT WITH NO
// COUPLING where there had been a HALF-COUPLED CONSTANT. Same class, new
// instance, created by the fix — and the new instance is the WORSE of the two,
// because an import is uncoupled in whole rather than in half. That is not a
// coincidence; it is what that shape of fix does, and it is why the check has
// to follow the fix.
//
// The workflow already complies — `verify-live` checks out. Nothing asserted
// it. And the failure mode is the bad kind: remove checkout on the reasoning
// that the job "only needs the artifact" and it dies at ERR_MODULE_NOT_FOUND,
// which does not read as a link-check failure to whoever opens the log. Latent
// in CI, which is the ground F9 itself was elevated on.
test("verify-live checks out the source its checker imports", async () => {
  const docs = await load(DOCS);

  // By what it DOES, as everywhere else in this file. A rename must not retire
  // this test, and neither must moving the check into a differently-named job.
  const checkers = Object.entries(docs.jobs).filter(([, j]) =>
    (j.steps ?? []).some((s) => /check-live-links\.mjs/.test(String(s.run ?? ""))),
  );
  assert.equal(checkers.length, 1, `expected exactly one live-checking job, found ${checkers.length}`);
  const [checkName, checkJob] = checkers[0];
  const steps = checkJob.steps ?? [];

  // The dependency is REAL and read from the script, not assumed: if the
  // checker ever stops importing from src/, this assertion should stop being
  // load-bearing rather than quietly persist as ritual.
  const script = await readFile(join(repoRoot, "site/scripts/check-live-links.mjs"), "utf8");
  const repoImports = [...script.matchAll(/^import[^\n]*from\s+"(\.\.?\/[^"]+)"/gm)].map((m) => m[1]);
  assert.ok(
    repoImports.length > 0,
    "check-live-links.mjs no longer imports from the repo — delete this test rather than keep it green",
  );

  const checkoutAt = steps.findIndex((s) => /actions\/checkout@/.test(String(s.uses ?? "")));
  assert.ok(
    checkoutAt >= 0,
    `${checkName} runs check-live-links.mjs, which imports ${repoImports.join(", ")} from the ` +
      `repository, but the job never checks the repository out. It would fail at ` +
      `ERR_MODULE_NOT_FOUND before making a single request, and the log would not look like ` +
      `a link-check failure.`,
  );

  // ORDER, not mere presence — the same distinction the deploy-gate test makes.
  // A checkout after the check is a checkout that did not help.
  const runAt = steps.findIndex((s) => /check-live-links\.mjs/.test(String(s.run ?? "")));
  assert.ok(
    checkoutAt < runAt,
    `${checkName} checks out AFTER running the checker, so the import is still unresolved`,
  );
});

test("CONTROL: the verify-live checkout assertion can fail", async () => {
  // Driven on a synthetic workflow rather than by editing the real one, because
  // the real file complies and a control that cannot be run without breaking
  // the tree is a control nobody runs.
  const run = "node scripts/check-live-links.mjs --url \"$LIVE_URL\"";
  const withCheckout = { jobs: { v: { steps: [{ uses: "actions/checkout@v4" }, { run }] } } };
  const without = { jobs: { v: { steps: [{ uses: "actions/download-artifact@v4" }, { run }] } } };
  const after = { jobs: { v: { steps: [{ run }, { uses: "actions/checkout@v4" }] } } };

  const checkoutBeforeRun = (wf) => {
    const job = Object.values(wf.jobs).find((j) =>
      (j.steps ?? []).some((s) => /check-live-links\.mjs/.test(String(s.run ?? ""))),
    );
    const c = job.steps.findIndex((s) => /actions\/checkout@/.test(String(s.uses ?? "")));
    const r = job.steps.findIndex((s) => /check-live-links\.mjs/.test(String(s.run ?? "")));
    return c >= 0 && c < r;
  };

  assert.equal(checkoutBeforeRun(withCheckout), true, "the positive half stopped holding");
  assert.equal(checkoutBeforeRun(without), false, "a job with NO checkout is not detected");
  assert.equal(checkoutBeforeRun(after), false, "a checkout AFTER the run is not detected");

  // And the same predicate on the real file, so the synthetic cases are pinned
  // to the thing the test above actually asserts.
  assert.equal(checkoutBeforeRun(await load(DOCS)), true);
});
