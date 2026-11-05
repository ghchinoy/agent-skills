#!/usr/bin/env python3
"""Audit and configure linters and AST readability rules for Google Python style.

Supports checking, auditing, and bootstrapping:
  - Ruff with Google docstrings (D), flake8-bugbear (B), pylint rules (PL),
    banned relative imports (TID252), and 80-char formatting.
  - Mypy with strict type-checking configuration.
  - Pre-commit configuration hooks.
  - Zero-dependency AST source auditing (--audit) for Google Python style rules:
    relative imports, legacy typing generics, symbol imports, bare/broad except
    blocks, mutable default arguments, missing public docstrings, and @staticmethod.

Usage:
  ./scripts/setup-linters.py --check [path] [--json]
  ./scripts/setup-linters.py --audit [path] [--json]
  ./scripts/setup-linters.py --apply [path] [--line-length 80|88]
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import pathlib
import sys
from typing import Any

DEFAULT_RUFF_BLOCK = """
[tool.ruff]
line-length = {line_length}
target-version = "py311"

[tool.ruff.lint]
select = [
    "E",     # pycodestyle errors
    "W",     # pycodestyle warnings
    "F",     # pyflakes
    "I",     # isort (import sorting)
    "N",     # pep8-naming
    "D",     # pydocstyle (Google docstring convention)
    "UP",    # pyupgrade (modern Python syntax)
    "B",     # flake8-bugbear (design & common bug checks)
    "C4",    # flake8-comprehensions
    "SIM",   # flake8-simplify
    "TID",   # flake8-tidy-imports (ban relative imports)
    "PLC",   # pylint conventions
    "PLE",   # pylint errors
    "PLR",   # pylint refactorings
    "PLW",   # pylint warnings
    "RUF",   # ruff-specific rules
]
ignore = [
    "D100",  # Missing docstring in public module
    "D104",  # Missing docstring in public package
    "PLR0913", # Too many arguments in function definition
]

[tool.ruff.lint.pydocstyle]
convention = "google"

[tool.ruff.lint.flake8-tidy-imports]
ban-relative-imports = "all"

[tool.ruff.lint.isort]
combine-as-imports = true
lines-after-imports = 2

[tool.ruff.format]
quote-style = "double"
indent-style = "space"
line-ending = "auto"
docstring-code-format = true
"""

DEFAULT_MYPY_BLOCK = """
[tool.mypy]
python_version = "3.11"
strict = true
warn_return_any = true
warn_unused_configs = true
disallow_untyped_defs = true
disallow_incomplete_defs = true
check_untyped_defs = true
disallow_untyped_decorators = true
no_implicit_optional = true
warn_redundant_casts = true
warn_unused_ignores = true
warn_no_return = true
show_error_codes = true
"""

PRE_COMMIT_CONFIG = """# Pre-commit configuration for Google Python Readability
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-toml
      - id: check-added-large-files

  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.5.5
    hooks:
      - id: ruff
        args: [--fix, --exit-non-zero-on-fix]
      - id: ruff-format

  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.11.1
    hooks:
      - id: mypy
        args: [--strict]
