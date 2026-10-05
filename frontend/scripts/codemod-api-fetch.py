"""Rewrite authenticated `fetch(url, { headers: buildApiHeaders(...) })` calls
into `apiFetch(url, { ... contentType ... })`.

Twenty call sites in two files all had to change in exactly the same way, and a
hand edit that misses one leaves a request with no refresh path: a bug that is
invisible until an hour after sign-in, and only in that one screen. A codemod
either converts all of them or fails loudly, which is the property worth having.

Run:  python scripts/codemod-api-fetch.py [--check]

`--check` reports what would change and exits non-zero if anything would, so it
can gate a commit.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

FRONTEND = pathlib.Path(__file__).resolve().parent.parent
TARGETS = [FRONTEND / "src" / "lib" / "tasks.ts", FRONTEND / "src" / "lib" / "push.ts"]

# `apiFetch` itself calls fetch with buildApiHeaders. It is the replacement, so
# converting it would rewrite the retry into a call that retries forever.
SKIP_MARKER = "export async function apiFetch"

FETCH_RE = re.compile(r"\bfetch\(")
BUILD_HEADERS_RE = re.compile(r"buildApiHeaders\(\s*(?:\"([^\"]*)\"|'([^']*)'|\)\s*)?")
# The two shapes `buildApiHeaders` appears in at call sites: a line of its own
# ending in a comma, and inline in a one-line options object with no trailing
# comma. Missing the second form is what made the first attempt fail loudly on
# `fetch(url, { headers: buildApiHeaders() })`.
#
# `\r?\n` rather than `\n`, because this file is checked out with CRLF on
# Windows. With a bare `\n` the line regex silently matched nothing, the inline
# regex then ate the newline plus the next line's indentation, and the rewrite
# came out with `body:` hanging at column 14.
HEADERS_LINE_RE = re.compile(r"^[ \t]*headers:[ \t]*buildApiHeaders\((?:\"([^\"]*)\"|'([^']*)')?\),[ \t]*\r?\n", re.MULTILINE)
# Deliberately does not consume trailing whitespace, so removing an inline
# header cannot swallow the line break that follows it.
HEADERS_INLINE_RE = re.compile(r"headers:[ \t]*buildApiHeaders\((?:\"([^\"]*)\"|'([^']*)')?\),?")


def find_matching(text: str, open_index: int, opener: str, closer: str) -> int:
    depth = 0
    in_string: str | None = None
    i = open_index
    while i < len(text):
        ch = text[i]
        if in_string is not None:
            if ch == "\\":
                i += 2
                continue
            if text.startswith(in_string, i):
                i += len(in_string)
                in_string = None
                continue
            if ch in "\"'`":
                # A different quote inside a template literal is just a character.
                i += 1
                continue
            i += 1
            continue
        if text.startswith('"""', i):
            in_string = '"""'
            i += 3
            continue
        if ch in "\"'`":
            in_string = ch * 3 if text.startswith(ch * 3, i) else ch
            i += len(in_string)
            continue
        if ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError(f"unbalanced {opener!r} starting at {open_index}")


def split_args(inner: str) -> list[str]:
    """Split a call's argument text on top-level commas."""
    args: list[str] = []
    depth = 0
    current: list[str] = []
    in_string: str | None = None
    i = 0
    while i < len(inner):
        ch = inner[i]
        if in_string is not None:
            current.append(ch)
            if ch == "\\" and i + 1 < len(inner):
                current.append(inner[i + 1])
                i += 2
                continue
            if ch == in_string:
                in_string = None
            i += 1
            continue
        if ch in "\"'`":
            in_string = ch
            current.append(ch)
            i += 1
            continue
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "," and depth == 0:
            args.append("".join(current))
            current = []
            i += 1
            continue
        current.append(ch)
        i += 1
    tail = "".join(current)
    if tail.strip():
        args.append(tail)
    return args


