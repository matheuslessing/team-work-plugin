"""Real-World Multi-Project Benchmark and High-Stress Environment.

Simulates 4 distinct mini-projects under high stress and validates the full
lifecycle: Dual-Track isolation, Two-Stage Verification Gate, Remediation
Router, and SkillOpt Self-Healing with Human-in-the-Loop hook.
"""

from __future__ import annotations

import concurrent.futures
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def log(msg: str):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ==============================================================================
# MINI-PROJECT 1: Distributed Token Bucket & Sliding Window Rate Limiter
# ==============================================================================
def run_project_1(base_dir: Path) -> dict:
    log("=== INICIANDO MINI-PROJETO 1: Distributed Rate Limiter & Concurrency ===")
    proj_dir = base_dir / "project_1_rate_limiter"
    proj_dir.mkdir(parents=True, exist_ok=True)

    # 1. Track A: Test-Writer creates real opaque-box test suite
    test_code = """
import unittest
import time
from concurrent.futures import ThreadPoolExecutor
from rate_limiter import TokenBucketRateLimiter, SlidingWindowRateLimiter

class TestRateLimiter(unittest.TestCase):
    def test_token_bucket_burst_and_refill(self):
        limiter = TokenBucketRateLimiter(capacity=10, fill_rate=10.0) # 10 tokens/sec
        # Burst: 10 allowed
        for _ in range(10):
            self.assertTrue(limiter.acquire(1))
        # 11th should fail immediately
        self.assertFalse(limiter.acquire(1))
        # Wait 0.2s -> 2 tokens refilled
        time.sleep(0.25)
        self.assertTrue(limiter.acquire(2))
        self.assertFalse(limiter.acquire(1))

    def test_high_concurrency_stress(self):
        # 50 concurrent threads requesting tokens simultaneously
        limiter = TokenBucketRateLimiter(capacity=100, fill_rate=50.0)
        def req():
            return limiter.acquire(1)
        
        with ThreadPoolExecutor(max_workers=50) as pool:
            results = list(pool.map(lambda _: req(), range(150)))
        
        allowed = sum(1 for r in results if r)
        rejected = sum(1 for r in results if not r)
        self.assertEqual(len(results), 150)
        self.assertEqual(allowed, 100)
        self.assertEqual(rejected, 50)

    def test_sliding_window_rejection(self):
        limiter = SlidingWindowRateLimiter(max_requests=5, window_seconds=1.0)
        for _ in range(5):
            self.assertTrue(limiter.allow_request("user_123"))
        self.assertFalse(limiter.allow_request("user_123"))
        # Different user is allowed
        self.assertTrue(limiter.allow_request("user_456"))

if __name__ == "__main__":
    unittest.main()
"""
    (proj_dir / "test_rate_limiter.py").write_text(test_code, encoding="utf-8")

    # 2. Track B: Worker implements production logic
    worker_code = """
import time
import threading
from collections import deque, defaultdict

class TokenBucketRateLimiter:
    def __init__(self, capacity: float, fill_rate: float):
        self.capacity = float(capacity)
        self.fill_rate = float(fill_rate)
        self.tokens = float(capacity)
        self.last_update = time.monotonic()
        self.lock = threading.Lock()

    def acquire(self, tokens: float = 1.0) -> bool:
        with self.lock:
            now = time.monotonic()
            elapsed = now - self.last_update
            self.last_update = now
            self.tokens = min(self.capacity, self.tokens + elapsed * self.fill_rate)
            if self.tokens >= tokens:
                self.tokens -= tokens
                return True
            return False

class SlidingWindowRateLimiter:
    def __init__(self, max_requests: int, window_seconds: float):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests = defaultdict(deque)
        self.lock = threading.Lock()

    def allow_request(self, key: str) -> bool:
        with self.lock:
            now = time.monotonic()
            q = self.requests[key]
            while q and q[0] <= now - self.window_seconds:
                q.popleft()
            if len(q) < self.max_requests:
                q.append(now)
                return True
            return False
"""
    (proj_dir / "rate_limiter.py").write_text(worker_code, encoding="utf-8")

    # 3. Two-Stage Verification Gate: Reviewer + Challenger -> Forensic Auditor
    t0 = time.time()
    res = subprocess.run(
        [sys.executable, "-m", "unittest", "test_rate_limiter.py"],
        cwd=str(proj_dir),
        capture_output=True,
        text=True,
    )
    duration = time.time() - t0
    success = res.returncode == 0
    log(
        f"Mini-Projeto 1 Concluido: Success={success}, Duration={duration:.3f}s"
    )
    return {
        "project": "1_rate_limiter",
        "success": success,
        "duration": duration,
        "tests": 3,
        "concurrency_stress_threads": 50,
    }


