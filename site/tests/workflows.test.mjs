// workflows.test.mjs — PHASE 2's two new workflow files, as a gate.
//
// Phase 1 shipped no workflows and pins.test.mjs asserted their ABSENCE. Phase 2
// ships both, so that assertion is replaced by this file: the properties the
// workflows have to hold are now checked on every run rather than eyeballed
// once in a pull request.
//
// The load-bearing one is the FIRST test. A sibling project deploys its docs on
// `push: tags: ['v*']` and its `github-pages` environment protection rejects
// `v*` tag refs, so the deploy fires at release time and dies at the
// environment gate. That is an observed failure, not a hypothesis, and the only
// thing standing between this repo and repeating it is the trigger in docs.yml.
// A comment saying "do not use a tag trigger" is not a gate. This is.
//
// Every detector here carries a control, because a detector nobody has proven
// can fire is not a gate — the pattern the Phase 1 suite is built on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

import { repoRoot, siteRoot } from "./_helpers.mjs";

const WORKFLOWS = join(repoRoot, ".github", "workflows");
const DOCS = join(WORKFLOWS, "docs.yml");
const SITE_CI = join(WORKFLOWS, "site-ci.yml");
const VALIDATE = join(WORKFLOWS, "validate.yml");

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

test("docs.yml deploys on push to main and CANNOT be triggered by a tag", async () => {
  const wf = await load(DOCS);
  const on = triggers(wf);
  assert.deepEqual(on.push?.branches, ["main"], "docs.yml does not deploy on push to main");
  assert.deepEqual(
    tagTriggers(wf),
    [],
    "docs.yml can be started by a tag ref — the github-pages environment rejects those",
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

test("both workflows watch plugins/** — a content change builds the site", async () => {
  // This is the whole argument for the site living in this repo. If plugins/**
  // ever drops out of either filter, a malformed SKILL.md merges green and the
  // site breaks afterwards, detached from its cause.
  for (const [name, file] of [["docs.yml", DOCS], ["site-ci.yml", SITE_CI]]) {
    const wf = await load(file);
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
  for (const file of [DOCS, SITE_CI]) {
    for (const u of usesIn(await load(file))) {
      assert.match(
        u,
        /@(v\d+(?:\.\d+){0,2}|[0-9a-f]{40})$/,
        `${u} is not pinned to a version tag or a commit sha`,
      );
    }
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

  for (const [name, file] of [["docs.yml", DOCS], ["site-ci.yml", SITE_CI]]) {
    const wf = await load(file);
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
  for (const [name, file] of [["docs.yml", DOCS], ["site-ci.yml", SITE_CI]]) {
    const wf = await load(file);
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
