#!/usr/bin/env node
// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { execFileSync } from 'node:child_process';

const VALID_MODES = new Set(['open', 'forks', 'discover', 'impact', 'all']);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function printHelp() {
  console.log(`Usage: audit-contributions.mjs [options]

Read-only GitHub open-source contribution auditor powered by \`gh api graphql\`.
Four distinct, composable modes share one cached data pass and common filters.

Modes (--mode, comma-separated or repeatable):
  open        Open upstream PRs (conflicts, CI, reviews, last commenter) & issues
  forks       Fork & dangling branch audit (un-PR'd commits, empty branches, cleanup)
  discover    Fuzzy search across PRs, issues, forks/branches, and stars (--query)
  impact      Contribution ledger (merged/open/closed PRs & issues, public vs private)
  all         Compose open + forks + impact (+ discover if --query is supplied)

  Default: \`discover\` when --query is set, otherwise \`open\`.

Shared filters:
  --user <login>              GitHub username (defaults to authenticated gh user)
  --exclude-owner <csv>       Exclude repos owned by these users/orgs (repeatable)
  --exclude-repo <csv>        Exclude specific owner/repo entries (repeatable)
  --include-self              Include self-owned repos (excluded by default)
  --public-only               Include only public repositories
  --private-only              Include only private repositories
  --since <YYYY-MM-DD>        Start of date window (inclusive)
  --until <YYYY-MM-DD>        End of date window (inclusive)
  --days <N>                  Shorthand for --since <today - N days>
  --stale-days <N>            Days without updates to flag open items stale (default: 30)

Mode-specific options:
  --query <pattern>           Keyword or regex for discover mode (case-insensitive)
  --no-stars                  Skip starred repos during discover mode
  --include-bot-branches      Include snyk-fix-*/dependabot/*/renovate/* branches in forks mode
  --max-fork-checks <N>       Max upstream compare API calls in forks mode (default: 30)
  --max-pages <N>             Max GraphQL pages per connection (default: 30)

Output options:
  --format <md|json>          Output format (default: md)
  --json                      Shorthand for --format json
  -h, --help                  Show this help

Examples:
  ./scripts/audit-contributions.mjs --mode open --exclude-owner GoogleCloudPlatform
  ./scripts/audit-contributions.mjs --mode open,forks --stale-days 21
  ./scripts/audit-contributions.mjs --mode discover --query "diagram|graphviz|dot"
  ./scripts/audit-contributions.mjs --mode impact,open --since 2026-01-01 --public-only --json
`);
}

function splitCsv(value) {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseIsoDateBoundary(raw, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Invalid date "${raw}": expected YYYY-MM-DD`);
  }
  const iso = endOfDay ? `${raw}T23:59:59.999Z` : `${raw}T00:00:00.000Z`;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) {
    throw new Error(`Invalid date "${raw}"`);
  }
  return ts;
}

function parseArgs(argv) {
  const opts = {
    modes: [],
    user: null,
    excludeOwners: new Set(),
    excludeRepos: new Set(),
    includeSelf: false,
    publicOnly: false,
    privateOnly: false,
    sinceRaw: null,
    sinceTs: null,
    untilRaw: null,
    untilTs: null,
    staleDays: 30,
    query: null,
    includeStars: true,
    includeBotBranches: false,
    maxForkChecks: 30,
    maxPages: 30,
    format: 'md',
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '--json') {
      opts.format = 'json';
    } else if (arg === '--format' && argv[i + 1]) {
      const fmt = argv[++i].toLowerCase();
      if (fmt !== 'md' && fmt !== 'json') {
        throw new Error(`Invalid --format "${fmt}": expected md or json`);
      }
      opts.format = fmt;
    } else if (arg === '--mode' && argv[i + 1]) {
      for (const m of splitCsv(argv[++i].toLowerCase())) {
        if (!VALID_MODES.has(m)) {
          throw new Error(
            `Unknown mode "${m}". Valid modes: ${[...VALID_MODES].join(', ')}`,
          );
        }
        opts.modes.push(m);
      }
    } else if (arg === '--user' && argv[i + 1]) {
      opts.user = argv[++i].trim();
    } else if (arg === '--exclude-owner' && argv[i + 1]) {
      for (const o of splitCsv(argv[++i])) {
        opts.excludeOwners.add(o.toLowerCase());
      }
    } else if (arg === '--exclude-repo' && argv[i + 1]) {
      for (const r of splitCsv(argv[++i])) {
        opts.excludeRepos.add(r.toLowerCase());
      }
    } else if (arg === '--include-self') {
      opts.includeSelf = true;
    } else if (arg === '--public-only') {
      opts.publicOnly = true;
    } else if (arg === '--private-only') {
      opts.privateOnly = true;
    } else if (arg === '--since' && argv[i + 1]) {
      opts.sinceRaw = argv[++i].trim();
      opts.sinceTs = parseIsoDateBoundary(opts.sinceRaw, false);
    } else if (arg === '--until' && argv[i + 1]) {
      opts.untilRaw = argv[++i].trim();
      opts.untilTs = parseIsoDateBoundary(opts.untilRaw, true);
    } else if (arg === '--days' && argv[i + 1]) {
      const days = Number.parseInt(argv[++i], 10);
      if (!Number.isFinite(days) || days < 1) {
        throw new Error('--days must be a positive integer');
      }
      const d = new Date(Date.now() - days * MS_PER_DAY);
      opts.sinceRaw = d.toISOString().slice(0, 10);
      opts.sinceTs = parseIsoDateBoundary(opts.sinceRaw, false);
    } else if (arg === '--stale-days' && argv[i + 1]) {
      const n = Number.parseInt(argv[++i], 10);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error('--stale-days must be a positive integer');
      }
      opts.staleDays = n;
    } else if (arg === '--query' && argv[i + 1]) {
      opts.query = argv[++i];
    } else if (arg === '--no-stars') {
      opts.includeStars = false;
    } else if (arg === '--include-bot-branches') {
      opts.includeBotBranches = true;
    } else if (arg === '--max-fork-checks' && argv[i + 1]) {
      const n = Number.parseInt(argv[++i], 10);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error('--max-fork-checks must be a non-negative integer');
      }
      opts.maxForkChecks = n;
    } else if (arg === '--max-pages' && argv[i + 1]) {
      const n = Number.parseInt(argv[++i], 10);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error('--max-pages must be a positive integer');
      }
      opts.maxPages = n;
    } else {
      throw new Error(`Unknown or incomplete option: ${arg}`);
    }
  }

  if (opts.publicOnly && opts.privateOnly) {
    throw new Error('--public-only and --private-only cannot be used together');
  }

  // Resolve active mode set
  const modeSet = new Set();
  if (opts.modes.length === 0) {
    modeSet.add(opts.query ? 'discover' : 'open');
  } else {
    for (const m of opts.modes) {
      if (m === 'all') {
        modeSet.add('open');
        modeSet.add('forks');
        modeSet.add('impact');
        if (opts.query) modeSet.add('discover');
      } else {
        modeSet.add(m);
      }
    }
  }
  opts.activeModes = [...modeSet];

  if (modeSet.has('discover') && !opts.query) {
    throw new Error('Mode "discover" requires --query <pattern>');
  }

  return opts;
}

function sleepSync(ms) {
  const buf = new SharedArrayBuffer(4);
  const view = new Int32Array(buf);
  Atomics.wait(view, 0, 0, ms);
}

function ghExec(args, timeoutMs = 30000, maxAttempts = 2) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return execFileSync('gh', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (err) {
      const stderr = (err.stderr || '').toString().trim();
      const msg = stderr || err.message || 'gh invocation failed';
      lastErr = new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${msg}`);
      const isTransient = /\bHTTP (502|503|504)\b|ETIMEDOUT|ECONNRESET/i.test(msg);
      if (isTransient && attempt < maxAttempts) {
        sleepSync(attempt * 1000);
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

function ghGraphQL(query, variables = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, val] of Object.entries(variables)) {
    if (val === null || val === undefined) continue;
    if (typeof val === 'number' || typeof val === 'boolean') {
      args.push('-F', `${key}=${val}`);
    } else {
      args.push('-f', `${key}=${String(val)}`);
    }
  }
  const raw = ghExec(args);
  const parsed = JSON.parse(raw);
  if (parsed.errors && parsed.errors.length > 0 && !parsed.data) {
    throw new Error(
      `GraphQL error: ${parsed.errors.map((e) => e.message).join('; ')}`,
    );
  }
  return parsed;
}

