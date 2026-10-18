# Kill/Yank multi-cursor round-trip
1. Kill region (outer) with two selections, then Yank at two other positions — each gets its own piece back.
2. Kill line (outer) from two positions, then Yank at two other positions.
3. Inside one table cell, Kill word at two positions, then Yank at the same two (shifted) positions — reconstructs the original cell text exactly.
4. Yank: clipboard line count doesn't match cursor count — duplicates the whole text at every cursor.
5. Outer multi-cursor Kill region, then multi-cursor Yank inside a table cell — the kill-cache/clipboard bridges across the outer/inner boundary.

---
#### 1. Kill region round-trip
foo bar
baz qux
AAA BBB
CCC DDD

#### 2. Kill line round-trip
line one
line two
target one
target two

#### 3. Cell word round-trip

| foo bar | x |
| --- | --- |
| c | d |

#### 4. Yank count mismatch
AAA
BBB

#### 5. Outer kill -> inner yank
ONE two
THREE four

| ab cd | x |
| --- | --- |
| e | f |
