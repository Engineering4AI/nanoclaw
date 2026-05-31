from __future__ import annotations

import fnmatch
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path


class PermissionMode(Enum):
    DEFAULT = "default"  # prompt before writes + shell
    AUTO = "auto"        # allow everything (CI / sandboxed)
    PLAN = "plan"        # block all writes — read-only


class PermissionDenied(Exception):
    pass


class PermissionRequired(Exception):
    """Raised in DEFAULT mode — caller handles the prompt."""
    def __init__(self, tool: str, args: dict):
        self.tool = tool
        self.args = args
        super().__init__(f"Permission required for {tool}")


@dataclass
class PathRule:
    pattern: str
    allow: bool


_SENSITIVE_PATHS = [
    "~/.ssh/*",
    "~/.aws/*",
    "~/.config/*/credentials",
    "~/.gnupg/*",
    "~/.netrc",
]

_WRITE_TOOLS = {"write_file", "edit_file"}
_EXEC_TOOLS = {"run_bash"}


@dataclass
class PermissionPolicy:
    mode: PermissionMode = PermissionMode.DEFAULT
    path_rules: list[PathRule] = field(default_factory=list)
    denied_commands: list[str] = field(default_factory=list)

    @classmethod
    def from_mode(cls, mode: str) -> "PermissionPolicy":
        return cls(mode=PermissionMode(mode))

    def check(self, tool: str, args: dict) -> None:
        """Raise PermissionDenied or PermissionRequired as appropriate."""
        if self.mode == PermissionMode.PLAN and tool in _WRITE_TOOLS | _EXEC_TOOLS:
            raise PermissionDenied(f"{tool} blocked in PLAN mode")

        # Sensitive path guard — applies in all modes
        path = args.get("path") or args.get("file_path") or ""
        if path:
            self._check_path(path)

        # Check custom path rules
        for rule in self.path_rules:
            expanded = str(Path(rule.pattern).expanduser())
            if fnmatch.fnmatch(path, expanded):
                if not rule.allow:
                    raise PermissionDenied(f"Path blocked by rule: {rule.pattern}")
                break  # explicit allow stops further checks

        # Denied commands prefix check
        if tool == "run_bash":
            cmd = args.get("command", "")
            for denied in self.denied_commands:
                if cmd.startswith(denied):
                    raise PermissionDenied(f"Command blocked: starts with '{denied}'")

        # DEFAULT mode: write/shell requires caller approval
        if self.mode == PermissionMode.DEFAULT:
            if tool in _WRITE_TOOLS | _EXEC_TOOLS:
                raise PermissionRequired(tool, args)

    def _check_path(self, path: str) -> None:
        for pattern in _SENSITIVE_PATHS:
            expanded = str(Path(pattern).expanduser())
            if fnmatch.fnmatch(path, expanded):
                raise PermissionDenied(f"Access to sensitive path blocked: {path}")
