# Tests

No dependencies and no framework. From the project root:

```
node tests/run-tests.mjs         # domain unit tests
node tests/regression-export.mjs # full parse → export, byte-compared
```

`run-tests.mjs` covers `domain.mjs` directly. Most cases are regressions: each
one stands for a bug that reached a real meet or a real Athletic.net upload
(bib badges parsed into athlete names, a blank `[Place]` column, a DQ exported
as a bare time, a DNF dropped for having no time, adult divisions relabelled
Girls/Boys). They are worded so a failure says what the meet-day consequence
was, not just which assertion broke.

`regression-export.mjs` parses the sample RUNMEET file, simulates a full meet,
rebuilds the Athletic.net CSV, and compares it byte for byte against a file
that Athletic.net accepted. It needs two things present:

- `/mnt/user-data/uploads/RUNMEET__TEST_Sample_Meet.html` (the sample export)
- `/mnt/user-data/outputs/TEST_Sample_Meet_results_v2.csv` (the accepted file)

Keep a copy of both alongside the project and update the paths at the top of
the file if you move them. When an export change is intended, re-run it, check
the reported difference is exactly what you meant to change, and replace the
expected file.

`resultRowsForState` is still defined in `index.html` because it reads app
state; the harness lifts it out by name. Moving it into `domain.mjs` would let
the harness drop that step entirely.
