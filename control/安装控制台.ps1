# 安装「大肥鱼控制台」：生成隐藏启动器 + 桌面快捷方式。
# 用法：右键 → 使用 PowerShell 运行；或在项目目录执行：
#   powershell -ExecutionPolicy Bypass -File control\安装控制台.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$control = $PSScriptRoot
$vbsPath = Join-Path $control '打开控制台.vbs'
$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop '大肥鱼控制台.lnk'

# ---------- 找 node.exe ----------
$node = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd -and $cmd.Source) { $node = $cmd.Source }
if (-not $node) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Author Software\nvm\.nodejs\node.exe'),
    'C:\Program Files\nodejs\node.exe'
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { $node = $candidate; break }
  }
}
if (-not $node -or -not (Test-Path $node)) {
  throw '找不到 node.exe，请先安装 Node.js 20+，然后重新运行本脚本。'
}
$node = (Resolve-Path $node).Path

# ---------- 生成隐藏启动器（VBS） ----------
$vbsTemplate = @'
Option Explicit
Dim fso, shell, here, root, i, req, cmd, nodeExe
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
root = fso.GetParentFolderName(here)

nodeExe = "__NODE_EXE__"
If Not fso.FileExists(nodeExe) Then nodeExe = "node"

Function ServerUp()
  Dim http
  ServerUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.Open "GET", "http://127.0.0.1:8899/api/status", False
  http.Send
  If Err.Number = 0 Then
    If http.Status = 200 Then ServerUp = True
  End If
  Err.Clear
  On Error GoTo 0
End Function

If Not ServerUp() Then
  shell.CurrentDirectory = root
  If nodeExe = "node" Then
    cmd = "node " & Chr(34) & here & "\server.mjs" & Chr(34)
  Else
    cmd = Chr(34) & nodeExe & Chr(34) & " " & Chr(34) & here & "\server.mjs" & Chr(34)
  End If
  On Error Resume Next
  shell.Run cmd, 0, False
  Err.Clear
  On Error GoTo 0
  For i = 1 To 40
    WScript.Sleep 250
    If ServerUp() Then Exit For
  Next
End If

If ServerUp() Then
  shell.Run "http://127.0.0.1:8899/", 1, False
Else
  MsgBox "控制台启动失败。" & vbCrLf & vbCrLf & _
    "请双击 control\启动控制台.bat 查看具体报错。" & vbCrLf & _
    "项目目录：" & root, 48, "蓝色大肥鱼"
End If
'@
$vbs = $vbsTemplate.Replace('__NODE_EXE__', $node)
[System.IO.File]::WriteAllText($vbsPath, $vbs, [System.Text.Encoding]::Unicode)

# ---------- 桌面快捷方式 ----------
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$shortcut.Arguments = '"' + $vbsPath + '"'
$shortcut.WorkingDirectory = $root
$shortcut.Description = '蓝色大肥鱼控制台：静默启动 / 停止 QQ 群 bot'
$shortcut.IconLocation = if (Test-Path 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe') {
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe,0'
} elseif (Test-Path 'C:\Program Files\Google\Chrome\Application\chrome.exe') {
  'C:\Program Files\Google\Chrome\Application\chrome.exe,0'
} else {
  "$env:SystemRoot\System32\SHELL32.dll,13"
}
$shortcut.Save()

Write-Host ('node.exe：' + $node)
Write-Host ('隐藏启动器：' + $vbsPath)
Write-Host ('桌面快捷方式：' + $lnkPath)
Write-Host '安装完成。双击桌面上的「大肥鱼控制台」即可打开控制面板。'