function ghRestJson(endpoint) {
  const raw = ghExec(['api', endpoint]);
  return JSON.parse(raw);
}

function resolveUser(opts) {
  if (opts.user) return opts.user;
  const res = ghGraphQL('{ viewer { login } }');
  const login = res?.data?.viewer?.login;
  if (!login) {
    throw new Error(
      'Unable to resolve authenticated GitHub user. Run `gh auth login` or pass --user <login>.',
    );
  }
  return login;
}

function daysBetween(isoDate, nowMs) {
  if (!isoDate) return null;
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return null;
  return Math.max(0, Math.floor((nowMs - ts) / MS_PER_DAY));
}

function compileMatcher(query) {
  if (!query) return null;
  try {
    const re = new RegExp(query, 'i');
    return {
      pattern: query,
      mode: 'regex',
      test: (text) => Boolean(text && re.test(text)),
    };
  } catch {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return {
      pattern: query,
      mode: 'terms',
      test: (text) => {
        if (!text) return false;
        const lower = text.toLowerCase();
        return terms.every((t) => lower.includes(t));
      },
    };
  }
}

function repoPassesFilters(repo, userLower, opts) {
  if (!repo || !repo.nameWithOwner) return false;
  const fullLower = repo.nameWithOwner.toLowerCase();
  const ownerLower = (
    repo.owner?.login || fullLower.split('/')[0] || ''
  ).toLowerCase();

  if (!opts.includeSelf && ownerLower === userLower) return false;
  if (opts.excludeOwners.has(ownerLower)) return false;
  if (opts.excludeRepos.has(fullLower)) return false;
  if (opts.publicOnly && repo.isPrivate) return false;
  if (opts.privateOnly && !repo.isPrivate) return false;
  return true;
}

