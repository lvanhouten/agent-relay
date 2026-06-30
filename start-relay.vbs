' Launch the agent-relay server hidden (no console window).
' Finds server/index.js relative to this script; relies on `node` being on PATH.
' The server lazy-starts the board (PTY kernel) on first request.
Dim fso, here, entry, sh
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
entry = fso.BuildPath(here, "server\index.js")
Set sh = CreateObject("WScript.Shell")
sh.Run "node """ & entry & """", 0, False   ' 0 = hidden window, False = don't wait
