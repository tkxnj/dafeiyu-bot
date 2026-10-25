# Stop NapCat/headless QQ started by this project.
# One snapshot of the process table -> descendants of NapCatWinBootMain.exe -> kill.
# Then clean orphaned QQ.exe (parent gone). A personal QQ has a live parent (explorer),
# so it is left alone.
$ErrorActionPreference = 'SilentlyContinue'

$snapshot = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name)

$roots = @($snapshot | Where-Object { $_.Name -eq 'NapCatWinBootMain.exe' } | Select-Object -ExpandProperty ProcessId)
if ($roots.Count -eq 0) {
    Write-Host '[stop] NapCat is not running.'
} else {
    $targets = New-Object System.Collections.Generic.HashSet[int]
    $frontier = @($roots)
    while ($frontier.Count -gt 0) {
        foreach ($p in $frontier) { if ($p) { [void]$targets.Add($p) } }
        $next = @()
        foreach ($p in $frontier) {
            $next += @($snapshot | Where-Object { $_.ParentProcessId -eq $p } | Select-Object -ExpandProperty ProcessId)
        }
        $frontier = @($next | Where-Object { -not $targets.Contains($_) })
    }
    $list = @($targets)
    [array]::Reverse($list)
    foreach ($id in $list) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
    Write-Host ("[stop] NapCat stopped ({0} processes)." -f $list.Count)
}

Start-Sleep -Seconds 2
$alive = @(Get-Process | Select-Object -ExpandProperty Id)
$orphans = @(Get-CimInstance Win32_Process -Filter "Name='QQ.exe'" | Where-Object { $alive -notcontains $_.ParentProcessId })
foreach ($proc in $orphans) {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}
if ($orphans.Count -gt 0) {
    Write-Host ("[stop] cleaned {0} orphan QQ process(es)." -f $orphans.Count)
}

Write-Host '[stop] done.'