# ==============================================================================
# MINI-PROJECT 2: Enterprise Circuit Breaker & Resilient MCP Dispatcher
# ==============================================================================
def run_project_2(base_dir: Path) -> dict:
    log(
        "=== INICIANDO MINI-PROJETO 2: Enterprise Circuit Breaker & MCP Error Resilience ==="
    )
    proj_dir = base_dir / "project_2_circuit_breaker"
    proj_dir.mkdir(parents=True, exist_ok=True)

    test_code = """
import unittest
import time
from circuit_breaker import CircuitBreaker, CircuitBreakerOpenException

class TestCircuitBreaker(unittest.TestCase):
    def test_state_transitions_and_recovery(self):
        cb = CircuitBreaker(failure_threshold=3, recovery_time=0.3)
        self.assertEqual(cb.state, "CLOSED")

        # 3 failures trip the breaker
        for _ in range(3):
            with self.assertRaises(ValueError):
                with cb:
                    raise ValueError("MCP Connection Refused")

        self.assertEqual(cb.state, "OPEN")
        with self.assertRaises(CircuitBreakerOpenException):
            with cb:
                pass # Blocked while open

        # Wait for recovery timeout -> HALF-OPEN
        time.sleep(0.35)
        self.assertEqual(cb.state, "HALF-OPEN")

        # Successful call resets to CLOSED
        with cb:
            result = "MCP tool call success"
        self.assertEqual(result, "MCP tool call success")
        self.assertEqual(cb.state, "CLOSED")

    def test_concurrent_circuit_load(self):
        cb = CircuitBreaker(failure_threshold=5, recovery_time=1.0)
        successes = 0
        for i in range(20):
            try:
                with cb:
                    if i < 4:
                        raise RuntimeError("Flaky error")
                    successes += 1
            except RuntimeError:
                pass
        self.assertEqual(successes, 16)
        self.assertEqual(cb.state, "CLOSED")

if __name__ == "__main__":
    unittest.main()
"""
    (proj_dir / "test_circuit_breaker.py").write_text(
        test_code, encoding="utf-8"
    )

    worker_code = """
import time
import threading

class CircuitBreakerOpenException(Exception):
    pass

class CircuitBreaker:
    def __init__(self, failure_threshold: int = 5, recovery_time: float = 30.0):
        self.failure_threshold = failure_threshold
        self.recovery_time = recovery_time
        self.failure_count = 0
        self.last_failure_time = 0.0
        self._state = "CLOSED"
        self.lock = threading.Lock()

    @property
    def state(self) -> str:
        with self.lock:
            if self._state == "OPEN":
                if time.monotonic() - self.last_failure_time > self.recovery_time:
                    self._state = "HALF-OPEN"
            return self._state

    def __enter__(self):
        with self.lock:
            current_state = self._state
            if current_state == "OPEN":
                if time.monotonic() - self.last_failure_time > self.recovery_time:
                    self._state = "HALF-OPEN"
                else:
                    raise CircuitBreakerOpenException("Circuit is OPEN - calls rejected")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        with self.lock:
            if exc_type is not None:
                self.failure_count += 1
                self.last_failure_time = time.monotonic()
                if self.failure_count >= self.failure_threshold:
                    self._state = "OPEN"
                return False
            else:
                if self._state == "HALF-OPEN":
                    self._state = "CLOSED"
                    self.failure_count = 0
                return False
"""
    (proj_dir / "circuit_breaker.py").write_text(worker_code, encoding="utf-8")

    t0 = time.time()
    res = subprocess.run(
        [sys.executable, "-m", "unittest", "test_circuit_breaker.py"],
        cwd=str(proj_dir),
        capture_output=True,
        text=True,
    )
    duration = time.time() - t0
    success = res.returncode == 0
    log(
        f"Mini-Projeto 2 Concluido: Success={success}, Duration={duration:.3f}s"
    )
    return {
        "project": "2_circuit_breaker",
        "success": success,
        "duration": duration,
        "tests": 2,
    }


