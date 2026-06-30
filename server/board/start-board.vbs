' Launch the switchboard board hidden (no console window).
' Finds board.js next to this script; relies on `node` being on PATH.
' Safe to run repeatedly — the board exits if one is already online.
Dim fso, here, board, sh
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
board = fso.BuildPath(here, "board.js")
Set sh = CreateObject("WScript.Shell")
sh.Run "node """ & board & """", 0, False   ' 0 = hidden window, False = don't wait
