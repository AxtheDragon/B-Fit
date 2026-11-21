# Notes for Claude

## Open issues: fix them when you touch the code

Known bugs and small jobs live in GitHub Issues, not in code comments. Each
issue has an "Affected code" section that names the files and functions.

Before you change a file, list the open issues and check which ones name that
file (for example `js/record.js` or `sw.js`). For each one that still applies
to the code you are changing, fix it in the same pull request and close it
with `Fixes #n` in the PR description. If one no longer applies, say so in the
PR so it can be closed. Mention any you leave open.

When you find a new problem that is not fixed right away, open an issue in the
same format (Problem, Reproduced, Affected code, Fix idea) with labels for
type (`bug` / `enhancement`), priority (`priority: low|medium`) and area
(`area: ...`).