"""

LEGACY_TYPING_GENERICS = {
    "Dict",
    "List",
    "Tuple",
    "Optional",
    "Set",
    "FrozenSet",
    "Type",
}
EXEMPT_IMPORT_MODULES = {
    "__future__",
    "typing",
    "typing_extensions",
    "collections.abc",
}
STDLIB_FUNCTION_IMPORTS = {
    "os": {"getcwd", "listdir", "makedirs", "remove", "unlink", "walk", "getenv"},
    "os.path": {
        "abspath",
        "basename",
        "commonpath",
        "dirname",
        "exists",
        "isdir",
        "isfile",
        "join",
        "realpath",
    },
    "subprocess": {"Popen", "call", "check_call", "check_output", "run"},
    "json": {"dump", "dumps", "load", "loads"},
    "shutil": {"copy", "copy2", "copytree", "rmtree", "which"},
    "sys": {"exit"},
}
SKIP_DIRS = {
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    "node_modules",
    "dist",
    "build",
    "fixtures",
    "testdata",
    ".mypy_cache",
    ".ruff_cache",
    ".pytest_cache",
}


def check_readability_setup(target_dir: pathlib.Path, json_output: bool = False) -> int:
    """Audits the project root for Google readability linter configuration.

    Args:
        target_dir: Project root directory to inspect.
        json_output: Whether to emit structured JSON output.

    Returns:
        Exit code (0 if compliant, 1 if gaps are found).
    """
    pyproject_file = target_dir / "pyproject.toml"
    pre_commit_file = target_dir / ".pre-commit-config.yaml"

    errors: list[str] = []
    checks: list[str] = []

    if not pyproject_file.is_file():
        errors.append("pyproject.toml not found.")
    else:
        content = pyproject_file.read_text(encoding="utf-8")
        checks.append("pyproject.toml found.")

        if "[tool.ruff]" not in content:
            errors.append("[tool.ruff] configuration block is missing.")
        else:
            checks.append("[tool.ruff] configuration detected.")
            if 'convention = "google"' in content or "convention = 'google'" in content:
                checks.append("Ruff pydocstyle configured with Google convention.")
            else:
                errors.append(
                    "Ruff pydocstyle Google convention missing "
                    "(rule 'D' with convention = 'google')."
                )

            if (
                'ban-relative-imports = "all"' in content
                or "ban-relative-imports = 'all'" in content
            ):
                checks.append("Banned relative imports (TID252) configured.")
            else:
                errors.append(
                    "Banned relative imports missing "
                    "(flake8-tidy-imports ban-relative-imports = 'all')."
                )

        if "[tool.mypy]" not in content:
            errors.append("[tool.mypy] strict configuration block is missing.")
        else:
            checks.append("[tool.mypy] configuration detected.")
            if "strict = true" in content:
                checks.append("Mypy strict mode enabled.")
            else:
                errors.append("Mypy strict mode not explicitly enabled.")

    if not pre_commit_file.is_file():
        errors.append(".pre-commit-config.yaml not found.")
    else:
        checks.append(".pre-commit-config.yaml found.")

    passed = len(errors) == 0
    score = max(0, 100 - len(errors) * 20)

    if json_output:
        print(
            json.dumps(
                {
                    "passed": passed,
                    "score": score,
                    "errors": errors,
                    "warnings": [],
                    "checks": checks,
                },
                indent=2,
            )
        )
        return 0 if passed else 1

    print(f"Auditing Python readability setup in: {target_dir.resolve()}\n")
    for item in checks:
        print(f"[+] {item}")
    for err in errors:
        print(f"[-] {err}")

    print("\n" + "=" * 50)
    if passed:
        print("✓ Project conforms to recommended Google Python Readability tooling.")
        return 0
    print(f"✗ Found {len(errors)} tooling gap(s). Run with --apply to configure automatically.")
    return 1


def audit_python_file(path: pathlib.Path) -> tuple[list[str], list[str]]:
    """Audits a single Python source file against Google Python Readability AST rules.

    Args:
        path: Path to the `.py` file to inspect.

    Returns:
        Tuple of (errors, warnings).
    """
    errors: list[str] = []
    warnings: list[str] = []

    try:
        source = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as err:
        return [f"{path.name}: failed to read UTF-8 source ({err})"], []

    try:
        tree = ast.parse(source, filename=str(path))
    except SyntaxError as err:
        return [f"{path.name}:{err.lineno}: SyntaxError: {err.msg}"], []

    lines = source.splitlines()

    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.level and node.level > 0:
                errors.append(
                    f"[PY-IMP-001] {path.name}:{node.lineno}: relative import is banned "
                    "by Google Python Style Guide; use full package path."
                )
            elif node.module == "typing":
                imported = {alias.name for alias in node.names}
                legacy = sorted(imported & LEGACY_TYPING_GENERICS)
                if legacy:
                    errors.append(
                        f"[PY-IMP-002] {path.name}:{node.lineno}: legacy typing generic(s) "
                        f"{legacy}; prefer Python 3.10+ builtin generics (dict, list, X | None)."
                    )
            elif node.module and node.module not in EXEMPT_IMPORT_MODULES:
                line_txt = lines[node.lineno - 1] if 0 < node.lineno <= len(lines) else ""
                if "noqa" not in line_txt:
                    bad_symbols = [
                        alias.name
                        for alias in node.names
                        if not alias.name.islower()
                        or alias.name in STDLIB_FUNCTION_IMPORTS.get(node.module, set())
                    ]
                    if bad_symbols:
                        warnings.append(
                            f"[PY-IMP-003] {path.name}:{node.lineno}: imported symbol(s) "
                            f"{bad_symbols} from '{node.module}'; Google style prefers "
                            "importing modules only."
                        )

        elif isinstance(node, ast.ExceptHandler):
            line_txt = lines[node.lineno - 1] if 0 < node.lineno <= len(lines) else ""
            if "noqa" in line_txt:
                continue
            if node.type is None:
                errors.append(
                    f"[PY-ERR-001] {path.name}:{node.lineno}: bare 'except:' catches "
                    "SystemExit/KeyboardInterrupt; catch specific exceptions."
                )
            elif isinstance(node.type, ast.Name) and node.type.id == "Exception":
                errors.append(
                    f"[PY-ERR-001] {path.name}:{node.lineno}: broad 'except Exception:' "
                    "masks unexpected bugs; catch specific exception types."
                )

        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            defaults = list(node.args.defaults) + [
                d for d in node.args.kw_defaults if d is not None
            ]
            for default_node in defaults:
                if isinstance(default_node, (ast.List, ast.Dict, ast.Set)):
                    errors.append(
                        f"[PY-ARG-001] {path.name}:{node.lineno}: function '{node.name}' uses "
                        "a mutable default argument; use None and initialize inside body."
                    )
                elif (
                    isinstance(default_node, ast.Call)
                    and isinstance(default_node.func, ast.Name)
                    and default_node.func.id in {"list", "dict", "set"}
                ):
                    errors.append(
                        f"[PY-ARG-001] {path.name}:{node.lineno}: function '{node.name}' uses "
                        "a mutable default call; use None and initialize inside body."
                    )

            for dec in node.decorator_list:
                if isinstance(dec, ast.Name) and dec.id == "staticmethod":
                    warnings.append(
                        f"[PY-CLS-001] {path.name}:{node.lineno}: '@staticmethod' on "
                        f"'{node.name}' is discouraged by Google style; use a module-level "
                        "function instead."
                    )

    for top_node in tree.body:
        if isinstance(top_node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if not top_node.name.startswith("_") and ast.get_docstring(top_node) is None:
                errors.append(
                    f"[PY-DOC-001] {path.name}:{top_node.lineno}: public "
                    f"{type(top_node).__name__.lower()} '{top_node.name}' is missing a "
                    "Google-formatted docstring."
                )

    return errors, warnings


def audit_python_target(target: pathlib.Path, json_output: bool = False) -> int:
    """Audits a Python file or directory tree against Google Python Readability rules.

    Args:
        target: File or directory path to audit.
        json_output: Whether to emit structured JSON output.

    Returns:
        Exit code (0 if zero errors, 1 otherwise).
    """
    py_files: list[pathlib.Path] = []
    if target.is_file():
        py_files.append(target)
    elif target.is_dir():
        for root, dirs, files in os.walk(target):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in sorted(files):
                if fname.endswith(".py"):
                    py_files.append(pathlib.Path(root) / fname)
    else:
        msg = f"Target path not found: {target}"
        if json_output:
            print(
                json.dumps(
                    {"passed": False, "score": 0, "errors": [msg], "warnings": []},
                    indent=2,
                )
            )
        else:
            print(f"Error: {msg}", file=sys.stderr)
        return 1

    all_errors: list[str] = []
    all_warnings: list[str] = []
    for fpath in py_files:
        f_err, f_warn = audit_python_file(fpath)
        all_errors.extend(f_err)
        all_warnings.extend(f_warn)

    passed = len(all_errors) == 0
    score = max(0, 100 - (len(all_errors) * 15 + len(all_warnings) * 5))
    result: dict[str, Any] = {
        "passed": passed,
        "score": score,
        "errors": all_errors,
        "warnings": all_warnings,
        "files_scanned": len(py_files),
    }

    if json_output:
        print(json.dumps(result, indent=2))
        return 0 if passed else 1

    print(f"=== Google Python Readability AST Audit ({len(py_files)} file(s)) ===")
    print(f"Status: {'PASS' if passed else 'FAIL'} (Score: {score}/100)")
    if all_errors:
        print(f"\nErrors ({len(all_errors)}):")
        for err in all_errors:
            print(f"  ! {err}")
    if all_warnings:
        print(f"\nWarnings ({len(all_warnings)}):")
        for warn in all_warnings:
            print(f"  * {warn}")
    if passed and not all_warnings:
        print("\n[PASS] All Python files conform to Google Python Readability AST checks.")
    return 0 if passed else 1


def apply_readability_setup(
    target_dir: pathlib.Path, line_length: int, write_precommit: bool
) -> int:
    """Injects or updates linter configurations in the target directory.

    Args:
        target_dir: Target project root directory.
        line_length: Maximum line length (80 or 88).
        write_precommit: Whether to generate `.pre-commit-config.yaml`.

    Returns:
        Exit code (0 on success).
    """
    target_dir.mkdir(parents=True, exist_ok=True)
    pyproject_file = target_dir / "pyproject.toml"

    print(f"Applying Google readability linter configuration to: {target_dir.resolve()}")

    formatted_ruff = DEFAULT_RUFF_BLOCK.format(line_length=line_length).strip()
    formatted_mypy = DEFAULT_MYPY_BLOCK.strip()

    if pyproject_file.is_file():
        existing = pyproject_file.read_text(encoding="utf-8")
        append_blocks = []

        if "[tool.ruff]" not in existing:
            append_blocks.append(formatted_ruff)
            print("  + Added [tool.ruff] block to pyproject.toml")
        else:
            print("  * [tool.ruff] already exists in pyproject.toml (preserved)")

        if "[tool.mypy]" not in existing:
            append_blocks.append(formatted_mypy)
            print("  + Added [tool.mypy] block to pyproject.toml")
        else:
            print("  * [tool.mypy] already exists in pyproject.toml (preserved)")

        if append_blocks:
            new_content = existing.rstrip() + "\n\n" + "\n\n".join(append_blocks) + "\n"
            pyproject_file.write_text(new_content, encoding="utf-8")
    else:
        initial_content = f"""[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "{target_dir.name}"
version = "0.1.0"
description = "Project following Google Python Readability standards"
requires-python = ">=3.11"
dependencies = []

[dependency-groups]
dev = [
    "mypy>=1.10.0",
    "pytest>=8.0.0",
    "ruff>=0.5.0",
]

{formatted_ruff}

{formatted_mypy}
"""
        pyproject_file.write_text(initial_content, encoding="utf-8")
        print("  + Created pyproject.toml with Ruff & Mypy configurations")

    if write_precommit:
        pre_commit_file = target_dir / ".pre-commit-config.yaml"
        if not pre_commit_file.is_file():
            pre_commit_file.write_text(PRE_COMMIT_CONFIG.strip() + "\n", encoding="utf-8")
            print("  + Created .pre-commit-config.yaml")
        else:
            print("  * .pre-commit-config.yaml already exists (preserved)")

    print("\n✓ Setup complete. You can now run:")
    print("  ruff check . --fix")
    print("  ruff format .")
    print("  mypy .")
    return 0


def main() -> int:
    """CLI entrypoint for Python readability linter setup and AST source auditing."""
    parser = argparse.ArgumentParser(
        description="Audit and setup linters and AST checks for Google Python Readability."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--check",
        action="store_true",
        help="Audit repository for pyproject.toml and pre-commit linter configurations",
    )
    group.add_argument(
        "--audit",
        action="store_true",
        help="Run zero-dependency AST readability audit across Python source files",
    )
    group.add_argument(
        "--apply",
        action="store_true",
        help="Apply Google readability linter configurations",
    )

    parser.add_argument(
        "path",
        nargs="?",
        default=".",
        help="Target file or project root directory (default: current directory)",
    )
    parser.add_argument(
        "--line-length",
        type=int,
        choices=[80, 88],
        default=80,
        help="Max line length (default: 80, per Google style)",
    )
    parser.add_argument(
        "--no-pre-commit",
        action="store_true",
        help="Skip creating .pre-commit-config.yaml when applying",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit structured JSON output (for --check and --audit)",
    )

    args = parser.parse_args()
    target = pathlib.Path(args.path)

    if args.check:
        return check_readability_setup(target, json_output=args.json)
    if args.audit:
        return audit_python_target(target, json_output=args.json)
    if args.apply:
        return apply_readability_setup(target, args.line_length, not args.no_pre_commit)

    return 0


if __name__ == "__main__":
    sys.exit(main())
