#!/usr/bin/env python3
"""Deterministic security validator for MCP server configs, source code, and STDIO bridges.

Scans Model Context Protocol (MCP) configuration files and server/bridge source
code for:
  - MCP-CFG-001: STDIO command/args shell interpreter injection (-c, metacharacters).
  - MCP-SRC-001: Unsafe shell execution (shell=True, os.system, child_process.exec).
  - MCP-BRG-001: Process-table (ps aux / argv) Bearer token exposure in curl calls.
  - MCP-BRG-002: Unvalidated HTTP endpoint or missing https:// enforcement in bridges.
  - MCP-PATH-001: CWE-22 path containment prefix bypass using .startswith().
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
from typing import Any

CONFIG_FILENAMES = {
    "mcp.json",
    "claude_desktop_config.json",
    "gemini-extension.json",
    "settings.json",
    "plugin.json",
}
SOURCE_EXTENSIONS = {".py", ".js", ".mjs", ".ts", ".go", ".sh"}
SKIP_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
    ".astro",
    "fixtures",
    "testdata",
}

SHELL_BINARIES = {"sh", "bash", "zsh", "dash", "cmd", "cmd.exe", "powershell", "pwsh"}
DANGEROUS_FLAGS = {"-c", "/c", "-Command", "-EncodedCommand"}
SHELL_META_RE = re.compile(r"(\|\||&&|[|;`]|[$]\()")

PY_SHELL_TRUE_RE = re.compile(
    r"\b(subprocess\.(run|Popen|call|check_call|check_output))\b[^;\n]*\bshell\s*=\s*True\b"
)
PY_OS_SYSTEM_RE = re.compile(r"\bos\.(system|popen)\s*\(")
JS_SHELL_EXEC_RE = re.compile(
    r"\bchild_process\.(exec|execSync)\s*\(|\bspawn(Sync)?\s*\([^)]*shell\s*:\s*true"
)
ARGV_BEARER_RE = re.compile(r"Authorization:\s*Bearer\s+(\$\{?[A-Za-z0-9_]+|\{[A-Za-z0-9_]+\}|%s)")
CURL_HEADER_FILE_RE = re.compile(r"@|--config\b|-K\b")
CWE22_STARTSWITH_RE = re.compile(
    r"\b(realpath|abspath|safe_path|cand_path|target_path)[A-Za-z0-9_.]*\.startswith\("
)


def audit_mcp_config_file(path: pathlib.Path) -> tuple[list[str], list[str]]:
    """Audits a JSON MCP configuration file for STDIO transport injection.

    Args:
        path: Path to the JSON configuration file.

    Returns:
        Tuple of (errors, warnings).
    """
    errors: list[str] = []
    warnings: list[str] = []
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
    except (OSError, json.JSONDecodeError):
        return errors, warnings

    if not isinstance(data, dict):
        return errors, warnings

    servers = data.get("mcpServers")
    if not isinstance(servers, dict):
        return errors, warnings

    for name, cfg in servers.items():
        if not isinstance(cfg, dict):
            continue
        cmd = str(cfg.get("command", "")).strip()
        args = cfg.get("args", [])
        if not isinstance(args, list):
            args = []
        str_args = [str(a) for a in args]

        cmd_base = os.path.basename(cmd)
        if cmd_base in SHELL_BINARIES:
            errors.append(
                f"[MCP-CFG-001] {path.name} (server '{name}'): executes shell interpreter "
                f"'{cmd}' directly in STDIO config."
            )

        for arg in str_args:
            if arg in DANGEROUS_FLAGS:
                errors.append(
                    f"[MCP-CFG-001] {path.name} (server '{name}'): dangerous inline execution "
                    f"flag '{arg}' in STDIO args."
                )
            if SHELL_META_RE.search(arg):
                warnings.append(
                    f"[MCP-CFG-001] {path.name} (server '{name}'): shell metacharacter pattern "
                    f"detected in arg '{arg}'."
                )
    return errors, warnings


def audit_source_file(path: pathlib.Path) -> tuple[list[str], list[str]]:
    """Audits a source file for RCE, argv token leaks, SSRF, and CWE-22 bugs.

    Args:
        path: Path to the source file.

    Returns:
        Tuple of (errors, warnings).
    """
    errors: list[str] = []
    warnings: list[str] = []
    try:
        content = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return errors, warnings

    lines = content.splitlines()
    for idx, line in enumerate(lines, start=1):
        stripped = line.strip()
        if stripped.startswith(("#", "//")):
            continue

        if PY_SHELL_TRUE_RE.search(line) or PY_OS_SYSTEM_RE.search(line):
            errors.append(
                f"[MCP-SRC-001] {path.name}:{idx}: unsafe shell execution "
                "('shell=True' or 'os.system'). Use argument lists with shell=False."
            )
        if JS_SHELL_EXEC_RE.search(line):
            errors.append(
                f"[MCP-SRC-001] {path.name}:{idx}: unsafe Node shell execution "
                "('child_process.exec' or 'shell: true'). Use 'execFile' without a shell."
            )
        if CWE22_STARTSWITH_RE.search(line):
            errors.append(
                f"[MCP-PATH-001] {path.name}:{idx}: path containment checked via '.startswith()' "
                "(vulnerable to CWE-22 sibling prefix bypass). Use 'os.path.commonpath'."
            )

    if ARGV_BEARER_RE.search(content) and "curl" in content:
        # Check if Authorization: Bearer is passed directly as a -H argument string
        for idx, line in enumerate(lines, start=1):
            if "Authorization:" in line and "Bearer" in line and not CURL_HEADER_FILE_RE.search(line):
                # If written to a 0600 file via .write(...), it's safe; if in a list or curl command, flag it
                if "write(" not in line:
                    errors.append(
                        f"[MCP-BRG-001] {path.name}:{idx}: Bearer token interpolated into "
                        "process arguments (visible in 'ps aux'). Pass via a 0600 header file "
                        "('curl -H @headers.txt')."
                    )

    if "curl" in content and ("ENDPOINT" in content or "endpoint" in content):
        if "https://" not in content and "urlparse" not in content:
            warnings.append(
                f"[MCP-BRG-002] {path.name}: STDIO-to-HTTP bridge invokes 'curl' without "
                "verifying 'https://' scheme or host allowlist (SSRF / token exfiltration risk)."
            )

    return errors, warnings


def audit_target(target: pathlib.Path) -> dict[str, Any]:
    """Scans a file or directory for MCP security vulnerabilities.

    Args:
        target: File or root directory to scan.

    Returns:
        Result dictionary with `passed`, `score`, `errors`, `warnings`, and `files_scanned`.
    """
    errors: list[str] = []
    warnings: list[str] = []
    files_scanned = 0

    if not target.exists():
        return {
            "passed": False,
            "score": 0,
            "errors": [f"Target path does not exist: {target}"],
            "warnings": [],
            "files_scanned": 0,
        }

    candidates: list[pathlib.Path] = []
    if target.is_file():
        candidates.append(target)
    else:
        for root, dirs, files in os.walk(target):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in sorted(files):
                fpath = pathlib.Path(root) / fname
                if fname in CONFIG_FILENAMES or fpath.suffix in SOURCE_EXTENSIONS:
                    candidates.append(fpath)

    for fpath in candidates:
        files_scanned += 1
        if fpath.name in CONFIG_FILENAMES and fpath.suffix == ".json":
            c_err, c_warn = audit_mcp_config_file(fpath)
            errors.extend(c_err)
            warnings.extend(c_warn)
        elif fpath.suffix in SOURCE_EXTENSIONS:
            s_err, s_warn = audit_source_file(fpath)
            errors.extend(s_err)
            warnings.extend(s_warn)

    passed = len(errors) == 0
    score = max(0, 100 - (len(errors) * 20 + len(warnings) * 5))
    return {
        "passed": passed,
        "score": score,
        "errors": errors,
        "warnings": warnings,
        "files_scanned": files_scanned,
    }


def main() -> int:
    """CLI entrypoint for MCP security validation."""
    parser = argparse.ArgumentParser(
        description="Validate MCP configs, servers, and STDIO bridges for security defects."
    )
    parser.add_argument(
        "target",
        nargs="?",
        default=".",
        help="File or directory to audit (default: current directory)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit structured JSON output for automated grading",
    )
    args = parser.parse_args()

    result = audit_target(pathlib.Path(args.target))
    if args.json:
        print(json.dumps(result, indent=2))
        return 0 if result["passed"] else 1

    print(f"=== MCP Security Audit ({result['files_scanned']} files scanned) ===")
    print(f"Status: {'PASS' if result['passed'] else 'FAIL'} (Score: {result['score']}/100)")
    if result["errors"]:
        print(f"\nErrors ({len(result['errors'])}):")
        for err in result["errors"]:
            print(f"  ! {err}")
    if result["warnings"]:
        print(f"\nWarnings ({len(result['warnings'])}):")
        for warn in result["warnings"]:
            print(f"  * {warn}")
    if result["passed"] and not result["warnings"]:
        print("\n[PASS] Zero MCP security defects detected.")
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
