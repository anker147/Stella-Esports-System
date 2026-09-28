# 生产启动与守护脚本：崩溃自动重启，日志按启动会话分文件
# 用法：powershell -ExecutionPolicy Bypass -File start-production.ps1
# 常驻建议：任务计划程序开机触发本脚本，或用 NSSM 把本脚本注册为 Windows 服务
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

while ($true) {
  # 轮转清理：删除 14 天前的会话日志，防止崩溃重启循环下日志无限增长
  Get-ChildItem -Path $logDir -Filter 'server-*.log' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
    Remove-Item -Force -ErrorAction SilentlyContinue
  $stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
  $out = Join-Path $logDir "server-$stamp.out.log"
  $err = Join-Path $logDir "server-$stamp.err.log"
  Write-Host "[$stamp] starting node server/server.js, log: $out" -ForegroundColor Green
  Push-Location $root
  & node server\server.js *>> $out 2>> $err
  $code = $LASTEXITCODE
  Pop-Location
  Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] service exited with code $code, restarting in 5 seconds" -ForegroundColor Yellow
  Start-Sleep -Seconds 5
}
