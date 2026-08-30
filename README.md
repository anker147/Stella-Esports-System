# 星澜赛事导播系统

面向电竞赛事直播现场的本地导播控制系统。通过浏览器控制台管理 BP、倒计时、赛果、晋级榜、赛事素材与 OBS Studio，同时提供动态 BP Overlay 和固定倒计时 Browser Source。

当前版本：**2.2.0**

## 主要功能

- 七阶段 Ban/Pick 流程、阶段计时、自动存档、重赛与历史恢复
- BO3 比分、弃赛、赛果图与赛事阶段调度
- OBS WebSocket 场景、文本源、图片源和浏览器源同步
- 动态 BP Overlay，旧 OBS BP 链路可作为实时降级保障
- 固定链接的透明倒计时 HUB，支持目标时间与指定时长
- 本地素材中心：文件夹同步、搜索、预览、批量操作与路径迁移
- 今日对战图、赛程表图、赛果图和晋级榜推送
- 登录验证、会话鉴权与操作员/开发者权限边界
- SQLite 本地数据层，运行数据不进入 Git 仓库

## 环境要求

- Windows 10/11 x64
- Node.js 22 或更高版本
- OBS Studio（需要启用 OBS WebSocket，默认端口 `4455`）

仓库包含 `runtime/node.exe`，因此也可以不安装全局 Node.js，直接使用内置运行时。

## 启动

使用内置运行时：

```bat
start.bat
```

或使用本机 Node.js：

```bash
npm start
```

启动后访问：

```text
http://localhost:3788/
```

系统只监听本机回环地址 `127.0.0.1`，不会直接暴露到局域网。

## 首次登录

首次打开系统时，需要先在开发者页设置一个至少 10 个字符的密码。初始化完成后会创建两个本机账号：

| 身份 | 账号 | 密码 |
| --- | --- | --- |
| 开发者 | `administrator` | 首次设置的密码 |
| 操作员 | `operator` | 首次设置的密码 |

- 开发者可执行素材导入/删除、OBS 连接、路径同步和系统配置等高风险操作。
- 操作员用于日常导播工作。
- 勾选“记住登录”后会话可保留 7 天；未勾选时仅在当前浏览器会话内有效。
- 密码使用 `scrypt` 加盐哈希保存在本机 SQLite 数据库中。

## OBS 浏览器源

这些输出页不要求登录，确保 OBS Browser Source 能正常加载：

```text
http://localhost:3788/hub/countdown
http://localhost:3788/bp-overlay
```

控制台、设计面板和 API 均受登录态鉴权保护。

## 数据与目录

运行时数据库：

```text
data/app.db
```

在桌面托盘版本中，数据目录由 `STELLA_DATA_DIR` 指定，默认位于安装目录下的 `user-data/data`。

Git 会忽略以下运行数据：

- SQLite 数据库、WAL、SHM 和 journal
- OBS 连接配置
- BP 会话、素材索引与路径迁移记录
- JSON 迁移备份
- 构建产物、测试截图与本地缓存

初始 BP 配置位于：

```text
defaults/data/bp-config.json
```

## 项目结构

```text
public/                 前端页面、样式、脚本与静态资源
server/                 HTTP 服务、业务模块、SQLite 数据层和测试
defaults/data/          首次运行使用的默认配置
scripts/                数据迁移、验证与开发脚本
desktop/StellaDirector  Windows 托盘程序源码
desktop/StellaSetup     Windows 安装器源码
docs/                   设计与集成文档
runtime/node.exe        内置 Node.js 运行时
```

## 测试

运行完整 Node.js 测试：

```bash
npm test
```

当前测试覆盖：

- BP 会话、计时、比分、弃赛、历史恢复
- SQLite 初始化与 JSON 迁移
- 登录、会话、API 守卫和角色权限
- 素材库与 OBS 路径迁移
- OBS WebSocket 调度
- 赛程、队伍、选手与资源映射

## 开发约定

- 用户可见文案集中在 `public/assets/data/ui-text.json`，动态文字通过 `t()` 获取。
- 可变文字不得直接散落在 HTML/JS 中。
- `data/update-log.json` 是应用版本与用户更新日志的唯一来源。
- 发布版本必须同步 `package.json`，且最新日志条目必须位于 `releases` 首位。
- 更新日志只记录导播用户可感知的变化，不记录构建、打包或内部重构过程。
- 不要提交数据库、OBS 密码、会话令牌、素材绝对路径副本或其他本机运行数据。

## License

当前仓库未声明开源许可证。除非仓库所有者另行授权，请勿将代码或赛事素材用于其他用途。
