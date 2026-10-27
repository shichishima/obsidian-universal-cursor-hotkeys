# Vim motions: j/k, gj/gk, gg/G, $ sticky (table-crossing)
- Fixture for vimJkGgGjGk.e2e.ts. Real Obsidian + codemirror-vim, not a mock — the point of this suite is covering what the existing unit tests (vimMoveByLinesInCell.test.ts etc.) can't: real table-widget rendering, real visual sub-lines, real goal-column pixel math.
- Scenario 1: `j`/`k` crossing from outer text into/through/out of a table, preserving column.
- Scenario 2: `gj`/`gk` inside a cell's own real `<br>`-separated sub-lines.
- Scenario 3: `gg`/`G` reaching the real document start/end.
- Scenario 4: `$` sticky goal column surviving a `j` into a table, landing in the rightmost cell.

---
#### Scenario 1
alpha bravo charlie

| short | y |
| --- | --- |
| one | two |

delta echo foxtrot

#### Scenario 2

| long | b |
| --- | --- |
| alpha<br>bravo charlie<br>delta echo | y |

#### Scenario 3
line one
line two
line three

#### Scenario 4
short

| aa | bb | cc |
| --- | --- | --- |
| 1 | 2 | 3 |
