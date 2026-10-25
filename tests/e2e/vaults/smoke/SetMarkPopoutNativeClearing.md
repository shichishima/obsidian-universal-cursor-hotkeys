# Set-mark native clearing in a popout window
- Same markActive-clearing listeners as SetMarkNativeClipboardAndDelete.md/SetMarkEscapeKeydown.e2e.ts, but dispatched inside a real popout window ("Open in new window") instead of the main window — regression coverage for a confirmed real bug: these listeners were registered once against the main window's own document at plugin load time, never for a later-opened popout's own document. One line per case, destructive ones (cut/paste/Backspace/Delete) each on their own line so an earlier test's edit can't affect a later one.

---
alpha bravo charlie delta echo
foxtrot golf hotel india juliett
kilo lima mike november oscar
papa quebec romeo sierra tango
uniform victor whiskey xray yankee
quebec romeo sierra tango uniform