function inDateWindow(isoDate, opts) {
  if (!isoDate) return true;
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return true;
  if (opts.sinceTs !== null && ts < opts.sinceTs) return false;
  if (opts.untilTs !== null && ts > opts.untilTs) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Shared GraphQL Data Store (fetches each connection at most once per run)
// ---------------------------------------------------------------------------

const OPEN_PRS_QUERY = `
query($login: String!, $cursor: String) {
  user(login: $login) {
    pullRequests(first: 25, after: $cursor, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        state
        isDraft
        mergeable
        reviewDecision
        headRefName
        url
        createdAt
        updatedAt
        repository { nameWithOwner description isPrivate owner { login } }
        comments(last: 1) { totalCount nodes { author { login } createdAt } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;

const ALL_PRS_QUERY = `
query($login: String!, $cursor: String) {
  user(login: $login) {
    pullRequests(first: 100, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        state
        isDraft
        headRefName
        url
        createdAt
        updatedAt
        mergedAt
        closedAt
        repository { nameWithOwner description isPrivate owner { login } }
      }
    }
  }
}`;

const OPEN_ISSUES_QUERY = `
query($login: String!, $cursor: String) {
  user(login: $login) {
    issues(first: 50, after: $cursor, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        state
        url
        createdAt
        updatedAt
        repository { nameWithOwner description isPrivate owner { login } }
        comments(last: 1) { totalCount nodes { author { login } createdAt } }
      }
    }
  }
}`;

const ALL_ISSUES_QUERY = `
query($login: String!, $cursor: String) {
  user(login: $login) {
    issues(first: 100, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        state
        url
        createdAt
        updatedAt
        closedAt
        repository { nameWithOwner description isPrivate owner { login } }
      }
    }
  }
}`;

const FORKS_QUERY = `
query($login: String!, $cursor: String) {
  user(login: $login) {
    repositories(first: 25, after: $cursor, isFork: true, orderBy: {field: PUSHED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        nameWithOwner
        isPrivate
        isArchived
        url
        createdAt
        pushedAt
        updatedAt
        defaultBranchRef {
          name
          target { ... on Commit { oid committedDate } }
        }
        parent {
          nameWithOwner
          description
          isPrivate
          isArchived
          url
          owner { login }
          defaultBranchRef { name }
        }
        refs(refPrefix: "refs/heads/", first: 25) {
          totalCount
          nodes {
            name
            target {
              ... on Commit {
                oid
                committedDate
              }
            }
          }
        }
      }
    }
  }
}`;

const STARS_QUERY = `
query($login: String!, $cursor: String) {
  user(login: $login) {
    starredRepositories(first: 100, after: $cursor, orderBy: {field: STARRED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      edges {
        starredAt
        node {
          nameWithOwner
          description
          isPrivate
          url
          owner { login }
        }
      }
    }
  }
}`;

function paginateConnection({
  query,
  login,
  extract,
  maxPages,
  stopAfterNode,
  stats,
  label,
}) {
  const items = [];
  let cursor = null;
  let pages = 0;
  let totalCount = null;
  let truncated = false;

  while (pages < maxPages) {
    const res = ghGraphQL(query, { login, cursor });
    stats.graphqlCalls += 1;
    const conn = extract(res);
    if (!conn) break;
    if (totalCount === null && typeof conn.totalCount === 'number') {
      totalCount = conn.totalCount;
    }
    const batch = conn.nodes || conn.edges || [];
    let earlyStop = false;
    for (const item of batch) {
      if (stopAfterNode && stopAfterNode(item)) {
        earlyStop = true;
        break;
      }
      items.push(item);
    }
    pages += 1;
    if (earlyStop || !conn.pageInfo?.hasNextPage || !conn.pageInfo?.endCursor) {
      break;
    }
    cursor = conn.pageInfo.endCursor;
    if (pages >= maxPages) {
      truncated = true;
      stats.warnings.push(
        `${label}: reached --max-pages (${maxPages}); results may be truncated (totalCount=${totalCount}).`,
      );
    }
  }

  return { items, totalCount, pages, truncated };
}

class AuditStore {
  constructor(login, opts) {
    this.login = login;
    this.opts = opts;
    this.cache = {};
    this.stats = {
      graphqlCalls: 0,
      restCompareCalls: 0,
      warnings: [],
    };
  }

  getOpenPRs() {
    if (!this.cache.openPRs) {
      this.cache.openPRs = paginateConnection({
        query: OPEN_PRS_QUERY,
        login: this.login,
        extract: (r) => r?.data?.user?.pullRequests,
        maxPages: this.opts.maxPages,
        stats: this.stats,
        label: 'openPRs',
      });
    }
    return this.cache.openPRs;
  }

  getAllPRs({ respectSinceCutoff = false } = {}) {
    // If we already fetched full history (without cutoff), reuse it.
    if (this.cache.allPRsFull) return this.cache.allPRsFull;
    if (respectSinceCutoff && this.cache.allPRsSince) {
      return this.cache.allPRsSince;
    }

    const useCutoff = respectSinceCutoff && this.opts.sinceTs !== null;
    const res = paginateConnection({
      query: ALL_PRS_QUERY,
      login: this.login,
      extract: (r) => r?.data?.user?.pullRequests,
      maxPages: this.opts.maxPages,
      stopAfterNode: useCutoff
        ? (node) => Date.parse(node.createdAt) < this.opts.sinceTs
        : null,
      stats: this.stats,
      label: 'allPRs',
    });

    if (useCutoff) {
      this.cache.allPRsSince = res;
    } else {
      this.cache.allPRsFull = res;
    }
    return res;
  }

  getOpenIssues() {
    if (!this.cache.openIssues) {
      this.cache.openIssues = paginateConnection({
        query: OPEN_ISSUES_QUERY,
        login: this.login,
        extract: (r) => r?.data?.user?.issues,
        maxPages: this.opts.maxPages,
        stats: this.stats,
        label: 'openIssues',
      });
    }
    return this.cache.openIssues;
  }

  getAllIssues({ respectSinceCutoff = false } = {}) {
    if (this.cache.allIssuesFull) return this.cache.allIssuesFull;
    if (respectSinceCutoff && this.cache.allIssuesSince) {
      return this.cache.allIssuesSince;
    }

    const useCutoff = respectSinceCutoff && this.opts.sinceTs !== null;
    const res = paginateConnection({
      query: ALL_ISSUES_QUERY,
      login: this.login,
      extract: (r) => r?.data?.user?.issues,
      maxPages: this.opts.maxPages,
      stopAfterNode: useCutoff
        ? (node) => Date.parse(node.createdAt) < this.opts.sinceTs
        : null,
      stats: this.stats,
      label: 'allIssues',
    });

    if (useCutoff) {
      this.cache.allIssuesSince = res;
    } else {
      this.cache.allIssuesFull = res;
    }
    return res;
  }

  getForks({ respectSinceCutoff = false } = {}) {
    if (this.cache.forksFull) return this.cache.forksFull;
    if (respectSinceCutoff && this.cache.forksSince) {
      return this.cache.forksSince;
    }

    const useCutoff = respectSinceCutoff && this.opts.sinceTs !== null;
    const res = paginateConnection({
      query: FORKS_QUERY,
      login: this.login,
      extract: (r) => r?.data?.user?.repositories,
      maxPages: this.opts.maxPages,
      stopAfterNode: useCutoff
        ? (node) => {
            const pushedTs = Date.parse(node.pushedAt || node.createdAt || '');
            const createdTs = Date.parse(node.createdAt || '');
            return (
              Number.isFinite(pushedTs) &&
              pushedTs < this.opts.sinceTs &&
              (!Number.isFinite(createdTs) || createdTs < this.opts.sinceTs)
            );
          }
        : null,
      stats: this.stats,
      label: 'forks',
    });

    if (useCutoff) {
      this.cache.forksSince = res;
    } else {
      this.cache.forksFull = res;
    }
    return res;
  }

  getStars() {
    if (!this.cache.stars) {
      this.cache.stars = paginateConnection({
        query: STARS_QUERY,
        login: this.login,
        extract: (r) => r?.data?.user?.starredRepositories,
        maxPages: this.opts.maxPages,
        stats: this.stats,
        label: 'stars',
      });
    }
    return this.cache.stars;
  }
}

// ---------------------------------------------------------------------------
// Mode 1: Open Upstream Status Sweep (`open`)
// ---------------------------------------------------------------------------

function classifyOpenPR(pr, userLower, staleDays, nowMs) {
  const daysSinceUpdate = daysBetween(pr.updatedAt, nowMs);
  const ciState = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state || null;
  const lastComment = pr.comments?.nodes?.[0] || null;
  const lastCommentAuthor = lastComment?.author?.login || null;
  const lastCommentByOther = Boolean(
    lastCommentAuthor && lastCommentAuthor.toLowerCase() !== userLower,
  );

  const reasons = [];
  if (pr.mergeable === 'CONFLICTING') reasons.push('merge-conflict');
  if (ciState === 'FAILURE' || ciState === 'ERROR') reasons.push('ci-failing');
  if (pr.reviewDecision === 'CHANGES_REQUESTED') reasons.push('changes-requested');
  if (lastCommentByOther) reasons.push('other-replied-last');

  let bucket = 'waiting-on-maintainer';
  if (pr.isDraft) {
    bucket = 'draft';
  } else if (reasons.length > 0) {
    bucket = 'needs-your-action';
  } else if (daysSinceUpdate !== null && daysSinceUpdate >= staleDays) {
    bucket = 'stale';
  }

  return {
    repo: pr.repository.nameWithOwner,
    repoDescription: pr.repository.description || null,
    isPrivate: Boolean(pr.repository.isPrivate),
    number: pr.number,
    title: pr.title,
    url: pr.url,
    headRefName: pr.headRefName,
    isDraft: Boolean(pr.isDraft),
    mergeable: pr.mergeable || 'UNKNOWN',
    reviewDecision: pr.reviewDecision || null,
    ciState,
    commentCount: pr.comments?.totalCount ?? 0,
    lastCommentAuthor,
    lastCommentAt: lastComment?.createdAt || null,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    daysSinceCreated: daysBetween(pr.createdAt, nowMs),
    daysSinceUpdate,
    bucket,
    actionReasons: reasons,
  };
}

function classifyOpenIssue(issue, userLower, staleDays, nowMs) {
  const daysSinceUpdate = daysBetween(issue.updatedAt, nowMs);
  const lastComment = issue.comments?.nodes?.[0] || null;
  const lastCommentAuthor = lastComment?.author?.login || null;
  const lastCommentByOther = Boolean(
    lastCommentAuthor && lastCommentAuthor.toLowerCase() !== userLower,
  );

  let bucket = 'awaiting-response';
  if (lastCommentByOther) {
    bucket = 'other-replied-last';
  } else if (daysSinceUpdate !== null && daysSinceUpdate >= staleDays) {
    bucket = 'stale';
  }

  return {
    repo: issue.repository.nameWithOwner,
    repoDescription: issue.repository.description || null,
    isPrivate: Boolean(issue.repository.isPrivate),
    number: issue.number,
    title: issue.title,
    url: issue.url,
    commentCount: issue.comments?.totalCount ?? 0,
    lastCommentAuthor,
    lastCommentAt: lastComment?.createdAt || null,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    daysSinceCreated: daysBetween(issue.createdAt, nowMs),
    daysSinceUpdate,
    bucket,
  };
}

function runOpenMode(store, userLower, opts, nowMs) {
  const openPRsRaw = store.getOpenPRs().items;
  const openIssuesRaw = store.getOpenIssues().items;

  const prs = openPRsRaw
    .filter((pr) => repoPassesFilters(pr.repository, userLower, opts))
    .filter((pr) => inDateWindow(pr.createdAt, opts))
    .map((pr) => classifyOpenPR(pr, userLower, opts.staleDays, nowMs));

  const issues = openIssuesRaw
    .filter((iss) => repoPassesFilters(iss.repository, userLower, opts))
    .filter((iss) => inDateWindow(iss.createdAt, opts))
    .map((iss) => classifyOpenIssue(iss, userLower, opts.staleDays, nowMs));

  const prBuckets = {
    'needs-your-action': 0,
    'waiting-on-maintainer': 0,
    draft: 0,
    stale: 0,
  };
  for (const p of prs) prBuckets[p.bucket] = (prBuckets[p.bucket] || 0) + 1;

  const issueBuckets = {
    'other-replied-last': 0,
    'awaiting-response': 0,
    stale: 0,
  };
  for (const i of issues) {
    issueBuckets[i.bucket] = (issueBuckets[i.bucket] || 0) + 1;
  }

  return {
    summary: {
      openPRs: prs.length,
      openIssues: issues.length,
      prBuckets,
      issueBuckets,
      privateItems:
        prs.filter((p) => p.isPrivate).length +
        issues.filter((i) => i.isPrivate).length,
    },
    pullRequests: prs,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Mode 2: Fork & Dangling Branch Audit (`forks`)
// ---------------------------------------------------------------------------

const BOT_BRANCH_RE = /^(snyk-fix-|dependabot\/|renovate\/)/i;

function runForksMode(store, userLower, opts, nowMs) {
  const allowCutoff = !opts.activeModes.includes('discover');
  const forksRaw = store.getForks({ respectSinceCutoff: allowCutoff }).items;
  const openPRsRaw = store.getOpenPRs().items;

  // Map open PRs by "<parentRepoLower>::<headRefName>" for fast lookup
  const openPrByParentBranch = new Map();
  const openPrCountByParent = new Map();
  for (const pr of openPRsRaw) {
    const parentLower = pr.repository?.nameWithOwner?.toLowerCase();
    if (!parentLower) continue;
    openPrCountByParent.set(
      parentLower,
      (openPrCountByParent.get(parentLower) || 0) + 1,
    );
    if (pr.headRefName) {
      openPrByParentBranch.set(`${parentLower}::${pr.headRefName}`, {
        number: pr.number,
        title: pr.title,
        url: pr.url,
        mergeable: pr.mergeable,
      });
    }
  }

  // Cross-reference historical merged/closed PRs if already cached by impact/discover modes
  const historicalPrs =
    store.cache.allPRsFull?.items || store.cache.allPRsSince?.items || [];
  const closedPrByParentBranch = new Map();
  for (const pr of historicalPrs) {
    if (pr.state === 'OPEN') continue;
    const parentLower = pr.repository?.nameWithOwner?.toLowerCase();
    if (!parentLower || !pr.headRefName) continue;
    const key = `${parentLower}::${pr.headRefName}`;
    // Prefer MERGED over CLOSED if branch name was reused
    const existing = closedPrByParentBranch.get(key);
    if (!existing || pr.state === 'MERGED') {
      closedPrByParentBranch.set(key, {
        number: pr.number,
        state: pr.state,
        title: pr.title,
        url: pr.url,
      });
    }
  }
  const forkRecords = [];
  const pendingCompare = [];
  let botBranchesSkipped = 0;

  for (const fork of forksRaw) {
    const parent = fork.parent;
    if (!parent) continue;
    if (!repoPassesFilters(parent, userLower, opts)) continue;
    const activityDate = fork.pushedAt || fork.createdAt;
    if (!inDateWindow(activityDate, opts) && !inDateWindow(fork.createdAt, opts)) {
      continue;
    }

    const parentFull = parent.nameWithOwner;
    const parentLower = parentFull.toLowerCase();
    const forkDefaultName = fork.defaultBranchRef?.name || 'main';
    const forkDefaultOid = fork.defaultBranchRef?.target?.oid || null;
    const parentDefaultName = parent.defaultBranchRef?.name || forkDefaultName;
    const forkCreatedTs = Date.parse(fork.createdAt) || 0;
    const totalRefs = fork.refs?.totalCount ?? 0;

    const candidateBranches = [];
    for (const ref of fork.refs?.nodes || []) {
      if (!ref || ref.name === forkDefaultName) continue;
      if (!opts.includeBotBranches && BOT_BRANCH_RE.test(ref.name)) {
        botBranchesSkipped += 1;
        continue;
      }
      const oid = ref.target?.oid || null;
      const committedDate = ref.target?.committedDate || null;
      const committedAfterFork = committedDate
        ? Date.parse(committedDate) >= forkCreatedTs - 60_000
        : false;
      const matchesDefaultOid = Boolean(oid && forkDefaultOid && oid === forkDefaultOid);
      const linkedOpenPr =
        openPrByParentBranch.get(`${parentLower}::${ref.name}`) || null;
      const linkedHistoricalPr = linkedOpenPr
        ? null
        : closedPrByParentBranch.get(`${parentLower}::${ref.name}`) || null;

      // Filter out inherited upstream branches copied when forking large repos
      const likelyUserBranch =
        Boolean(linkedOpenPr) ||
        Boolean(linkedHistoricalPr) ||
        matchesDefaultOid ||
        committedAfterFork ||
        totalRefs <= 5;

      if (!likelyUserBranch) continue;

      const branchEntry = {
        fork: fork.nameWithOwner,
        parent: parentFull,
        parentDescription: parent.description || null,
        isPrivate: Boolean(fork.isPrivate || parent.isPrivate),
        branch: ref.name,
        status: 'unknown',
        aheadBy: null,
        behindBy: null,
        committedDate,
        daysSinceCommit: daysBetween(committedDate, nowMs),
        linkedOpenPr,
        linkedHistoricalPr,
        compareNote: null,
      };

      if (linkedOpenPr) {
        branchEntry.status = 'active-pr-branch';
      } else if (linkedHistoricalPr) {
        branchEntry.status =
          linkedHistoricalPr.state === 'MERGED'
            ? 'merged-pr-branch'
            : 'closed-pr-branch';
        branchEntry.compareNote = `PR #${linkedHistoricalPr.number} (${linkedHistoricalPr.state})`;
      } else if (matchesDefaultOid) {
        branchEntry.status = 'empty-branch';
        branchEntry.aheadBy = 0;
      } else if (parent.isArchived) {
        branchEntry.status = 'unchecked-branch';
        branchEntry.compareNote = 'upstream-archived';
      } else {
        pendingCompare.push({
          entry: branchEntry,
          parentFull,
          parentDefaultName,
          sortTs: Date.parse(committedDate || fork.createdAt) || 0,
        });
      }

      candidateBranches.push(branchEntry);
    }

    forkRecords.push({
      fork,
      parent,
      parentFull,
      parentLower,
      totalRefs,
      candidateBranches,
    });
  }

  // Pass 2: spend --max-fork-checks budget on newest branches first
  pendingCompare.sort((a, b) => b.sortTs - a.sortTs);
  let compareBudget = opts.maxForkChecks;
  let compareSkippedCount = 0;

  for (const item of pendingCompare) {
    if (compareBudget <= 0) {
      compareSkippedCount += 1;
      item.entry.status = 'unchecked-branch';
      item.entry.compareNote = 'max-fork-checks-budget-reached';
      continue;
    }
    compareBudget -= 1;
    store.stats.restCompareCalls += 1;
    try {
      const encParentDefault = encodeURIComponent(item.parentDefaultName);
      const encBranch = encodeURIComponent(item.entry.branch);
      const cmp = ghRestJson(
        `repos/${item.parentFull}/compare/${encParentDefault}...${store.login}:${encBranch}`,
      );
      item.entry.aheadBy = cmp.ahead_by ?? null;
      item.entry.behindBy = cmp.behind_by ?? null;
      if (item.entry.aheadBy > 0) {
        item.entry.status = 'unprd-commits';
      } else {
        item.entry.status = 'already-in-upstream';
      }
    } catch (e) {
      item.entry.status = 'compare-error';
      item.entry.compareNote = e.message.slice(0, 140);
    }
  }

  // Pass 3: finalize fork statuses and dangling branch list
  const forks = [];
  const danglingBranches = [];

  for (const rec of forkRecords) {
    const openPrCount = openPrCountByParent.get(rec.parentLower) || 0;
    const unprdCount = rec.candidateBranches.filter(
      (b) => b.status === 'unprd-commits',
    ).length;
    const emptyCount = rec.candidateBranches.filter(
      (b) => b.status === 'empty-branch',
    ).length;

    for (const b of rec.candidateBranches) {
      if (b.status !== 'active-pr-branch') {
        danglingBranches.push(b);
      }
    }

    let forkStatus = 'cleanup-candidate';
    if (openPrCount > 0) {
      forkStatus = 'has-open-pr';
    } else if (unprdCount > 0) {
      forkStatus = 'has-unprd-commits';
    } else if (emptyCount > 0) {
      forkStatus = 'has-empty-branch';
    } else if (rec.fork.isArchived) {
      forkStatus = 'archived';
    }

    forks.push({
      fork: rec.fork.nameWithOwner,
      url: rec.fork.url,
      parent: rec.parentFull,
      parentDescription: rec.parent.description || null,
      parentArchived: Boolean(rec.parent.isArchived),
      isPrivate: Boolean(rec.fork.isPrivate || rec.parent.isPrivate),
      createdAt: rec.fork.createdAt,
      pushedAt: rec.fork.pushedAt || null,
      updatedAt: rec.fork.updatedAt,
      totalBranchCount: rec.totalRefs,
      openPrCount,
      forkStatus,
      branches: rec.candidateBranches,
    });
  }

  if (compareSkippedCount > 0) {
    store.stats.warnings.push(
      `forks: skipped upstream compare for ${compareSkippedCount} branch(es) due to --max-fork-checks (${opts.maxForkChecks}).`,
    );
  }

  const branchBuckets = {};
  for (const b of danglingBranches) {
    branchBuckets[b.status] = (branchBuckets[b.status] || 0) + 1;
  }

  return {
    summary: {
      totalForksAudited: forks.length,
      forksWithOpenPRs: forks.filter((f) => f.forkStatus === 'has-open-pr').length,
      forksWithUnprdCommits: forks.filter(
        (f) => f.forkStatus === 'has-unprd-commits',
      ).length,
      forksWithEmptyBranches: forks.filter(
        (f) => f.forkStatus === 'has-empty-branch',
      ).length,
      cleanupCandidates: forks.filter((f) => f.forkStatus === 'cleanup-candidate')
        .length,
      danglingBranchBuckets: branchBuckets,
      botBranchesSkipped,
      compareCallsUsed: store.stats.restCompareCalls,
      compareSkipped: compareSkippedCount,
    },
    danglingBranches,
    forks,
  };
}

