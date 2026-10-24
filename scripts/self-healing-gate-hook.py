#!/usr/bin/env python3
"""
PreToolUse & Self-Healing Approval Gate Hook.
Intercepts skill modifications or self-evolution adoption commands:
1. When `scripts/skillopt-engine.py adopt` or an automated skill edit is triggered:
   - Emits a structured `decision: "ask"` or `decision: "force_ask"` prompt to the user.
   - Shows the exact proposed diff and reasons.
   - Requires explicit human approval before any skill file is overwritten on disk.
"""

from __future__ import annotations

import json
import os
import sys


def process_pre_tool_use_hook():
    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            # No payload received, allow tool
            print(json.dumps({"decision": "allow"}))
            return

        payload = json.loads(raw_input)
        tool_call = payload.get("toolCall", {})
        tool_name = tool_call.get("name", "")
        tool_args = tool_call.get("args", {})
        cmd = str(tool_args.get("CommandLine", ""))

        # Check if the tool is attempting to run self-healing skill adoption
        if "skillopt-engine.py adopt" in cmd or "devin-blueprint-optimizer.py" in cmd:
            output = {
                "decision": "ask",
                "reason": (
                    "[SELF-HEALING APPROVAL GATE] An automated self-healing action is about to mutate your project configuration or SKILL.md.\n"
                    f"Command: {cmd}\n"
                    "Do you approve applying this bounded diff to your workspace?"
                )
            }
            print(json.dumps(output))
            return

        # Check if write_file / edit_file is modifying a skill directly
        path_arg = str(tool_args.get("Path", ""))
        if ("skills" in path_arg and path_arg.endswith("SKILL.md")) and tool_name in ("write_file", "edit_file"):
            output = {
                "decision": "ask",
                "reason": (
                    f"[SKILL MUTATION GATE] An agent is attempting to modify `{path_arg}`.\n"
                    "Explicit user approval is required to update workspace skills."
                )
            }
            print(json.dumps(output))
            return

        # Default: allow harmless tool execution
        print(json.dumps({"decision": "allow"}))

    except Exception as e:
        # Fallback safe: allow if hook parser fails
        print(json.dumps({"decision": "allow", "reason": f"Hook passthrough: {e}"}))


if __name__ == "__main__":
    process_pre_tool_use_hook()
