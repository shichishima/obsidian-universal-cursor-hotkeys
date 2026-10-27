# Multi-cursor crossing a table boundary (DOWN)
- A secondary cursor alone crossing into the table is dropped; the primary continues normally in plain text.
- If the primary itself crosses into the table, the whole selection collapses to it.

---
foo

| a | b |
| --- | --- |
| c | d |

bar
baz
qux