def convert(source: str, path_label: str = "<source>") -> tuple[str, int]:
    """Returns the rewritten source and the number of call sites changed.

    Walks forward through a single pass rather than looping to a fixed point.
    The loop version had to mark skipped calls with a sentinel, and the natural
    sentinel does not work: `\\b` still matches before `fetch` when the preceding
    character is non-word, so the same call was found again forever and the
    script hung. Advancing the cursor is the straightforward version.
    """
    changed = 0
    out: list[str] = []
    cursor = 0

    # Skip the body of apiFetch itself. The region ends at the next top-level
    # `export`/`function` declaration, because apiFetch is the last export in
    # the file and scanning to the end would swallow every call site after it.
    skip_from = source.find(SKIP_MARKER)
    skip_to = len(source)
    if skip_from >= 0:
        nxt = re.search(r"^export ", source[skip_from + 1 :], re.MULTILINE)
        if nxt is not None:
            skip_to = skip_from + 1 + nxt.start()

    for match in FETCH_RE.finditer(source):
        if match.start() < cursor:
            continue
        if skip_from >= 0 and skip_from <= match.start() < skip_to:
            continue

        open_paren = match.end() - 1
        try:
            close_paren = find_matching(source, open_paren, "(", ")")
        except ValueError:
            continue

        inner = source[open_paren + 1 : close_paren]
        args = split_args(inner)

        if len(args) < 2 or "buildApiHeaders" not in args[1]:
            # Not an authenticated call. Left exactly as it is.
            continue

        url_arg = args[0].strip()
        options = args[1].strip()
        if options.startswith("{"):
            options = options[1:]
        if options.endswith("}"):
            options = options[:-1]
        if options.endswith(","):
            options = options[:-1]

        content_type: str | None = None
        headers_match = BUILD_HEADERS_RE.search(options)
        if headers_match is not None:
            content_type = headers_match.group(1) or headers_match.group(2) or None

        # Line form first, so an own-line header is removed together with its
        # newline. Then inline, for the one-line options objects. Order matters:
        # the inline pattern alone leaves a blank line behind.
        stripped = HEADERS_INLINE_RE.sub("", HEADERS_LINE_RE.sub("", options))
        # Any remaining reference to buildApiHeaders means the shape was not one
        # this codemod understands. Bail out loudly rather than emit a call that
        # dropped its auth header.
        if "buildApiHeaders" in stripped:
            raise SystemExit(
                f"UNHANDLED buildApiHeaders shape in {path_label}:\n{stripped.strip()[:200]}"
            )

        # Indent relative to the START OF THE LINE, not to the position of
        # `fetch`. A call is usually preceded by `const x = await `, so using
        # the match column emitted bodies indented to column 20 and made the
        # whole file unreadable.
        line_start = source.rfind("\n", 0, match.start()) + 1
        line_prefix = source[line_start : match.start()]
        pad = line_prefix[: len(line_prefix) - len(line_prefix.lstrip())]

        lines = stripped.splitlines()
        while lines and not lines[0].strip():
            lines.pop(0)
        while lines and not lines[-1].strip():
            lines.pop()

        common = min((len(line) - len(line.lstrip()) for line in lines if line.strip()), default=0)
        kept = [line[common:] if line.strip() else "" for line in lines]
        if content_type:
            kept.append(f'contentType: "{content_type}",')

        if kept:
            inner = "\n".join(f"{pad}    {line}" for line in kept)
            call = f"apiFetch(\n{pad}  {url_arg},\n{pad}  {{\n{inner}\n{pad}  }},\n{pad})"
        else:
            call = f"apiFetch({url_arg})"

        out.append(source[cursor : match.start()])
        out.append(call)
        cursor = close_paren + 1
        changed += 1

    out.append(source[cursor:])
    return "".join(out), changed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="report only, do not write")
    args = parser.parse_args()

    total = 0
    for path in TARGETS:
        source = path.read_text(encoding="utf-8")
        rewritten, changed = convert(source, str(path.relative_to(FRONTEND.parent)))
        total += changed
        rel = path.relative_to(FRONTEND.parent)
        print(f"  {rel}: {changed} call site(s)")
        if changed and not args.check:
            path.write_text(rewritten, encoding="utf-8")

    print(f"{'Would convert' if args.check else 'Converted'} {total} call site(s).")
    return 1 if (args.check and total) else 0


if __name__ == "__main__":
    sys.exit(main())
