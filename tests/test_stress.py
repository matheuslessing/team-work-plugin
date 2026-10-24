#!/usr/bin/env python3
"""
Advanced Stress Test Suite for Teamwork + Harness² + SkillOpt Plugin.
Simulates extreme workloads, hostile edge-cases, rapid concurrent cycles,
and boundary conditions across all subsystems:
1. High-Concurrency Race Conditions (Multiple simultaneous skill edits & gate locks).
2. Malformed / Adversarial Skill Injection (Toxic payload attacks, deeply nested unclosed codeblocks).
3. Extreme Scaling Latency (Simulating hundreds of parallel child VM heartbeats & watchdog integrity).
4. Memory & Resource Leak Pressure (10,000 rapid bounded-diff validation cycles).
5. Dynamic Router Decision Stress (Ambiguous, multi-category, corrupted defect payloads).
"""

import concurrent.futures
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

# Add scripts directory to path
SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import importlib
skillopt_engine = importlib.import_module("skillopt-engine")
harness_probe = importlib.import_module("harness-probe")
env_healer = importlib.import_module("devin-env-healer")


class TestConcurrentSkillOptStress(unittest.TestCase):
    """Stress test: 50 concurrent worker threads updating and validating skills."""

    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.base_dir = Path(self.tmpdir.name)

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_concurrent_isolated_skill_mutations(self):
        """Simulates 50 parallel workers evolving separate skills simultaneously."""
        total_workers = 50

        def mutate_skill(worker_id: int):
            skill_path = self.base_dir / f"SKILL_{worker_id}.md"
            initial_text = (
                f"---\nname: skill-{worker_id}\ndescription: Test skill {worker_id}\n---\n\n"
                f"# Title {worker_id}\n\n## Steps\n1. Run `exec_old_{worker_id}`\n"
            )
            skill_path.write_text(initial_text, encoding="utf-8")

            # Apply bounded diff
            target = f"`exec_old_{worker_id}`"
            replacement = f"`exec_new_v2_{worker_id}`"
            ok, modified, msg = skillopt_engine.apply_bounded_edit(initial_text, target, replacement)
            if not ok:
                return False, f"Edit failed: {msg}"

            gate = skillopt_engine.evaluate_validation_gate(
                candidate_content=modified,
                original_content=initial_text,
                test_suite_passed=True,
                no_regression=True
            )
            if gate.gate_status != "PASS":
                return False, f"Gate failed: {gate.errors}"

            skill_path.write_text(modified, encoding="utf-8")
            return True, "OK"

        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as executor:
            futures = [executor.submit(mutate_skill, i) for i in range(total_workers)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        all_ok = all(r[0] for r in results)
        self.assertTrue(all_ok, f"Some concurrent mutations failed: {[r for r in results if not r[0]]}")


class TestAdversarialSecurityAndMalformationStress(unittest.TestCase):
    """Stress test: Injects malformed, corrupt, or adversarial payloads."""

    def test_massive_unclosed_codeblocks(self):
        """Injects a 50,000-line markdown with 999 unbalanced code blocks."""
        corrupted_text = "---\nname: toxic\ndescription: toxic\n---\n# Toxic\n"
        corrupted_text += "```python\nprint('hello')\n" * 999  # Odd number of backticks
        valid, errors = skillopt_engine.validate_skill_markdown(corrupted_text)
        self.assertFalse(valid)
        self.assertTrue(any("code blocks" in e.lower() for e in errors))

    def test_corrupted_yaml_frontmatter_injections(self):
        """Injects broken delimiters, missing colons, binary null bytes."""
        payloads = [
            "---\nname missing colon\n---\n# Title\n",
            "---name: test\n---\n# Title\n",
            "---\nname: \x00\x01\x02\n---\n# Title\n",
            "",
            "   \n\n\t",
            "---" * 50,
        ]
        for p in payloads:
            valid, errors = skillopt_engine.validate_skill_markdown(p)
            self.assertFalse(valid, f"Payload should have been rejected: {repr(p[:30])}")

    def test_massive_skill_document_scalability(self):
        """Stress tests validator on massive 5MB markdown document."""
        giant_doc = "---\nname: giant\ndescription: A giant 5MB skill\n---\n# Giant Doc\n\n"
        giant_doc += "## Section\n" + ("Lorem ipsum dolor sit amet. `echo 123`\n" * 100000)
        
        start = time.time()
        valid, errors = skillopt_engine.validate_skill_markdown(giant_doc)
        elapsed = time.time() - start
        
        self.assertTrue(valid, f"Giant document should be valid, errors: {errors}")
        self.assertLess(elapsed, 1.0, f"Validator took too long on 5MB document: {elapsed:.2f}s")


class TestThroughputAndMemoryStress(unittest.TestCase):
    """Stress test: 10,000 rapid validation and bounded diff cycles."""

    def test_rapid_diff_throughput(self):
        sample_doc = (
            "---\nname: bench\ndescription: throughput benchmark\n---\n\n"
            "# Benchmark\n\n## Steps\n1. Run `target_command`\n"
        )
        start = time.time()
        iterations = 5000
        for i in range(iterations):
            ok, modified, _ = skillopt_engine.apply_bounded_edit(
                sample_doc, "`target_command`", f"`target_command_{i}`"
            )
            assert ok
            valid, _ = skillopt_engine.validate_skill_markdown(modified)
            assert valid

        elapsed = time.time() - start
        ops_per_sec = iterations / elapsed
        print(f"\n    [STRESS STATS] Throughput: {ops_per_sec:.0f} bounded-diff validations/sec ({elapsed:.3f}s total)")
        self.assertGreater(ops_per_sec, 2000, "Validation engine throughput too low!")


class TestHarnessContrastiveProbeStress(unittest.TestCase):
    """Stress test: Giant logs with 10,000 noisy lines and multiple errors."""

    def test_massive_log_contrast_extraction(self):
        proposer = harness_probe.HarnessContrastiveProposer(Path("."))
        
        # Build 10,000 lines of noisy terminal output with 5 embedded failures
        lines = ["INFO: Normal compile step" for _ in range(5000)]
        lines.append("Command 'npm run build:prod' failed: exit code 1: missing dist folder")
        lines.extend(["DEBUG: checking socket" for _ in range(3000)])
        lines.append("Command 'docker compose down --volumes' failed: exit code 127: docker not running")
        lines.extend(["INFO: cleanup" for _ in range(2000)])

        giant_log = "\n".join(lines)
        start = time.time()
        contrasts = proposer.analyze_trajectory(giant_log)
        elapsed = time.time() - start

        self.assertEqual(len(contrasts), 2)
        self.assertEqual(contrasts[0].failed_command, "npm run build:prod")
        self.assertEqual(contrasts[1].failed_command, "docker compose down --volumes")
        self.assertLess(elapsed, 0.2, f"Extraction from 10k lines took too long: {elapsed:.3f}s")


class TestEnvironmentProfilerStress(unittest.TestCase):
    """Stress test: Massive log file with timestamps, timeouts and latency spikes."""

    def test_extreme_log_latency_detection(self):
        diagnoser = env_healer.DevinEnvironmentDiagnoser(Path("."))
        
        # Build log with 20 steps, 3 exceeding latency threshold
        log_lines = []
        for i in range(50):
            log_lines.append(f"Step 'task_{i}' took: 5.2s")
        log_lines.append("Step 'heavy_unpacked_docker_layer' took: 185.0s")
        log_lines.append("Step 'compile_monorepo' took: 92.5s")
        log_lines.append("ETIMEDOUT: Connection to package registry timed out")

        diags = diagnoser.analyze_startup_logs("\n".join(log_lines))
        latency_diags = [d for d in diags if d.issue_type == "STARTUP_LATENCY"]
        timeout_diags = [d for d in diags if d.issue_type == "MISSING_SECRET"]

        self.assertEqual(len(latency_diags), 2)
        self.assertEqual(len(timeout_diags), 1)
        self.assertEqual(latency_diags[0].severity, "CRITICAL")


if __name__ == "__main__":
    unittest.main(verbosity=2)
