# Multi-cell case conversion (multicellCaseConversion.e2e.ts)
- Four separate tables, one per scenario -- each test mutates its own
  table's content on disk, so scenarios must never share cells (same
  convention as UppercaseWordMultiCursor.md's own separate line ranges per
  scenario).
- Scenario 1: a 2-row x 3-col drag, not including the header. a11 has a
  real `<br>`-separated sub-line ("mid<br>dle").
- Scenario 2: a drag that DOES include the header row.
- Scenario 3: a plain click (no drag) -- existing single-cell fallback.
- Scenario 4: a real Shift+ArrowUp escape (not a mouse drag) out of a
  `<br>`-containing cell, up into the header -- regression coverage for a
  real bug found from actual use.

---
#### Scenario 1

| h00 | h01 | h02 |
| --- | --- | --- |
| a10 | mid<br>dle | a12 |
| a20 | a21 | a22 |

#### Scenario 2

| b00 | b01 | b02 |
| --- | --- | --- |
| b10 | b11 | b12 |
| b20 | b21 | b22 |

#### Scenario 3

| g00 | g01 | g02 |
| --- | --- | --- |
| g10 | g11 | g12 |
| g20 | g21 | g22 |

#### Scenario 4

| d00 |
| --- |
| ABC<br>123<br>XYZ |
