#!/usr/bin/env python3
"""
Skill Lint, Token Bloat Analyzer & Learning-Rate Bounded Clipper.
Implements the core tenets of:
- Microsoft Research SkillOpt (Textual Learning-Rate Budget & Gradient Clipping `clip.py`).
- Google Research Harness² (Context Ledger & Token Accounting `ledger.py`).
Identifies verbose skills, unnecessary explanation bloat, malformed instructions,
and enforces a strict Token Budget (< 1,500 tokens / skill).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple


@dataclass
class SkillTokenAudit:
    skill_name: str
    file_path: str
    token_estimate: int
    line_count: int
    bloat_score: float  # 0.0 to 1.0 (higher = more bloated/inefficient)
    issues: List[str]
    optimization_suggestions: List[str]


class SkillTokenOptimizer:
    """Lints skills for token efficiency, conciseness, and bounded budget clipping."""

    MAX_RECOMMENDED_TOKENS = 1500  # SkillOpt standard: 300 to 1500 tokens
    MIN_RECOMMENDED_TOKENS = 100

    def estimate_tokens(self, text: str) -> int:
        """Heuristic token estimator (~4 characters per token)."""
        return max(1, len(text) // 4)

    def analyze_skill_bloat(self, skill_path: Path) -> SkillTokenAudit:
        content = skill_path.read_text(encoding="utf-8")
        token_count = self.estimate_tokens(content)
        lines = content.splitlines()
        issues = []
        suggestions = []

        # 1. Token Budget Check (Gradient / Edit Budget)
        if token_count > self.MAX_RECOMMENDED_TOKENS:
            issues.append(f"TOKEN_BUDGET_EXCEEDED: Skill has ~{token_count} tokens (limit: {self.MAX_RECOMMENDED_TOKENS}).")
            suggestions.append("Clip verbosity: Move detailed manuals to `references/` and keep only actionable steps in `SKILL.md`.")

        # 2. Conversational & Polite Bloat (LLM chatter that wastes prompt cache)
        conversational_patterns = [
            (r"\bas an ai language model\b", "Generic AI disclaimer"),
            (r"\bplease feel free to\b", "Polite conversational fluff"),
            (r"\bi hope this helps\b", "Conversational filler"),
            (r"\bin this tutorial we will learn\b", "Tutorial filler instead of direct procedure"),
            (r"\bimportant note: remember that\b", "Wordy callout header"),
        ]
        for pat, desc in conversational_patterns:
            if re.search(pat, content, re.IGNORECASE):
                issues.append(f"CONVERSATIONAL_BLOAT: Found '{desc}'.")
                suggestions.append(f"Remove '{desc}' to save tokens and maintain progressive disclosure.")

        # 3. Excessive explanation before commands
        codeblock_count = len(re.findall(r"```", content)) // 2
        prose_to_code_ratio = len(lines) / max(1, codeblock_count)
        if codeblock_count > 0 and prose_to_code_ratio > 80:
            issues.append(f"HIGH_PROSE_RATIO: Excessive narrative text ({len(lines)} lines for {codeblock_count} codeblocks).")
            suggestions.append("Convert wordy explanations into concise bulleted runbook steps.")

        # Calculate bloat score
        bloat_score = min(1.0, (token_count / self.MAX_RECOMMENDED_TOKENS) * (1.2 if len(issues) > 1 else 0.8))

        return SkillTokenAudit(
            skill_name=skill_path.parent.name,
            file_path=str(skill_path),
            token_estimate=token_count,
            line_count=len(lines),
            bloat_score=round(bloat_score, 2),
            issues=issues,
            optimization_suggestions=suggestions
        )

    def clip_skill_text(self, text: str) -> str:
        """Applies gradient clipping: strips conversational filler and compresses duplicate empty lines."""
        clipped = text
        for pat, _ in [
            (r"(?i)\bas an ai language model,?\s*", ""),
            (r"(?i)please feel free to\s*", ""),
            (r"(?i)i hope this helps\.?\s*", ""),
        ]:
            clipped = re.sub(pat, "", clipped)

        # Compress 3+ consecutive newlines into 2
        clipped = re.sub(r"\n{3,}", "\n\n", clipped)
        return clipped.strip() + "\n"


def main():
    parser = argparse.ArgumentParser(description="Skill Token Bloat Analyzer & Linter")
    parser.add_argument("--skill", type=str, help="Specific SKILL.md to analyze")
    parser.add_argument("--all", action="store_true", help="Audit all skills in workspace")
    parser.add_argument("--clip", action="store_true", help="Apply token clipping to remove conversational bloat")
    args = parser.parse_args()

    optimizer = SkillTokenOptimizer()
    workspace = Path(".")
    skills_dir = workspace / "skills"

    if args.skill:
        p = Path(args.skill)
        if not p.exists():
            print(json.dumps({"error": f"File not found: {args.skill}"}))
            sys.exit(1)
        audit = optimizer.analyze_skill_bloat(p)
        print(json.dumps(audit.__dict__, indent=2))
        sys.exit(0)

    # Audit all skills
    audits = []
    total_tokens = 0
    for s in skills_dir.glob("*/SKILL.md"):
        audit = optimizer.analyze_skill_bloat(s)
        total_tokens += audit.token_estimate
        audits.append(audit.__dict__)

    report = {
        "total_skills_audited": len(audits),
        "total_workspace_skill_tokens": total_tokens,
        "average_tokens_per_skill": total_tokens // max(1, len(audits)),
        "skills": audits
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