// ---------------------------------------------------------------------------
// Mode 3: Fuzzy Discovery (`discover`)
// ---------------------------------------------------------------------------

function runDiscoverMode(store, userLower, opts) {
  const matcher = compileMatcher(opts.query);
  const byRepo = new Map();

  function ensureRepo(repoObj) {
    const key = repoObj.nameWithOwner.toLowerCase();
    if (!byRepo.has(key)) {
      byRepo.set(key, {
        repo: repoObj.nameWithOwner,
        description: repoObj.description || null,
        isPrivate: Boolean(repoObj.isPrivate),
        url: repoObj.url || `https://github.com/${repoObj.nameWithOwner}`,
        matchedVia: new Set(),
        pullRequests: [],
        issues: [],
        fork: null,
        starredAt: null,
      });
    }
    const entry = byRepo.get(key);
    if (!entry.description && repoObj.description) {
      entry.description = repoObj.description;
    }
    return entry;
  }

  // 1. PRs (all states)
  for (const pr of store.getAllPRs({ respectSinceCutoff: false }).items) {
    if (!repoPassesFilters(pr.repository, userLower, opts)) continue;
    if (!inDateWindow(pr.createdAt, opts)) continue;
    const hitRepo =
      matcher.test(pr.repository.nameWithOwner) ||
      matcher.test(pr.repository.description);
    const hitTitle = matcher.test(pr.title) || matcher.test(pr.headRefName);
    if (hitRepo || hitTitle) {
      const entry = ensureRepo(pr.repository);
      if (hitRepo) entry.matchedVia.add('repo-metadata');
      if (hitTitle) entry.matchedVia.add('pr');
      entry.pullRequests.push({
        number: pr.number,
        state: pr.state,
        title: pr.title,
        url: pr.url,
        headRefName: pr.headRefName,
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
      });
    }
  }

  // 2. Issues (all states)
  for (const iss of store.getAllIssues({ respectSinceCutoff: false }).items) {
    if (!repoPassesFilters(iss.repository, userLower, opts)) continue;
    if (!inDateWindow(iss.createdAt, opts)) continue;
    const hitRepo =
      matcher.test(iss.repository.nameWithOwner) ||
      matcher.test(iss.repository.description);
    const hitTitle = matcher.test(iss.title);
    if (hitRepo || hitTitle) {
      const entry = ensureRepo(iss.repository);
      if (hitRepo) entry.matchedVia.add('repo-metadata');
      if (hitTitle) entry.matchedVia.add('issue');
      entry.issues.push({
        number: iss.number,
        state: iss.state,
        title: iss.title,
        url: iss.url,
        createdAt: iss.createdAt,
        updatedAt: iss.updatedAt,
      });
    }
  }

  // 3. Forks & branch names
  for (const fork of store.getForks().items) {
    const parent = fork.parent;
    if (!parent || !repoPassesFilters(parent, userLower, opts)) continue;
    const defaultName = fork.defaultBranchRef?.name || 'main';
    const branchNames = (fork.refs?.nodes || [])
      .map((r) => r.name)
      .filter((n) => n && n !== defaultName);
    const matchingBranches = branchNames.filter((b) => matcher.test(b));
    const hitRepo =
      matcher.test(parent.nameWithOwner) ||
      matcher.test(parent.description) ||
      matcher.test(fork.name);

    if (hitRepo || matchingBranches.length > 0 || byRepo.has(parent.nameWithOwner.toLowerCase())) {
      const entry = ensureRepo(parent);
      if (hitRepo) entry.matchedVia.add('fork');
      if (matchingBranches.length > 0) entry.matchedVia.add('fork-branch');
      entry.fork = {
        nameWithOwner: fork.nameWithOwner,
        url: fork.url,
        createdAt: fork.createdAt,
        nonDefaultBranches: branchNames,
        matchingBranches,
      };
    }
  }

  // 4. Starred repos (optional)
  if (opts.includeStars) {
    for (const edge of store.getStars().items) {
      const node = edge?.node;
      if (!node || !repoPassesFilters(node, userLower, opts)) continue;
      const hitRepo =
        matcher.test(node.nameWithOwner) || matcher.test(node.description);
      if (hitRepo || byRepo.has(node.nameWithOwner.toLowerCase())) {
        const entry = ensureRepo(node);
        if (hitRepo) entry.matchedVia.add('star');
        entry.starredAt = edge.starredAt;
      }
    }
  }

  // Rank matches: direct PR/issue/branch hits above star-only hits
  const matches = [...byRepo.values()]
    .map((m) => {
      const matchedVia = [...m.matchedVia];
      let score = 0;
      if (m.pullRequests.length > 0) score += 40;
      if (m.issues.length > 0) score += 35;
      if (m.fork?.matchingBranches?.length > 0) score += 30;
      else if (m.fork) score += 15;
      if (m.starredAt) score += 5;
      return { ...m, matchedVia, relevanceScore: score };
    })
    .sort(
      (a, b) =>
        b.relevanceScore - a.relevanceScore || a.repo.localeCompare(b.repo),
    );

  return {
    query: opts.query,
    matcherMode: matcher.mode,
    searchedStars: opts.includeStars,
    totalMatches: matches.length,
    matches,
  };
}

