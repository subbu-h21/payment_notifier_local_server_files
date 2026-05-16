Dim scriptDir, WshShell
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c """ & scriptDir & "start.bat""", 0, False
