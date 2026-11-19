# cursor-up/down/left/right clear an active multi-cell selection (multicellSelectionArrowClear.e2e.ts)
- Dedicated fixture, not shared with MulticellCaseConversion.md: that
  fixture's own Scenario 1 table gets permanently uppercased on disk by
  multicellCaseConversion.e2e.ts's own test (1) earlier in the same full
  suite run, so re-opening it here and searching for the original
  lowercase cell text ("a10") fails once that spec has already run.
- This spec never mutates cell text at all (every command here is a pure
  cursor move), so its own table stays untouched across repeated opens
  within this spec, but still needs to be its own file to avoid the
  cross-spec pollution above.

---

| p00 | p01 | p02 |
| --- | --- | --- |
| p10 | p11 | p12 |
| p20 | p21 | p22 |