// ---------------------------------------------------------------------------
// Mode 4: Contribution Impact Ledger (`impact`)
// ---------------------------------------------------------------------------

function runImpactMode(store, userLower, opts) {
  // Only apply early cutoff when discover mode isn't also asking for all-time history
  const allowCutoff = !opts.activeModes.includes('discover');
  const prsRaw = store.getAllPRs({ respectSinceCutoff: allowCutoff }).items;
  const issuesRaw = store.getAllIssues({ respectSinceCutoff: allowCutoff }).items;

  const prs = prsRaw
    .filter((pr) => repoPassesFilters(pr.repository, userLower, opts))
    .filter((pr) => inDateWindow(pr.createdAt, opts));

  const issues = issuesRaw
    .filter((iss) => repoPassesFilters(iss.repository, userLower, opts))
    .filter((iss) => inDateWindow(iss.createdAt, opts));

  function makeTally() {
    return {
      prsMerged: 0,
      prsOpen: 0,
      prsClosedUnmerged: 0,
      issuesOpen: 0,
      issuesClosed: 0,
      repos: new Set(),
      orgs: new Set(),
    };
  }

  const allTally = makeTally();
  const publicTally = makeTally();
  const privateTally = makeTally();
  const repoMap = new Map();

  function touchRepo(repoObj) {
    const key = repoObj.nameWithOwner.toLowerCase();
    if (!repoMap.has(key)) {
      repoMap.set(key, {
        repo: repoObj.nameWithOwner,
        description: repoObj.description || null,
        isPrivate: Boolean(repoObj.isPrivate),
        prsMerged: 0,
        prsOpen: 0,
        prsClosedUnmerged: 0,
        issuesOpen: 0,
        issuesClosed: 0,
        lastActivityAt: null,
      });
    }
    return repoMap.get(key);
  }

  function recordActivity(entry, iso) {
    if (!iso) return;
    if (!entry.lastActivityAt || iso > entry.lastActivityAt) {
      entry.lastActivityAt = iso;
    }
  }

  for (const pr of prs) {
    const isPriv = Boolean(pr.repository.isPrivate);
    const targets = [allTally, isPriv ? privateTally : publicTally];
    const owner = pr.repository.owner?.login || pr.repository.nameWithOwner.split('/')[0];
    const repoEntry = touchRepo(pr.repository);
    recordActivity(repoEntry, pr.updatedAt || pr.createdAt);

    for (const t of targets) {
      t.repos.add(pr.repository.nameWithOwner);
      t.orgs.add(owner);
      if (pr.state === 'MERGED') t.prsMerged += 1;
      else if (pr.state === 'OPEN') t.prsOpen += 1;
      else t.prsClosedUnmerged += 1;
    }
    if (pr.state === 'MERGED') repoEntry.prsMerged += 1;
    else if (pr.state === 'OPEN') repoEntry.prsOpen += 1;
    else repoEntry.prsClosedUnmerged += 1;
  }

  for (const iss of issues) {
    const isPriv = Boolean(iss.repository.isPrivate);
    const targets = [allTally, isPriv ? privateTally : publicTally];
    const owner =
      iss.repository.owner?.login || iss.repository.nameWithOwner.split('/')[0];
    const repoEntry = touchRepo(iss.repository);
    recordActivity(repoEntry, iss.updatedAt || iss.createdAt);

    for (const t of targets) {
      t.repos.add(iss.repository.nameWithOwner);
      t.orgs.add(owner);
      if (iss.state === 'OPEN') t.issuesOpen += 1;
      else t.issuesClosed += 1;
    }
    if (iss.state === 'OPEN') repoEntry.issuesOpen += 1;
    else repoEntry.issuesClosed += 1;
  }

  function finalizeTally(t) {
    return {
      prsTotal: t.prsMerged + t.prsOpen + t.prsClosedUnmerged,
      prsMerged: t.prsMerged,
      prsOpen: t.prsOpen,
      prsClosedUnmerged: t.prsClosedUnmerged,
      issuesTotal: t.issuesOpen + t.issuesClosed,
      issuesOpen: t.issuesOpen,
      issuesClosed: t.issuesClosed,
      distinctRepos: t.repos.size,
      distinctOrgs: t.orgs.size,
    };
  }

  const byRepository = [...repoMap.values()].sort((a, b) => {
    const totalA =
      a.prsMerged + a.prsOpen + a.prsClosedUnmerged + a.issuesOpen + a.issuesClosed;
    const totalB =
      b.prsMerged + b.prsOpen + b.prsClosedUnmerged + b.issuesOpen + b.issuesClosed;
    return (
      b.prsMerged - a.prsMerged ||
      totalB - totalA ||
      (b.lastActivityAt || '').localeCompare(a.lastActivityAt || '')
    );
  });

  return {
    window: {
      since: opts.sinceRaw || 'all-time',
      until: opts.untilRaw || 'present',
    },
    summary: {
      all: finalizeTally(allTally),
      public: finalizeTally(publicTally),
      private: finalizeTally(privateTally),
    },
    byRepository,
  };
}

