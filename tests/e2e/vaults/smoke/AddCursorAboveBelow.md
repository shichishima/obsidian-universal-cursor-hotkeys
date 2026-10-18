# Add cursor above/below
- Scenario 4's own boundary check only tests the END direction, at the
  buffer's own real last line — this file (like every fixture) carries a
  heading + description block above its own --- separator, so "the first
  line after ---" is never genuinely the whole document's own first line.
- Scenario 1: outer column clamp + stacking in both directions, through lines of varying length.
- Scenario 2: inner (table cell) above/below across the cell's own wrapped sub-lines, boundary no-op, stacking.
- Scenario 3: Set-mark interaction — a newly added cursor joins mark-extension on the next Ctrl-N/P.
- Scenario 4: outer buffer end boundary (no-op once already there).

---
#### 1. Outer: column clamp + stacking (both directions)
this is a somewhat long line of text here
short
another longer line of text here too
tiny
yet another fairly long line indeed right

#### 2. Inner: table cell sub-line above/below + stacking + boundary

| long | b |
| --- | --- |
| alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november oscar | y |

#### 3. Set-mark interaction
line one here
line two here
line three here
line four here
line five here

#### 4. Outer: buffer end boundary
last line of this document