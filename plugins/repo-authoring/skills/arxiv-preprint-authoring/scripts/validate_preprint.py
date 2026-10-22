#!/usr/bin/env python3
"""Deterministic Validation Oracle for arXiv & Syntaxis Preprint Packages.

Audits a preprint directory (e.g., docs/preprint/) across 6 formal pillars (100 points):
1. Structural Completeness in paper.md (20 pts)
2. House-Style & Clarity Gate: Zero Em-Dashes & Zero Throat-Clearing in Prose (20 pts)
3. Quantitative Table Conventions & Ground-Truth CSV Presence (20 pts)
4. Luminous Graphviz Semantic Class Conformance & Rendered Assets (15 pts)
5. Typst (@preview/arkheion:0.1.2) Math & Booktabs Table Hygiene (15 pts)
6. End-to-End Typst PDF Compilation Verification (10 pts)
"""

import argparse
import csv
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


THROAT_CLEARING_PATTERNS = [
    (r"\bit is important to note that\b", "Throat-clearing opener ('It is important to note that')"),
    (r"\bit is worth noting that\b", "Throat-clearing opener ('It is worth noting that')"),
    (r"\bin the rapidly evolving landscape of\b", "AI cliché opener ('In the rapidly evolving landscape of')"),
    (r"\bneedless to say\b", "Throat-clearing phrase ('Needless to say')"),
    (r"\bnot merely\b.*?\bbut rather\b", "Formulaic binary contrast ('not merely ... but rather')"),
]

LATEX_IN_TYPST_PATTERNS = [
    (r"\\times\b", "LaTeX '\\times' in Typst (use 'times')"),
    (r"\\to\b", "LaTeX '\\to' in Typst (use 'arrow.r')"),
    (r"\\rightarrow\b", "LaTeX '\\rightarrow' in Typst (use 'arrow.r')"),
    (r"\\mathcal\b", "LaTeX '\\mathcal' in Typst (use 'cal(...)')"),
    (r"\\mathbb\b", "LaTeX '\\mathbb' in Typst (use 'bb(...)')"),
    (r"\\frac\b", "LaTeX '\\frac' in Typst (use 'frac(a, b)')"),
]