// ---------------------------------------------------------------------------
// Markdown Renderer
// ---------------------------------------------------------------------------

function privTag(isPrivate) {
  return isPrivate ? ' `[private]`' : '';
}

function renderMarkdown(report) {
  const lines = [];
  const { meta } = report;

  lines.push(`# OSS Contribution Audit — \`${meta.user}\``);
  lines.push('');
  lines.push(
    `- **Generated:** ${meta.generatedAt.slice(0, 10)} | **Modes:** \`${meta.modes.join(', ')}\` | **Scope:** ${meta.filters.visibility}`,
  );
  if (meta.filters.since || meta.filters.until) {
    lines.push(
      `- **Window:** ${meta.filters.since || 'all-time'} → ${meta.filters.until || 'present'}`,
    );
  }
  if (meta.filters.excludeOwners.length > 0 || meta.filters.excludeRepos.length > 0) {
    const parts = [];
    if (meta.filters.excludeOwners.length > 0) {
      parts.push(`owners: ${meta.filters.excludeOwners.join(', ')}`);
    }
    if (meta.filters.excludeRepos.length > 0) {
      parts.push(`repos: ${meta.filters.excludeRepos.join(', ')}`);
    }
    lines.push(`- **Excluded:** ${parts.join(' | ')}`);
  }
  lines.push(
    `- **API calls:** ${meta.stats.graphqlCalls} GraphQL, ${meta.stats.restCompareCalls} REST compare`,
  );

  if (meta.stats.warnings.length > 0) {
    lines.push('');
    lines.push('> **Warnings:**');
    for (const w of meta.stats.warnings) {
      lines.push(`> - ${w}`);
    }
  }

  // --- Mode 1: Open ---
  if (report.open) {
    const { summary, pullRequests, issues } = report.open;
    lines.push('');
    lines.push('## Open Upstream Status (`open`)');
    lines.push('');
    lines.push(
      `**Open PRs:** ${summary.openPRs} (Needs action: ${summary.prBuckets['needs-your-action']}, Waiting: ${summary.prBuckets['waiting-on-maintainer']}, Draft: ${summary.prBuckets.draft}, Stale >=${meta.filters.staleDays}d: ${summary.prBuckets.stale}) | **Open Issues:** ${summary.openIssues}`,
    );

    if (pullRequests.length > 0) {
      lines.push('');
      lines.push('### Open Pull Requests');
      lines.push('');
      lines.push('| Bucket | Repo | PR | Signals | Updated |');
      lines.push('| :--- | :--- | :--- | :--- | :--- |');
      const order = {
        'needs-your-action': 0,
        'waiting-on-maintainer': 1,
        draft: 2,
        stale: 3,
      };
      const sorted = [...pullRequests].sort(
        (a, b) =>
          (order[a.bucket] ?? 9) - (order[b.bucket] ?? 9) ||
          (a.daysSinceUpdate ?? 9999) - (b.daysSinceUpdate ?? 9999),
      );
      for (const p of sorted) {
        const signals = [];
        if (p.mergeable === 'CONFLICTING') signals.push('conflict');
        if (p.ciState) signals.push(`CI:${p.ciState.toLowerCase()}`);
        if (p.reviewDecision) signals.push(p.reviewDecision.toLowerCase());
        if (p.actionReasons.includes('other-replied-last')) {
          signals.push(`last:@${p.lastCommentAuthor}`);
        }
        lines.push(
          `| \`${p.bucket}\` | \`${p.repo}\`${privTag(p.isPrivate)} | [#${p.number}](${p.url}) ${p.title.replace(/\|/g, '\\|')} | ${signals.join(', ') || 'clean'} | ${p.updatedAt.slice(0, 10)} (${p.daysSinceUpdate}d) |`,
        );
      }
    }

    if (issues.length > 0) {
      lines.push('');
      lines.push('### Open Issues');
      lines.push('');
      lines.push('| Bucket | Repo | Issue | Comments | Updated |');
      lines.push('| :--- | :--- | :--- | :--- | :--- |');
      for (const iss of issues) {
        const lastInfo = iss.lastCommentAuthor
          ? `${iss.commentCount} (last: @${iss.lastCommentAuthor})`
          : `${iss.commentCount}`;
        lines.push(
          `| \`${iss.bucket}\` | \`${iss.repo}\`${privTag(iss.isPrivate)} | [#${iss.number}](${iss.url}) ${iss.title.replace(/\|/g, '\\|')} | ${lastInfo} | ${iss.updatedAt.slice(0, 10)} (${iss.daysSinceUpdate}d) |`,
        );
      }
    }
  }

  // --- Mode 2: Forks ---
  if (report.forks) {
    const { summary, danglingBranches } = report.forks;
    lines.push('');
    lines.push('## Fork & Dangling Branch Audit (`forks`)');
    lines.push('');
    lines.push(
      `**Forks audited:** ${summary.totalForksAudited} | **With open PR:** ${summary.forksWithOpenPRs} | **With un-PR'd commits:** ${summary.forksWithUnprdCommits} | **With empty branches:** ${summary.forksWithEmptyBranches} | **Cleanup candidates:** ${summary.cleanupCandidates}`,
    );

    if (danglingBranches.length > 0) {
      lines.push('');
      lines.push('### Dangling Non-Default Branches (No Open PR)');
      lines.push('');
      lines.push('| Status | Upstream Repo | Branch | Ahead / Behind | Last Commit |');
      lines.push('| :--- | :--- | :--- | :--- | :--- |');
      const rank = {
        'unprd-commits': 0,
        'empty-branch': 1,
        'unchecked-branch': 2,
        'merged-pr-branch': 3,
        'closed-pr-branch': 4,
        'already-in-upstream': 5,
        'compare-error': 6,
      };
      const sorted = [...danglingBranches].sort(
        (a, b) =>
          (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
          (a.daysSinceCommit ?? 9999) - (b.daysSinceCommit ?? 9999),
      );
      const primaryRows = sorted.filter(
        (b) => b.status === 'unprd-commits' || b.status === 'empty-branch',
      );
      const secondaryRows = sorted.filter(
        (b) => b.status !== 'unprd-commits' && b.status !== 'empty-branch',
      );
      const displayRows = [...primaryRows, ...secondaryRows.slice(0, 15)];
      for (const b of displayRows) {
        const ab =
          b.aheadBy !== null || b.behindBy !== null
            ? `+${b.aheadBy ?? '?'} / -${b.behindBy ?? '?'}`
            : b.compareNote || 'n/a';
        const dt = b.committedDate ? b.committedDate.slice(0, 10) : 'n/a';
        lines.push(
          `| \`${b.status}\` | \`${b.parent}\`${privTag(b.isPrivate)} | \`${b.branch}\` | ${ab} | ${dt} |`,
        );
      }
      if (secondaryRows.length > 15) {
        lines.push(
          `\n*Omitted ${secondaryRows.length - 15} additional already-merged/unchecked branch(es); use \`--json\` for the complete list.*`,
        );
      }
    }
  }

  // --- Mode 3: Discover ---
  if (report.discover) {
    const { query, totalMatches, matches } = report.discover;
    lines.push('');
    lines.push(`## Fuzzy Discovery (\`discover\`) — Query: \`${query}\``);
    lines.push('');
    lines.push(`**Matched repositories:** ${totalMatches}`);

    for (const m of matches) {
      lines.push('');
      lines.push(
        `### [\`${m.repo}\`](${m.url})${privTag(m.isPrivate)} — matched via \`${m.matchedVia.join(', ')}\``,
      );
      if (m.description) lines.push(`*${m.description}*`);
      if (m.pullRequests.length > 0) {
        for (const pr of m.pullRequests) {
          lines.push(
            `- **PR [#${pr.number}](${pr.url})** (${pr.state}, ${pr.createdAt.slice(0, 10)}): ${pr.title}`,
          );
        }
      }
      if (m.issues.length > 0) {
        for (const iss of m.issues) {
          lines.push(
            `- **Issue [#${iss.number}](${iss.url})** (${iss.state}, ${iss.createdAt.slice(0, 10)}): ${iss.title}`,
          );
        }
      }
      if (m.fork) {
        const branches =
          m.fork.nonDefaultBranches.length > 0
            ? m.fork.nonDefaultBranches.map((b) => `\`${b}\``).join(', ')
            : 'none';
        lines.push(
          `- **Fork:** [\`${m.fork.nameWithOwner}\`](${m.fork.url}) (created ${m.fork.createdAt.slice(0, 10)}) — non-default branches: ${branches}`,
        );
      }
      if (m.starredAt) {
        lines.push(`- **Starred:** ${m.starredAt.slice(0, 10)}`);
      }
    }
  }

  // --- Mode 4: Impact ---
  if (report.impact) {
    const { window: win, summary, byRepository } = report.impact;
    lines.push('');
    lines.push(
      `## Contribution Impact Ledger (\`impact\`) — ${win.since} → ${win.until}`,
    );
    lines.push('');
    lines.push(
      '| Scope | Merged PRs | Open PRs | Closed PRs | Open Issues | Closed Issues | Repos | Orgs |',
    );
    lines.push('| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const [label, t] of [
      ['Public', summary.public],
      ['Private', summary.private],
      ['Total', summary.all],
    ]) {
      lines.push(
        `| **${label}** | ${t.prsMerged} | ${t.prsOpen} | ${t.prsClosedUnmerged} | ${t.issuesOpen} | ${t.issuesClosed} | ${t.distinctRepos} | ${t.distinctOrgs} |`,
      );
    }

    if (byRepository.length > 0) {
      lines.push('');
      lines.push('### Repositories');
      lines.push('');
      lines.push(
        '| Repository | Visibility | Merged PRs | Open PRs | Issues (Open/Closed) | Last Activity |',
      );
      lines.push('| :--- | :--- | ---: | ---: | :---: | :--- |');
      for (const r of byRepository.slice(0, 40)) {
        lines.push(
          `| \`${r.repo}\` | ${r.isPrivate ? 'private' : 'public'} | ${r.prsMerged} | ${r.prsOpen} | ${r.issuesOpen}/${r.issuesClosed} | ${(r.lastActivityAt || '').slice(0, 10)} |`,
        );
      }
      if (byRepository.length > 40) {
        lines.push(
          `\n*Showing top 40 of ${byRepository.length} repositories (use \`--json\` for complete list).*`,
        );
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const nowMs = Date.now();
  const login = resolveUser(opts);
  const userLower = login.toLowerCase();
  const store = new AuditStore(login, opts);

  const report = {
    meta: {
      user: login,
      generatedAt: new Date(nowMs).toISOString(),
      modes: opts.activeModes,
      filters: {
        includeSelf: opts.includeSelf,
        visibility: opts.publicOnly
          ? 'public-only'
          : opts.privateOnly
            ? 'private-only'
            : 'public+private',
        excludeOwners: [...opts.excludeOwners],
        excludeRepos: [...opts.excludeRepos],
        since: opts.sinceRaw,
        until: opts.untilRaw,
        staleDays: opts.staleDays,
      },
      stats: store.stats,
    },
  };

  // Run discover / impact before forks so cached historical PRs enrich fork branch triage
  if (opts.activeModes.includes('open')) {
    report.open = runOpenMode(store, userLower, opts, nowMs);
  }
  if (opts.activeModes.includes('discover')) {
    report.discover = runDiscoverMode(store, userLower, opts);
  }
  if (opts.activeModes.includes('impact')) {
    report.impact = runImpactMode(store, userLower, opts);
  }
  if (opts.activeModes.includes('forks')) {
    report.forks = runForksMode(store, userLower, opts, nowMs);
  }

  if (opts.format === 'json') {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderMarkdown(report));
  }
}

try {
  main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
