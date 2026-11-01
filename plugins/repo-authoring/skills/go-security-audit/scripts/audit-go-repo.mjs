#!/usr/bin/env node
/**
 * audit-go-repo.mjs — Audits one or more Go repositories for go.mod toolchain floors,
 * Dockerfile builder/runtime alignment, .gitignore/.gcloudignore hygiene, and git sync status.
 *
 * Usage:
 *   ./scripts/audit-go-repo.mjs <path> [--json]
 */

import { execFile } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const RECOMMENDED_GO_FLOOR = [1, 26, 0];
const RECOMMENDED_IGNORES = [".serena", ".beads", ".dolt"];

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parseSemver(v) {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v ?? ""));
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

function compareSemver(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  }
  return 0;
}

async function findGoMods(root, maxDepth = 5, depth = 0) {
  if (depth > maxDepth) return [];
  const results = [];
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const e of entries) {
    if (
      e.name === "node_modules" ||
      e.name === ".git" ||
      e.name === "vendor" ||
      e.name === "dist" ||
      e.name === ".astro" ||
      e.name.startsWith(".site-e2e-")
    ) {
      continue;
    }
    const full = join(root, e.name);
    if (e.isFile() && e.name === "go.mod") {
      results.push(full);
    } else if (e.isDirectory()) {
      results.push(...(await findGoMods(full, maxDepth, depth + 1)));
    }
  }
  return results.sort();
}

function parseGoMod(raw) {
  const modMatch = /^module\s+(\S+)/m.exec(raw);
  const goMatch = /^go\s+(\S+)/m.exec(raw);
  const toolchainMatch = /^toolchain\s+(\S+)/m.exec(raw);

  const directDeps = [];
  const lines = raw.split("\n");
  let inRequire = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^require\s*\($/.test(trimmed)) {
      inRequire = true;
      continue;
    }
    if (inRequire && trimmed === ")") {
      inRequire = false;
      continue;
    }
    if (inRequire && trimmed && !trimmed.startsWith("//")) {
      const isIndirect = /\/\/\s*indirect\b/.test(trimmed);
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2 && !isIndirect) {
        directDeps.push({ module: parts[0], version: parts[1] });
      }
    } else if (/^require\s+\S+\s+\S+/.test(trimmed) && !/\/\/\s*indirect\b/.test(trimmed)) {
      const parts = trimmed.replace(/^require\s+/, "").split(/\s+/);
      directDeps.push({ module: parts[0], version: parts[1] });
    }
  }

  return {
    moduleName: modMatch ? modMatch[1] : null,
    goVersion: goMatch ? goMatch[1] : null,
    toolchain: toolchainMatch ? toolchainMatch[1] : null,
    directDeps,
  };
}

async function inspectDockerfile(modDir, goVersionTuple) {
  const dockerfilePath = join(modDir, "Dockerfile");
  if (!(await exists(dockerfilePath))) {
    return { present: false };
  }
  const raw = await readFile(dockerfilePath, "utf8");
  const fromGolang = /^FROM\s+golang:([^\s]+)/im.exec(raw);
  const golangTag = fromGolang ? fromGolang[1] : null;
  const dockerGoTuple = golangTag ? parseSemver(golangTag) : null;

  let builderAligned = null;
  if (dockerGoTuple && goVersionTuple) {
    builderAligned =
      dockerGoTuple[0] === goVersionTuple[0] && dockerGoTuple[1] === goVersionTuple[1];
  }

  const hasAptGet = /apt-get\s+install/.test(raw);
  const hasAptUpgrade = /apt-get\s+upgrade\s+-y/.test(raw);

  return {
    present: true,
    golangTag,
    builderAligned,
    hasAptGet,
    hasAptUpgrade: hasAptGet ? hasAptUpgrade : null,
  };
}

