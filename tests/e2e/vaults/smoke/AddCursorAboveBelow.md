# Add cursor above/below
- This exercises LOGICAL-line + character-column stepping (addCursorOnView's
  own design), not visual/pixel-based — confirmed live that native
  Obsidian's own equivalent steps by logical line + character column too
  (jumping straight to the next real line, skipping every remaining visual
  sub-line of a word-wrapped current one), just with a genuine off-by-one
  bug in its own line-index arithmetic.
- Scenario 4's own boundary check only tests the END direction, at the
  buffer's own real last line — this file (like every fixture) carries a
  heading + description block above its own --- separator, so "the first
  line after ---" is never genuinely the whole document's own first line.
- Scenario 1: outer character-column clamp + stacking in both directions (no "remembered" original column across a clamp — by design).
- Scenario 2: inner (table cell) above/below across the cell's own real `<br>`-separated sub-lines, boundary no-op, stacking.
- Scenario 3: Set-mark interaction — a newly added cursor joins mark-extension on the next Ctrl-N/P.
- Scenario 4: outer buffer end boundary (no-op once already there).

---
#### 1. Outer: column clamp + stacking (both directions)
this is a somewhat long line of text here
short
another longer line of text here too
tiny
yet another fairly long line indeed right

#### 2. Inner: table cell real sub-lines (<br>) above/below + stacking + boundary

| long | b |
| --- | --- |
| alpha<br>bravo charlie<br>delta echo foxtrot | y |

#### 3. Set-mark interaction
line one here
line two here
line three here
line four here
line five here

#### 4. Outer: buffer end boundary
last line of this document