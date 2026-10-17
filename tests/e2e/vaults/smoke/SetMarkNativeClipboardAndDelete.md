# Set-mark native clipboard/delete triggers
- Native cut/copy/paste/Backspace/Delete all clear markActive as a side effect, same as this plugin's own Kill region/Copy region/Yank/Delete char commands, even though none of these are this plugin's own commands. One line per case, destructive ones (cut/paste/Backspace/Delete) each on their own line so an earlier test's edit can't affect a later one.

---
alpha bravo charlie delta echo
foxtrot golf hotel india juliett
kilo lima mike november oscar
papa quebec romeo sierra tango
uniform victor whiskey xray yankee