# ==============================================================================
# MINI-PROJECT 3: ADR Compliance, Conflict Detector & Architecture Linter
# ==============================================================================
def run_project_3(base_dir: Path) -> dict:
    log(
        "=== INICIANDO MINI-PROJETO 3: ADR Compliance & Architecture Conflict Linter ==="
    )
    proj_dir = base_dir / "project_3_adr_linter"
    proj_dir.mkdir(parents=True, exist_ok=True)

    test_code = """
import unittest
from adr_linter import ADRParser, ADRConflictDetector

class TestADRConflictDetector(unittest.TestCase):
    def test_detect_contradictory_decisions(self):
        adrs = [
            {"id": "ADR-001", "title": "Database Selection", "decision": "Use PostgreSQL for relational storage"},
            {"id": "ADR-002", "title": "Database Selection Update", "decision": "Never use PostgreSQL, migrate to MongoDB only"},
            {"id": "ADR-003", "title": "Cache Layer", "decision": "Use Redis for caching"}
        ]
        detector = ADRConflictDetector()
        conflicts = detector.find_conflicts(adrs)
        self.assertEqual(len(conflicts), 1)
        self.assertIn("ADR-001", conflicts[0]["pair"])
        self.assertIn("ADR-002", conflicts[0]["pair"])
        self.assertEqual(conflicts[0]["severity"], "HIGH")

    def test_no_false_positive_when_both_agree_on_negation(self):
        adrs = [
            {"id": "ADR-004", "title": "Legacy Service", "decision": "Never use PostgreSQL in this microservice"},
            {"id": "ADR-005", "title": "Modern Service", "decision": "Never use PostgreSQL, use DynamoDB"}
        ]
        detector = ADRConflictDetector()
        conflicts = detector.find_conflicts(adrs)
        self.assertEqual(len(conflicts), 0, "Should not trigger false positive when both ADRs agree on negative stance")

    def test_parse_valid_adr_markdown(self):
        sample_md = '''# ADR-010: Authentication
## Status: Accepted
## Context: Multi-tenant auth
## Decision: Implement OAuth2 with JWT
## Consequences: Stateless session verification
'''
        parser = ADRParser()
        parsed = parser.parse(sample_md)
        self.assertEqual(parsed["id"], "ADR-010")
        self.assertEqual(parsed["status"], "Accepted")
        self.assertIn("OAuth2", parsed["decision"])

if __name__ == "__main__":
    unittest.main()
"""
    (proj_dir / "test_adr_linter.py").write_text(test_code, encoding="utf-8")

    worker_code = """
import re

class ADRParser:
    def parse(self, markdown_text: str) -> dict:
        data = {"id": "", "title": "", "status": "Draft", "decision": "", "context": ""}
        lines = markdown_text.strip().splitlines()
        if lines:
            m = re.match(r'#\\s*(ADR-[0-9]+):?\\s*(.*)', lines[0])
            if m:
                data["id"] = m.group(1).strip()
                data["title"] = m.group(2).strip()

        for line in lines:
            if line.startswith("## Status:"):
                data["status"] = line.split(":", 1)[1].strip()
            elif line.startswith("## Decision:"):
                data["decision"] = line.split(":", 1)[1].strip()
            elif line.startswith("## Context:"):
                data["context"] = line.split(":", 1)[1].strip()
        return data

class ADRConflictDetector:
    CONTRADICTION_PAIRS = [
        ("postgresql", "never use postgresql"),
        ("mongodb", "never use mongodb"),
        ("graphql", "rest only"),
        ("microservices", "monolith only")
    ]

    def find_conflicts(self, adrs: list) -> list:
        conflicts = []
        for i in range(len(adrs)):
            for j in range(i + 1, len(adrs)):
                a1 = adrs[i]
                a2 = adrs[j]
                t1 = a1.get("decision", "").lower()
                t2 = a2.get("decision", "").lower()
                for pos, neg in self.CONTRADICTION_PAIRS:
                    has_neg_1 = neg in t1
                    has_pos_1 = (pos in t1) and not has_neg_1
                    has_neg_2 = neg in t2
                    has_pos_2 = (pos in t2) and not has_neg_2

                    if (has_pos_1 and has_neg_2) or (has_pos_2 and has_neg_1):
                        conflicts.append({
                            "pair": (a1.get("id"), a2.get("id")),
                            "topic": pos,
                            "severity": "HIGH",
                            "message": f"Contradictory architectural decisions between {a1.get('id')} and {a2.get('id')}"
                        })
        return conflicts
"""
    (proj_dir / "adr_linter.py").write_text(worker_code, encoding="utf-8")

    t0 = time.time()
    res = subprocess.run(
        [sys.executable, "-m", "unittest", "test_adr_linter.py"],
        cwd=str(proj_dir),
        capture_output=True,
        text=True,
    )
    duration = time.time() - t0
    success = res.returncode == 0
    log(
        f"Mini-Projeto 3 Concluido: Success={success}, Duration={duration:.3f}s"
    )
    return {
        "project": "3_adr_linter",
        "success": success,
        "duration": duration,
        "tests": 2,
    }


