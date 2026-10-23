# Vim motions: w/b/e (word motions, table-crossing + CJK)
- Fixture for vimWordMotions.e2e.ts. Every table here keeps a blank line
  before it — Obsidian's Live Preview table widget doesn't render without
  one (confirmed live while building vimJkGgGjGk.e2e.ts; see that spec's
  own note in tests/E2E.md for the full story).
- Scenario 1: `w`/`b`/`e` within a cell's own `<br>`-separated sub-lines,
  crossing to the adjacent cell, crossing to the next row, and exiting the
  table entirely from its last cell.
- Scenario 2: CJK dictionary-based word segmentation inside a cell.

---
#### Scenario 1
intro text here

| alpha<br>bravo gamma | delta |
| --- | --- |
| echo | foxtrot |

outro text here

#### Scenario 2

| 日本語の文章です | b |
| --- | --- |
| 中文的句子也是 | d |
