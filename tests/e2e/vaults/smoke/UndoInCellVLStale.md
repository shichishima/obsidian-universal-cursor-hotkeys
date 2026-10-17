# Undo-in-cell VL staleness regression
- Minimal table for a real bug repro: col3 row1 is one hard line, long enough to word-wrap into multiple visual lines (no `<br>`). Row2's own cells are empty, to detect an incorrect exit into them.

---

| a | b | long |
| --- | --- | --- |
| x | y | alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey |
| z |  |  |