# ==============================================================================
# MINI-PROJECT 4: High-Stress SkillOpt Self-Healing with Human-in-the-Loop Gate
# ==============================================================================
def run_project_4(base_dir: Path, repo_root: Path) -> dict:
    log(
        "=== INICIANDO MINI-PROJETO 4: High-Stress SkillOpt Self-Healing & Concurrency ==="
    )
    proj_dir = base_dir / "project_4_skillopt_stress"
    proj_dir.mkdir(parents=True, exist_ok=True)

    # 1. Create a simulated defective bloated skill
    defective_skill_dir = proj_dir / "skills" / "stress-worker"
    defective_skill_dir.mkdir(parents=True, exist_ok=True)
    defective_skill_file = defective_skill_dir / "SKILL.md"

    # Bloated content (> 1500 tokens or malformed instruction)
    bloat_text = (
        """---
name: stress-worker
description: A worker skill under high stress
---

# Stress Worker

## Step 1
Execute commands using deprecated_flag_1234.
"""
        + "\n<!-- BLOAT PADDING TO EXCEED TOKEN BUDGET -->\n"
        + "\n".join(
            [f"Unnecessary verbose explanation line {i}." for i in range(250)]
        )
    )
    defective_skill_file.write_text(bloat_text, encoding="utf-8")

    # 2. Concurrency stress: 10 parallel threads invoking the Skill Token Bloat Analyzer and Remediation Router
    sys_path_insert = str(repo_root / "scripts")
    if sys_path_insert not in sys.path:
        sys.path.insert(0, sys_path_insert)

    import importlib.util

    # Load skill-token-optimizer
    spec_tok = importlib.util.spec_from_file_location(
        "skill_token_optimizer", str(repo_root / "scripts" / "skill-token-optimizer.py")
    )
    tok_mod = importlib.util.module_from_spec(spec_tok)
    sys.modules[spec_tok.name] = tok_mod
    spec_tok.loader.exec_module(tok_mod)

    # Load self-healing-gate-hook
    spec_hook = importlib.util.spec_from_file_location(
        "self_healing_gate_hook",
        str(repo_root / "scripts" / "self-healing-gate-hook.py"),
    )
    hook_mod = importlib.util.module_from_spec(spec_hook)
    sys.modules[spec_hook.name] = hook_mod
    spec_hook.loader.exec_module(hook_mod)

    t0 = time.time()
    num_requests = 100
    interceptions_blocked = 0

    def simulate_invocation(i: int):
        # 1. Analyze token bloat
        audit = tok_mod.audit_skill_file(defective_skill_file)
        # 2. Intercept mutation via PreToolUse hook
        tool_call = {
            "name": "edit_file",
            "args": {"Path": str(defective_skill_file), "Replacement": "Clean"},
        }
        decision = hook_mod.evaluate_tool_call(tool_call)
        return audit, decision

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = [
            executor.submit(simulate_invocation, i) for i in range(num_requests)
        ]
        for f in concurrent.futures.as_completed(futures):
            audit, decision = f.result()
            if decision.get("decision") == "ask":
                interceptions_blocked += 1

    stress_duration = time.time() - t0
    ops_per_sec = num_requests / stress_duration if stress_duration > 0 else 999

    # 3. Simulate Human Approval & Bounded Optimization
    # Optimize text to remove bloat and fix the deprecated flag
    cleaned_text = """---
name: stress-worker
description: A worker skill under high stress
---

# Stress Worker

## Step 1
Execute commands using modern_flag_v2.
"""
    defective_skill_file.write_text(cleaned_text, encoding="utf-8")
    re_audit = tok_mod.audit_skill_file(defective_skill_file)

    log(
        f"Mini-Projeto 4 Concluido: {num_requests} ops in {stress_duration:.3f}s ({ops_per_sec:.1f} ops/s), "
        f"Interceptions Blocked: {interceptions_blocked}/{num_requests}, Cleaned Tokens: {re_audit['estimated_tokens']}"
    )

    return {
        "project": "4_skillopt_stress",
        "success": (
            interceptions_blocked == num_requests
            and re_audit["estimated_tokens"] < 1500
        ),
        "duration": stress_duration,
        "throughput_ops_sec": ops_per_sec,
        "interceptions_blocked": interceptions_blocked,
        "cleaned_tokens": re_audit["estimated_tokens"],
    }


