#!/usr/bin/env python3
"""Reusable Skill Validator (Task-Agnostic Property Checker) for Go Readability.

Bundled inside the go-readability skill and invoked in-situ by an agent on any
Go source file or package directory. Checks universal Google Go style invariants:
1. Formatting: gofmt -l compliance (zero formatting diffs)
2. Naming: No 'this' or 'self' receivers (must be 1-2 letter type abbreviation)
3. Getters: No 'Get' prefix on plain field accessors (use 'Name()' not 'GetName()')
4. Error Handling: Error wrapping must use '%w' rather than '%v'
5. Error Safety: No ignored errors via blank identifier ('_ = ...')
6. Documentation: Package doc comments and exported symbol comments
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from typing import Any


def validate_go_file(file_path: str) -> dict[str, Any]:
    """Validates a Go source file against universal Google Go style invariants.

    Args:
        file_path: Path to the Go source file to inspect.

    Returns:
        A dictionary containing `passed`, `score`, `errors`, `warnings`, and `file`.
    """
    file_path = os.path.abspath(file_path)
    errors: list[str] = []
    warnings: list[str] = []

    if not os.path.isfile(file_path):
        return {
            "passed": False,
            "score": 0,
            "errors": [f"File not found: '{file_path}'"],
            "warnings": [],
        }

    with open(file_path, encoding="utf-8") as f:
        content = f.read()

    # 1. gofmt formatting check
    try:
        proc = subprocess.run(
            ["gofmt", "-l", file_path], capture_output=True, text=True, timeout=5
        )
        if proc.stdout.strip():
            errors.append(
                f"File '{os.path.basename(file_path)}' is not formatted with gofmt. "
                "Run 'gofmt -s -w'."
            )
    except (subprocess.SubprocessError, OSError) as err:
        warnings.append(f"gofmt execution warning: {err}")

    # 2. Receiver naming check (no 'this' or 'self')
    this_receiver_matches = re.findall(
        r"func\s*\(\s*(this|self)\s+\*?[a-zA-Z0-9_]+\s*\)", content, re.IGNORECASE
    )
    if this_receiver_matches:
        errors.append(
            f"Receiver name cannot be '{this_receiver_matches[0]}'. "
            "Google Go style mandates 1-2 letter abbreviation of the type "
            "(e.g. 'u' for UserManager)."
        )

    # 3. Plain getter anti-pattern check (GetName, GetEmail, etc.)
    getters = re.findall(
        r"func\s*\([^)]+\)\s*(Get[A-Z][a-zA-Z0-9_]*)\s*\(\s*\)\s*[a-zA-Z0-9_*]+\s*\{",
        content,
    )
    for getter in getters:
        expected_name = getter[3:]
        errors.append(
            f"Plain getter anti-pattern: '{getter}()'. "
            "Google Go style forbids 'Get' prefix for field accessors "
            f"(rename to '{expected_name}()')."
        )

    # 4. Error wrapping check (%w vs %v)
    v_wrap_matches = re.findall(r"fmt\.Errorf\([^)]*%v[^)]*,\s*err\s*\)", content)
    if v_wrap_matches:
        errors.append(
            "Error wrapping with '%v' breaks the error chain. "
            "Use '%w' in fmt.Errorf so callers can inspect with errors.Is / errors.As."
        )

    # 5. Discarded unhandled error check (_ = ...)
    discarded_errors = re.findall(
        r"_\s*=\s*[a-zA-Z0-9_.]*(Close|Write|Read|Flush)\s*\(", content
    )
    if discarded_errors:
        errors.append(
            f"Discarded error return on '{discarded_errors[0]}()' using blank identifier "
            "'_ = ...'. Handle or log errors explicitly."
        )

    # 6. Documentation comments
    if not re.search(r"^//\s*Package\s+\w+", content, re.MULTILINE):
        warnings.append("Missing standard package doc comment: '// Package <name> ...'")

    exported_types = re.findall(r"type\s+([A-Z][a-zA-Z0-9_]*)\s+struct", content)
    for exp_type in exported_types:
        if not re.search(r"//\s*" + exp_type + r"\b", content):
            warnings.append(
                f"Exported struct '{exp_type}' missing doc comment starting with '// {exp_type} ...'"
            )

    exported_funcs = re.findall(r"func\s+([A-Z][a-zA-Z0-9_]*)\s*\(", content)
    for exp_func in exported_funcs:
        if not re.search(r"//\s*" + exp_func + r"\b", content):
            warnings.append(
                f"Exported function '{exp_func}' missing doc comment "
                f"starting with '// {exp_func} ...'"
            )

    passed = len(errors) == 0
    score = max(0, 100 - (len(errors) * 15 + len(warnings) * 5))

    return {
        "passed": passed,
        "score": score,
        "errors": errors,
        "warnings": warnings,
        "file": os.path.basename(file_path),
    }


def main() -> None:
    """CLI entrypoint for Go Readability & Style validation."""
    parser = argparse.ArgumentParser(
        description="Deterministic Go Readability & Style Validator"
    )
    parser.add_argument(
        "target_path",
        nargs="?",
        default=".",
        help="Path to Go source file or directory containing .go files",
    )
    parser.add_argument("--json", action="store_true", help="Output results in JSON format")

    args = parser.parse_args()

    target = os.path.abspath(args.target_path)
    if os.path.isdir(target):
        target_file = os.path.join(target, "service.go")
        if not os.path.isfile(target_file):
            go_files = sorted(
                os.path.join(target, f) for f in os.listdir(target) if f.endswith(".go")
            )
            target_file = go_files[0] if go_files else target_file
    else:
        target_file = target

    res = validate_go_file(target_file)

    if args.json:
        print(json.dumps(res, indent=2))
    else:
        print("=== Go Readability & Style Conformance Report ===")
        print(f"Target:    {target_file}")
        print(f"Status:    {'PASS' if res['passed'] else 'FAIL'}")
        print(f"Score:     {res['score']} / 100")

        if res["errors"]:
            print(f"\nErrors ({len(res['errors'])}):")
            for err in res["errors"]:
                print(f"  ! {err}")

        if res["warnings"]:
            print(f"\nWarnings ({len(res['warnings'])}):")
            for warn in res["warnings"]:
                print(f"  * {warn}")

    sys.exit(0 if res["passed"] else 1)


if __name__ == "__main__":
    main()
