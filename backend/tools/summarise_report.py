"""Summarise a pytest JUnit XML report: totals and the names of failures.

Kept as a script because the console output of a long run is awkward to read on
a Windows terminal, and parsing the XML is exact where eyeballing a log is not.
"""

from __future__ import annotations

import sys
import xml.etree.ElementTree as ET


def main(path: str = "report.xml") -> int:
    root = ET.parse(path).getroot()
    suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))

    total = failures = errors = skipped = 0
    for suite in suites:
        total += int(suite.get("tests", 0))
        failures += int(suite.get("failures", 0))
        errors += int(suite.get("errors", 0))
        skipped += int(suite.get("skipped", 0))

    print(
        f"tests={total} passed={total - failures - errors - skipped} "
        f"failures={failures} errors={errors} skipped={skipped}"
    )

    for suite in suites:
        for case in suite.iter("testcase"):
            failed = case.find("failure")
            problem = failed if failed is not None else case.find("error")
            if problem is None:
                continue
            name = f"{case.get('classname', '')}::{case.get('name')}"
            message = (problem.get("message") or "").splitlines()
            print(f"FAIL {name}")
            if message:
                print(f"     {message[0][:200]}")

    return 1 if failures or errors else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else "report.xml"))