def check_preprint(preprint_dir: Path) -> dict:
    errors: list[str] = []
    warnings: list[str] = []
    pillar_scores: dict[str, int] = {}

    paper_md = preprint_dir / "paper.md"
    paper_typ = preprint_dir / "paper.typ"
    data_dir = preprint_dir / "data"
    figures_dir = preprint_dir / "figures"

    # -------------------------------------------------------------------------
    # Pillar 1: Structural Completeness in paper.md (20 pts)
    # -------------------------------------------------------------------------
    p1_score = 20
    if not paper_md.exists():
        errors.append(f"Missing primary Markdown manuscript: {paper_md}")
        p1_score = 0
        md_text = ""
    else:
        md_text = paper_md.read_text(encoding="utf-8")
        required_sections = [
            (r"^##\s+Abstract\b", "## Abstract"),
            (r"^##\s+1\s+Introduction\b", "## 1 Introduction"),
            (r"^##\s+2\s+Related Work\b", "## 2 Related Work"),
            (r"^##\s+3\s+Method\b", "## 3 Method"),
            (r"^##\s+4\s+Experiments\b", "## 4 Experiments"),
            (r"^##\s+5\s+Analysis\b", "## 5 Analysis"),
            (r"^##\s+6\s+Conclusion\b", "## 6 Conclusion"),
            (r"^##\s+Limitations\b", "## Limitations"),
            (r"^##\s+References\b", "## References"),
            (r"^##\s+Appendix A\b", "## Appendix A"),
            (r"^##\s+Appendix B\b", "## Appendix B"),
        ]
        for pattern, label in required_sections:
            if not re.search(pattern, md_text, flags=re.MULTILINE):
                errors.append(f"[Pillar 1: Structure] Missing required section '{label}' in paper.md.")
                p1_score = max(0, p1_score - 4)

    pillar_scores["pillar_1_structure"] = p1_score

    # -------------------------------------------------------------------------
    # Pillar 2: House-Style & Clarity Gate (20 pts)
    # -------------------------------------------------------------------------
    p2_score = 20
    if md_text:
        in_code_block = False
        for lineno, line in enumerate(md_text.splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("```"):
                in_code_block = not in_code_block
                continue
            if in_code_block:
                continue
            # Check for prohibited em-dashes in prose
            if "—" in line:
                errors.append(
                    f"[Pillar 2: House Style] paper.md:{lineno} contains prohibited em-dash ('—'). "
                    "Use a colon, semicolon, or parentheses instead."
                )
                p2_score = max(0, p2_score - 5)
            # Check for throat-clearing clichés
            for pat, desc in THROAT_CLEARING_PATTERNS:
                if re.search(pat, line, flags=re.IGNORECASE):
                    errors.append(f"[Pillar 2: House Style] paper.md:{lineno} {desc}.")
                    p2_score = max(0, p2_score - 5)

    pillar_scores["pillar_2_house_style"] = p2_score

    # -------------------------------------------------------------------------
    # Pillar 3: Quantitative Table Conventions & CSV Datasets (20 pts)
    # -------------------------------------------------------------------------
    p3_score = 20
    if not data_dir.exists() or not list(data_dir.glob("*.csv")):
        errors.append(f"[Pillar 3: Data & Tables] No CSV files found in {data_dir}/.")
        p3_score -= 10
    else:
        for csv_path in sorted(data_dir.glob("*.csv")):
            with csv_path.open("r", encoding="utf-8") as f:
                rows = list(csv.reader(f))
            if len(rows) < 2:
                errors.append(f"[Pillar 3: Data & Tables] CSV file '{csv_path.name}' has fewer than 2 rows.")
                p3_score = max(0, p3_score - 5)

    if md_text:
        has_arrows = ("\\uparrow" in md_text or "↑" in md_text) and ("\\downarrow" in md_text or "↓" in md_text)
        if not has_arrows:
            errors.append(
                "[Pillar 3: Data & Tables] Tables in paper.md must include directional arrows "
                "(\\uparrow / \\downarrow or ↑ / ↓) in metric headers."
            )
            p3_score = max(0, p3_score - 5)
        if "**Cross-Domain**" not in md_text and "Cross-Domain Mean" not in md_text and "**Mean**" not in md_text:
            warnings.append("[Pillar 3: Data & Tables] Main scoreboard table should include a Cross-Domain Mean summary block.")

    pillar_scores["pillar_3_tables_and_csv"] = p3_score

    # -------------------------------------------------------------------------
    # Pillar 4: Luminous Graphviz Semantic Classes (15 pts)
    # -------------------------------------------------------------------------
    p4_score = 15
    dot_files = list(figures_dir.glob("*.dot")) if figures_dir.exists() else []
    if not dot_files:
        errors.append(f"[Pillar 4: Luminous Figures] No Graphviz .dot files found in {figures_dir}/.")
        p4_score = 0
    else:
        for dot_file in sorted(dot_files):
            dot_content = dot_file.read_text(encoding="utf-8")
            if 'class="' not in dot_content:
                errors.append(
                    f"[Pillar 4: Luminous Figures] {dot_file.name} lacks semantic class=\"...\" attributes."
                )
                p4_score = max(0, p4_score - 5)
            hex_matches = re.findall(r"#[0-9a-fA-F]{6}\b", dot_content)
            if hex_matches:
                errors.append(
                    f"[Pillar 4: Luminous Figures] {dot_file.name} hardcodes hex colors ({hex_matches[:3]}). "
                    "Use semantic Luminous classes instead."
                )
                p4_score = max(0, p4_score - 5)
            png_file = dot_file.with_suffix(".png")
            if not png_file.exists():
                warnings.append(f"[Pillar 4: Luminous Figures] Missing rendered PNG for {dot_file.name}.")

    pillar_scores["pillar_4_luminous_figures"] = p4_score

    # -------------------------------------------------------------------------
    # Pillar 5: Typst (@preview/arkheion:0.1.2) Hygiene (15 pts)
    # -------------------------------------------------------------------------
    p5_score = 15
    if not paper_typ.exists():
        errors.append(f"[Pillar 5: Typst Hygiene] Missing companion Typst manuscript: {paper_typ}")
        p5_score = 0
        typ_text = ""
    else:
        typ_text = paper_typ.read_text(encoding="utf-8")
        if "@preview/arkheion:0.1.2" not in typ_text:
            warnings.append("[Pillar 5: Typst Hygiene] paper.typ does not import @preview/arkheion:0.1.2.")
        for pat, desc in LATEX_IN_TYPST_PATTERNS:
            if re.search(pat, typ_text):
                errors.append(f"[Pillar 5: Typst Hygiene] paper.typ contains {desc}.")
                p5_score = max(0, p5_score - 5)
        # Check for alignment keywords accidentally placed in columns: (...)
        bad_cols = re.findall(r"columns:\s*\([^)]*\b(?:left|right|center)\b[^)]*\)", typ_text)
        if bad_cols:
            errors.append(
                f"[Pillar 5: Typst Hygiene] paper.typ places alignment tokens inside columns: (...): {bad_cols[0]}. "
                "Use columns: (auto, ...) and align: (left, right, ...)."
            )
            p5_score = max(0, p5_score - 5)

    pillar_scores["pillar_5_typst_hygiene"] = p5_score

    # -------------------------------------------------------------------------
    # Pillar 6: Typst PDF Compilation Verification (10 pts)
    # -------------------------------------------------------------------------
    p6_score = 10
    typst_bin = shutil.which("typst") or "/Users/ghchinoy/homebrew/bin/typst"
    if paper_typ.exists() and Path(typst_bin).exists():
        pdf_out = preprint_dir / "paper.pdf"
        proc = subprocess.run(
            [typst_bin, "compile", str(paper_typ), str(pdf_out)],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            errors.append(
                f"[Pillar 6: Typst Compile] 'typst compile' failed (exit {proc.returncode}): "
                f"{proc.stderr.strip()[:300]}"
            )
            p6_score = 0
    elif not paper_typ.exists():
        p6_score = 0

    pillar_scores["pillar_6_typst_compile"] = p6_score

    total_score = sum(pillar_scores.values())
    passed = (total_score == 100) and (len(errors) == 0)

    return {
        "passed": passed,
        "score": total_score,
        "pillar_scores": pillar_scores,
        "errors": errors,
        "warnings": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate an arXiv / Syntaxis preprint directory.")
    parser.add_argument("preprint_dir", type=Path, help="Path to preprint directory (e.g. docs/preprint)")
    parser.add_argument("--json", action="store_true", help="Emit structured JSON output")
    args = parser.parse_args()

    result = check_preprint(args.preprint_dir.resolve())

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        status = "PASS" if result["passed"] else "FAIL"
        print(f"[{status}] Preprint Audit Score: {result['score']}/100")
        for k, v in result["pillar_scores"].items():
            print(f"  - {k}: {v}")
        for err in result["errors"]:
            print(f"! {err}")
        for warn in result["warnings"]:
            print(f"* {warn}")

    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
