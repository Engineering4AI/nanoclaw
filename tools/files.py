from __future__ import annotations

from pathlib import Path

from . import Tool


async def _read_file(args: dict) -> str:
    path = Path(args["path"]).expanduser()
    start = args.get("start_line", 1)
    end = args.get("end_line")
    lines = path.read_text(errors="replace").splitlines()
    chunk = lines[start - 1: end] if end else lines[start - 1:]
    return "\n".join(f"{i+start}\t{l}" for i, l in enumerate(chunk))


async def _write_file(args: dict) -> str:
    path = Path(args["path"]).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(args["content"])
    return f"Written {len(args['content'])} chars to {path}"


async def _edit_file(args: dict) -> str:
    path = Path(args["path"]).expanduser()
    text = path.read_text()
    old = args["old_str"]
    new = args["new_str"]
    if old not in text:
        raise ValueError(f"old_str not found in {path}")
    count = text.count(old)
    if count > 1 and not args.get("replace_all", False):
        raise ValueError(f"old_str matches {count} times; set replace_all=true or make it unique")
    updated = text.replace(old, new) if args.get("replace_all") else text.replace(old, new, 1)
    path.write_text(updated)
    return f"Edited {path}"


READ_FILE = Tool(
    name="read_file",
    description="Read file content. Optionally specify start_line / end_line (1-indexed).",
    input_schema={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Absolute or ~ path to file"},
            "start_line": {"type": "integer", "description": "First line to read (default 1)"},
            "end_line": {"type": "integer", "description": "Last line to read (inclusive, default EOF)"},
        },
        "required": ["path"],
    },
    execute=_read_file,
)

WRITE_FILE = Tool(
    name="write_file",
    description="Write or overwrite a file with given content.",
    input_schema={
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "content": {"type": "string"},
        },
        "required": ["path", "content"],
    },
    execute=_write_file,
)

EDIT_FILE = Tool(
    name="edit_file",
    description="Patch a file by replacing old_str with new_str. Fails if old_str not found or matches multiple times unless replace_all=true.",
    input_schema={
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "old_str": {"type": "string"},
            "new_str": {"type": "string"},
            "replace_all": {"type": "boolean", "description": "Replace all occurrences (default false)"},
        },
        "required": ["path", "old_str", "new_str"],
    },
    execute=_edit_file,
)

FILE_TOOLS = [READ_FILE, WRITE_FILE, EDIT_FILE]