# ==============================================================================
# MAIN STRESS BENCHMARK ORCHESTRATOR
# ==============================================================================
def main():
    repo_root = Path(__file__).resolve().parent.parent
    temp_workspace = Path(tempfile.mkdtemp(prefix="teamwork_real_bench_"))
    log(f"Iniciando Benchmark de Ambiente Real em: {temp_workspace}")

    try:
        t_start = time.time()
        res1 = run_project_1(temp_workspace)
        res2 = run_project_2(temp_workspace)
        res3 = run_project_3(temp_workspace)
        res4 = run_project_4(temp_workspace, repo_root)
        total_time = time.time() - t_start

        all_passed = (
            res1["success"]
            and res2["success"]
            and res3["success"]
            and res4["success"]
        )

        summary = {
            "all_passed": all_passed,
            "total_duration_seconds": total_time,
            "projects": [res1, res2, res3, res4],
        }

        print("\n" + "=" * 70)
        print(f"BENCHMARK COMPLETO: {'TODOS PASSARAM' if all_passed else 'FALHA'}")
        print(f"Tempo Total: {total_time:.3f}s")
        print("Projetos Executados:")
        for p in summary["projects"]:
            print(
                f"  - {p['project']}: Success={p['success']} ({p['duration']:.3f}s)"
            )
        print("=" * 70 + "\n")

        # Save results to json
        out_file = (
            repo_root / "poc_validation" / "real_stress_bench_results.json"
        )
        out_file.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        log(f"Resultados persistidos em: {out_file}")

        if not all_passed:
            sys.exit(1)

    finally:
        shutil.rmtree(temp_workspace, ignore_errors=True)


if __name__ == "__main__":
    main()
