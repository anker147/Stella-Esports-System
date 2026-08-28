# ZFB Web HUB

本地 OBS Web HUB 控制台。

## 启动

```bat
start.bat
```

项目已经内置 Windows x64 Node.js 运行时，目标电脑不需要安装 Node.js、npm，也不需要配置环境变量。复制项目时必须保留：

```text
runtime/node.exe
```

开发环境也可以使用：

```bash
npm start
```

默认地址：

```text
http://localhost:3788/control.html
```

透明倒计时使用固定 HUB 链接：

```text
http://localhost:3788/hub/countdown
```

把该链接添加到 OBS 的浏览器源即可。

## 当前功能

- 指定目标时间倒计时
- 指定分钟/秒倒计时
- Overlay 透明背景
- 倒计时始终按四位数字 `MM:SS` 输出，最大显示为 `99:59`
- BO3、A/B 房 BP 流程与两位阶段计时
- BP 自动保存、版本历史、重赛和正赛重置
- OBS WebSocket 串行推送、连接记忆与比分同步
- 赛果图片接收窗口和系统日志页

## 数据文件

- `data/bp-config.json`：角色、阶段、槽位、OBS 源名和 UI 分组
- `public/assets/data/tournament-2026-07-25-mobile.json`：赛事、队伍和选手映射
- `data/bp-state.json`：BP 会话、赛果和版本历史
- `data/runtime-config.json`：本机 OBS WebSocket 连接配置
- `data/update-log.json`：系统版本号与面向用户的更新日志

## 版本记录规范

- 每次功能更新或问题修复都必须在 `data/update-log.json` 增加版本记录。
- 使用语义化版本号，并同步更新 `currentVersion`。
- 最新版本必须位于 `releases` 第一项，且版本号与 `currentVersion` 一致。
