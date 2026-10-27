# Uppercase/Lowercase/Capitalize word — multi-cursor and selection mode
1. Mixed mode: a range with a real selection and a range with a plain cursor both transform in the same command.
2. Primary's own selection crossing a Source Mode table's cell boundary no longer blocks a valid secondary range.
3. Inside one table cell, multiple ranges each transform their own selection independently.

---
#### 1. Mixed mode
foo bar
baz qux

#### 2. Primary invalid, secondary runs
| cell1 | cell2 |
foo bar

#### 3. Multiple selections in one cell

| foo bar | x |
| --- | --- |
| c | d |