async function inspectIgnoreFiles(modDir) {
  const gitignorePath = join(modDir, ".gitignore");
  const gcloudignorePath = join(modDir, ".gcloudignore");

  const hasGitignore = await exists(gitignorePath);
  const hasGcloudignore = await exists(gcloudignorePath);

  const gitRaw = hasGitignore ? await readFile(gitignorePath, "utf8") : "";
  const gcloudRaw = hasGcloudignore ? await readFile(gcloudignorePath, "utf8") : "";

  const missingGitignore = hasGitignore
    ? RECOMMENDED_IGNORES.filter((item) => !gitRaw.includes(item))
    : [];
  const missingGcloudignore = hasGcloudignore
    ? RECOMMENDED_IGNORES.filter((item) => !gcloudRaw.includes(item))
    : [];

  return {
    hasGitignore,
    hasGcloudignore,
    missingGitignore,
    missingGcloudignore,
  };
}

async function checkGitStatus(modDir) {
  try {
    const { stdout } = await run("git", ["status", "-sb"], { cwd: modDir });
    const firstLine = stdout.split("\n")[0] ?? "";
    const behind = /\[.*behind\s+\d+.*\]/.test(firstLine);
    return { branchStatus: firstLine.replace(/^##\s*/, "").trim(), behind };
  } catch {
    return { branchStatus: null, behind: false };
  }
}

async function auditGoModule(modPath, workspaceRoot) {
  const modDir = dirname(modPath);
  const relDir = relative(workspaceRoot, modDir) || basename(modDir);
  const raw = await readFile(modPath, "utf8");
  const parsed = parseGoMod(raw);
  const goTuple = parseSemver(parsed.goVersion);
  const meetsFloor = goTuple ? compareSemver(goTuple, RECOMMENDED_GO_FLOOR) >= 0 : false;

  const dockerfile = await inspectDockerfile(modDir, goTuple);
  const ignores = await inspectIgnoreFiles(modDir);
  const git = await checkGitStatus(modDir);

  return {
    subproject: relDir,
    path: modDir,
    moduleName: parsed.moduleName,
    goVersion: parsed.goVersion,
    toolchain: parsed.toolchain,
    meetsGo126Floor: meetsFloor,
    directDependencyCount: parsed.directDeps.length,
    directDependencies: parsed.directDeps,
    dockerfile,
    ignores,
    git,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const jsonFlag = args.includes("--json");
  const targetArg = args.find((a) => !a.startsWith("--")) ?? process.cwd();
  const targetPath = resolve(targetArg);

  const modPaths = await findGoMods(targetPath, 5);
  const reports = [];
  for (const modPath of modPaths) {
    reports.push(await auditGoModule(modPath, targetPath));
  }

  const summary = {
    scannedAt: new Date().toISOString(),
    targetPath,
    modulesScanned: reports.length,
    belowGoFloor: reports.filter((r) => !r.meetsGo126Floor).length,
    dockerfileDrift: reports.filter((r) => r.dockerfile.present && r.dockerfile.builderAligned === false).length,
    reports,
  };

  if (jsonFlag) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`# Go & Container Security Audit Report`);
  console.log(`- **Target**: \`${targetPath}\``);
  console.log(
    `- **Go Modules Scanned**: ${summary.modulesScanned} (${summary.belowGoFloor} below \`go 1.26.0\` floor, ${summary.dockerfileDrift} with Dockerfile toolchain drift)\n`,
  );

  console.log(
    `| Subproject | Module | \`go.mod\` | Floor (\`>=1.26\`) | Direct Deps | Dockerfile Builder | \`apt-get upgrade\` | Git Sync |`,
  );
  console.log(`| :--- | :--- | :--- | :--- | ---: | :--- | :--- | :--- |`);

  for (const r of reports) {
    const dfBuilder = !r.dockerfile.present
      ? "—"
      : r.dockerfile.golangTag
        ? `\`golang:${r.dockerfile.golangTag}\` (${r.dockerfile.builderAligned ? "OK" : "DRIFT"})`
        : "no golang stage";
    const dfUpgrade = !r.dockerfile.present || r.dockerfile.hasAptUpgrade === null
      ? "—"
      : r.dockerfile.hasAptUpgrade
        ? "OK"
        : "MISSING";
    const gitState = r.git.behind ? `BEHIND (${r.git.branchStatus})` : "OK";
    console.log(
      `| \`${r.subproject}\` | \`${r.moduleName ?? "—"}\` | \`${r.goVersion ?? "—"}\` | ${r.meetsGo126Floor ? "OK" : "UPGRADE"} | ${r.directDependencyCount} | ${dfBuilder} | ${dfUpgrade} | ${gitState} |`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
