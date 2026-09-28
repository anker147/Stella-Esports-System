# 生产部署指南

目标环境：Windows Server 或常开 Windows 工作站，2 核 2GB 起，10Mbps 带宽可流畅承载（实测全量接口 gzip 后单次主控台加载约 75KB）。

## 1. 进程守护（二选一）

### 方案 A：任务计划程序加 start-production.ps1（推荐，零依赖）

1. 计划任务触发器：开机时，延迟 1 分钟。
2. 操作：`powershell.exe -ExecutionPolicy Bypass -File "E:\Code\Web\Zfb\start-production.ps1"`，起始于项目根目录。
3. 脚本自带崩溃 5 秒重启循环与按启动会话分文件的日志（logs/server-时间戳.log）。
4. 日志轮转：可另建每日 04:00 计划任务删除 logs/ 下 14 天前的文件。

### 方案 B：NSSM 注册 Windows 服务

```powershell
nssm install ZfbHub "C:\Program Files\nodejs\node.exe" "server\server.js"
nssm set ZfbHub AppDirectory E:\Code\Web\Zfb
nssm set ZfbHub AppStdout E:\Code\Web\Zfb\logs\out.log
nssm set ZfbHub AppStderr E:\Code\Web\Zfb\logs\err.log
nssm set ZfbHub AppRotateFiles 1
nssm start ZfbHub
```

## 2. 环境变量

- `PORT`：监听端口（默认 3788）。
- `STELLA_DB_PATH`：数据库路径（默认 data/app.db，一般不改）。
- 控制令牌：/api/system/shutdown 需要 `x-stella-token` 请求头匹配 CONTROL_TOKEN，不配置则该端点恒 403（生产建议不配置）。

## 3. TLS 反向代理（公网必做，局域网可选）

应用监听 127.0.0.1，不直接对外。公网访问统一走反向代理终结 HTTPS：

### nginx

```nginx
server {
  listen 443 ssl;
  http2 on;
  server_name zfb.example.com;
  location / {
    proxy_pass http://127.0.0.1:3788;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Host $host;
    proxy_buffering off;          # SSE 必需
    proxy_read_timeout 1h;        # SSE 长连接
  }
}
```

`http2 on;`（nginx 1.25.1+；旧版本写 `listen 443 ssl http2;`）必须开启：HTTP/1.1 下浏览器对同一域名只开 6 条并发连接，头像等图片会把页面数据请求挤到超时；HTTP/2 多路复用后数据请求不再排队。

### Caddy（自动证书）

```
zfb.example.com {
  reverse_proxy 127.0.0.1:3788
}
```

反代后应用的 `shouldTrustProxy` 会读取 `X-Forwarded-Proto`，会话 Cookie 自动加 Secure 标记。注意：`/hub/:id`、`/overlay.html`、`/bp-overlay.html` 与 `/api/bp/presentation/events`、`/api/hubs/:id/events` 需允许未登录访问（OBS 源依赖，属设计使然）。

## 4. 备份策略

每日计划任务执行（示例保存 14 天）：

```powershell
$root = 'E:\Code\Web\Zfb'
$stamp = Get-Date -Format 'yyyy-MM-dd'
$dir = Join-Path $root 'data\backups'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
node -e "require('node:fs'); const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.env.STELLA_DB_PATH || '$root\data\app.db'); db.exec(`VACUUM INTO '$dir\app-daily-$stamp.db'`); db.close();" 2>$null
Get-ChildItem $dir -Filter 'app-daily-*.db' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item
```

## 5. 防火墙

- 仅需放行反代端口（80/443）；应用端口 3788 保持仅 127.0.0.1 监听，不要对外。
- 局域网直连（无反代）场景：放行 3788 入站，但应用仅绑 127.0.0.1，需把 server.js 监听地址改为 0.0.0.0 后自行评估暴露面（不建议，公网必走反代）。

## 6. 更新流程

1. 任务计划程序停止守护任务（或 `nssm stop ZfbHub`）。
2. 替换代码（git pull 或拷贝）。
3. 启动一次观察 logs 无迁移报错（启动即自动跑 schema 迁移，迁移前自动有备份习惯见上）。
4. 重新启动守护任务。

## 7. 健康检查

- `GET /api/system/health`：返回版本与状态，反代健康检查用。
- 日志关键字：`未捕获的请求异常`（请求级兜底）、`uncaughtException 守卫捕获`（末级守卫）、`SQLITE_BUSY`（数据库竞争）。
