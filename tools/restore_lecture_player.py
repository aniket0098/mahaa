"""Restore LecturePlayer.tsx from its backup, repairing mojibake encoding.

The .bak was written by re-encoding UTF-8 bytes as CP1252, so em-dashes etc.
appear as mojibake sequences (e.g. 'â€”' for '-'). Round-trip the whole text
through cp1252 -> utf-8, falling back to targeted replacements for any
characters that Python's cp1252 codec cannot encode.
"""
import sys

SRC = r"C:\mahaa\src\features\learn\LecturePlayer.tsx.bak"
DST = r"C:\mahaa\src\features\learn\LecturePlayer.tsx"

with open(SRC, "r", encoding="utf-8-sig") as f:
    text = f.read()

# Inventory of non-ascii chars BEFORE the fix.
before = sorted({c for c in text if ord(c) > 127})
print("before:", ["U+%04X %r" % (ord(c), c) for c in before])

try:
    text = text.encode("cp1252").decode("utf-8")
except (UnicodeEncodeError, UnicodeDecodeError) as e:
    print("full roundtrip failed (%s); applying targeted fixes" % e)
    # Common mojibake sequences produced by cp1252-decoding UTF-8 bytes.
    fixes = {
        "\u00e2\u20ac\u2014": "\u2014",  # em dash
        "\u00e2\u20ac\u2026": "\u2026",  # ellipsis
        "\u00e2\u20ac\u009c": "\u201c",  # left double quote
        "\u00e2\u20ac\u009d": "\u201d",  # right double quote
        "\u00e2\u20ac\u0098": "\u2018",  # left single quote
        "\u00e2\u20ac\u0099": "\u2019",  # right single quote
    }
    for bad, good in fixes.items():
        text = text.replace(bad, good)

after = sorted({c for c in text if ord(c) > 127})
print("after:", ["U+%04X %r" % (ord(c), c) for c in after])

# Strip any leading BOM character.
if text.startswith("\ufeff"):
    text = text.lstrip("\ufeff")

with open(DST, "w", encoding="utf-8", newline="") as f:
    f.write(text)

print("wrote", DST, "chars:", len(text), "lines:", text.count("\n") + 1)
sys.exit(0)
