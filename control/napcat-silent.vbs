' Hidden-console launcher for NapCat (called by control/server.mjs).
' Runs napcat-silent.bat with SW_HIDE so QQ inherits a hidden console instead of
' allocating its own visible black console window.
' Args: [QQ number] [qr]
Option Explicit
Dim fso, sh, here, qq, mode, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
qq = ""
mode = ""
If WScript.Arguments.Count > 0 Then qq = WScript.Arguments(0)
If WScript.Arguments.Count > 1 Then mode = WScript.Arguments(1)
cmd = "cmd /c " & Chr(34) & Chr(34) & here & "\napcat-silent.bat" & Chr(34) & " " & qq & " " & mode & Chr(34)
sh.Run cmd, 0, False
