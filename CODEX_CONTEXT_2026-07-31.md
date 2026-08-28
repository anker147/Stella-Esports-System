# Codex 项目上下文快照

## 快照信息

| 项目 | 当前值 |
| --- | --- |
| 项目 | 星澜赛事导播系统 / ZFB Web HUB |
| 工作目录 | `E:\Code\Web\Zfb` |
| 快照日期 | 2026-07-31 |
| 当前系统版本 | `1.5.0` |
| 前端地址 | `http://localhost:3788/control.html` |
| 倒计时 HUB | `http://localhost:3788/hub/countdown` |
| 后端状态 | 正在运行 |
| 监听端口 | `3788` |
| 快照时后端 PID | `38220` |
| 内置 Node.js | `E:\Code\Web\Zfb\runtime\node.exe` |
| Git 状态 | 当前目录没有可用 Git 仓库，不能依靠 Git 判断修改来源 |

本文件用于后续 Codex 任务、人工维护或上下文压缩后的快速接手。内容以快照生成时的磁盘状态为准，不包含 OBS WebSocket 密码等敏感配置。

## 当前风险

### 完整测试未全部通过

2026-07-31 使用以下命令验证：

```powershell
runtime\node.exe --test server\*.test.js
```

结果：

```text
tests 70
pass 66
fail 4
```

失败项：

1. `each BP phase starts with its configured duration`
   - 期望 `25`，实际 `30`。
   - 当前阶段时长配置没有被 BP 服务正确应用。
2. `commentator image selection is stored with the BP session`
   - `BpService.setCommentatorImage` 尚不存在或尚未接入当前类。
3. `console scene push does not change or override the OBS transition`
   - `ObsController.pushScene` 尚不存在或尚未接入当前类。
4. `commentator image sync updates the fixed OBS image source`
   - `ObsController.syncCommentatorImage` 尚不存在或尚未接入当前类。

当前 `v1.5.0` 相关文件在快照前仍有近期修改，继续开发前应先重新读取：

- `server/bp-service.js`
- `server/obs-controller.js`
- `server/server.js`
- `public/assets/js/bp-control.js`
- `public/assets/js/control.js`
- 对应测试文件

不要删除失败测试来获得通过；应补全实际行为。

### 运行中的后端可能仍加载旧代码

快照时后台进程启动时间早于部分 `v1.5.0` 文件修改时间。修复完成后需要重启后台，才能让当前磁盘代码生效。

## 产品定位

这是一个本地赛事导播控制系统，通过外部 Node.js 服务和 OBS WebSocket 控制 OBS，不依赖 OBS 内置 Lua 脚本执行主要业务逻辑。

主要目标：

- 管理赛事赛程、队伍、选手和 BO3 BP。
- 使用网页控制 OBS 文本、图片、浏览器源、比分和场景。
- 管理倒计时、赛果图、晋级图、今日对战图和比赛阶段图。
- 提供场景控制台及网易云音乐联动。
- 提供本地素材库和 OBS 素材路径迁移。
- 形成可持续扩展、可记录版本的赛事导播系统。

## 技术结构

### 后端

- Node.js 22 兼容代码。
- 原生 `http` 服务，没有 Express。
- 内置 Node.js Runtime，目标电脑不需要安装 Node.js。
- 默认端口 `3788`。
- 入口：`server/server.js`。
- OBS 客户端：`server/obs-websocket.js`。
- OBS 高层控制：`server/obs-controller.js`。
- BP 状态：`server/bp-service.js`。

### 前端

- 原生 HTML、CSS 和 JavaScript。
- 主页面：`public/control.html`。
- 全局样式：`public/assets/css/control.css`。
- 各功能页逻辑位于 `public/assets/js`。
- 不依赖现代前端构建器。

### 启动方式

```bat
start.bat
```

开发环境也可运行：

```powershell
runtime\node.exe server\server.js
```

停止服务时应先通过 `netstat -ano` 找出占用 `3788` 的 PID，并只结束该项目的 `runtime\node.exe`，不得批量结束其他软件的 Node 进程。

## 核心文件

| 文件 | 作用 |
| --- | --- |
| `server/server.js` | HTTP API、静态资源、服务初始化、SSE 和业务路由 |
| `server/bp-service.js` | BP 会话、阶段、计时、历史、重赛、比分和弃赛 |
| `server/bp-config.js` | BP 配置加载与导出 |
| `server/obs-controller.js` | OBS 输入源、场景、比分、图片和 BP 推送 |
| `server/obs-websocket.js` | OBS WebSocket v5 客户端 |
| `server/tournament-data.js` | 多赛程数据解析、队伍和选手映射 |
| `server/material-library.js` | 素材库索引、目录同步和文件系统管理 |
| `server/obs-path-migration.js` | OBS 素材路径校验、事务同步和回滚 |
| `server/music-controller.js` | 网易云媒体会话控制 |
| `server/scene-music-controller.js` | OBS 游戏内场景和音乐播放联动 |
| `server/release-service.js` | 更新日志读取和版本校验 |
| `data/update-log.json` | 系统版本和更新日志的唯一数据源 |
| `data/bp-config.json` | 角色、阶段、槽位、OBS 源名和 UI 配置 |
| `data/bp-state.json` | BP 会话、比分、历史和赛果状态 |
| `data/material-library.json` | 素材库索引和监控根 |
| `data/obs-path-migration.json` | OBS 路径同步与回滚记忆 |
| `data/runtime-config.json` | 本机运行配置，包含敏感字段，不应导出内容 |

## OBS 控制约束

### 共享中转源

原 OBS Lua 动画逻辑已改为外部 WebSocket 调度。用户删除了多个中转源，只保留：

- 文字中转源：`暗`
- 图片中转源：`暗T`

所有需要动画转换的文字和图片共用这两个中转源，必须通过 `ObsController.runOperation()` 串行执行，禁止并发操作导致不同 BP 槽位互相覆盖。

### 场景和转场

- 主要赛事转场名称：`2026追风杯`。
- BP、赛果、晋级图和控制台场景逻辑已经多次调整。
- 赛果图和晋级图目前按用户要求保持直接更新及硬切，不走安全中间场景。
- 控制台在 `v1.5.0` 的目标行为是：场景按钮直接推节目画面，不修改 OBS 当前转场。
- BP 页“切换场景至 BP”的目标行为是：载入当前比赛、完整同步 OBS，然后切换 BP 场景。

继续修改场景逻辑前必须读取 `obs-controller.js` 和相关测试，不能仅依赖本段描述。

## 倒计时系统

- 固定透明 HUB 地址：`/hub/countdown`。
- 支持指定目标日期时间。
- 支持指定分钟和秒。
- 应用时间后立即开始倒计时。
- 重置后显示 `00:00`。
- OBS 输出始终为 `MM:SS`，分钟和秒均保持两位。
- 避免 DOM 重建造成闪烁。
- `v1.5.0` 增加七个 BP 阶段分别配置时长的 UI，配置从下一阶段开始生效；当前测试表明后端应用仍有不一致。

## BP 规则

### 角色池

逃生者：

```text
失忆者、小学妹、魔术师、战斗少女、小狐狸、水之忍者、星辰圣女、黎明盾卫、
命石者、小骇客、灵膳子、指绘师、夜翎、茶气郎、龙小侠、小师姐、偶像歌手
```

追捕者：

```text
雇佣兵、女特工、机器人、发明家、小梦魇、影之忍者、小狮子、机械之心、
劲凯、淘气云、幻术师、疾风刃
```

### 七阶段流程

1. 追捕方禁用一名逃生角色。
2. 逃生方禁用一名追捕角色。
3. 追捕方再禁用一名逃生角色。
4. 追捕方选择 1 号追捕角色。
5. 逃生方选择 1 至 4 号逃生角色。
6. 追捕方选择 2 号追捕角色。
7. 逃生方选择 5 至 8 号逃生角色。

阶段要求：

- 当前阶段完成后才能推进下一阶段。
- 进入下一阶段时先向 OBS 推送一次 `0`，再从配置时长开始。
- 逃生 Pick 一次有四个槽位，每个槽位在选手/角色条件满足时独立推送。
- 被 Ban 的角色不能 Pick。
- 第一次被 Ban 的逃生角色在第二次 Ban 时仍应保持不可用。
- 已 Pick 角色不能重复。
- 已锁定选手不能出现在其他选手选择栏。
- 角色称号输出模式下不要求选择选手昵称。
- 文本输出使用选手昵称或角色称号，不使用选手 ID。

### BO3

- 单场比赛为三局两胜。
- 队伍在第三局前取得 2 分后不得进入第三局 BP。
- 上一局 BP 未结束时不能进入后续对局。
- 每局 BP 自动保存并保留历史版本。
- 支持导出、回溯、重赛和正赛重置。
- 重赛恢复原 BP 快照，但赛果可以重新选择。
- 正赛重置需要二次确认。
- 支持手动结束 BP。
- 支持弃赛调度、满分结算和弃赛撤回。

## 赛事数据

系统已整合多份赛程：

- 2026-07-25 手游赛程。
- 2026-07-26 端游八强。
- 2026-07-27 手游八强败者组一、二轮。
- 其他赛程以 `public/assets/data` 和 `tournament-data.js` 的当前内容为准。

数据要求：

- A/B 房阵营映射必须互为反向。
- 手游使用手游横版 ID 名单的阵营与昵称。
- 端游使用端游横版 ID 名单的阵营、比赛服昵称和 ID。
- 替补即使没有阵营也必须进入候选池。
- 数据修改后必须运行 `tournament-data.test.js`。

原始数据曾来自：

- `E:\下载\2026追风杯赛事推进表.xlsx`
- `E:\下载\2026追风杯赛事推进表 (1).xlsx`
- `E:\2026追风杯\2026追风杯.json`

不要在未重新读取当前数据文件的情况下凭记忆修改映射。

## 赛果、晋级图和赛程图

### 赛果图

- 选择本局胜方时先更新比分，再要求上传图片。
- 图片支持选择、拖入和粘贴。
- 保存目录：`E:\2026追风杯\场景底图\本场赛果\结果图`。
- 文件名按赛区、轮次、回合和房间组织。
- 上传成功后保存到 BP 赛果，并推送 OBS。

### 晋级图

- 保存目录：`E:\2026追风杯\场景底图\晋级图`。
- 支持选择、拖入和粘贴。
- 文件名按赛区、日期和具体时间组织。
- 上传成功后推送 OBS。

### 今日对战图

- 以北京时间判断当天赛事。
- OBS 连接时根据日期同步今日赛程图。
- 当当天每场均已有最终胜方时，自动切换到下一次比赛赛程图。

### 比赛阶段

- BP 场景中的“比赛阶段”已由幻灯片源改为图片源。
- 图片跟随当前赛程组别或阶段切换。

## 控制台与网易云音乐

- 控制台使用场景按钮，适配全屏和约四分之一屏幕。
- 窄窗口下左侧导航变为顶部导航。
- 支持播放/暂停、上一曲、下一曲和音量。
- 上一曲/下一曲后刷新歌曲信息。
- 当前 OBS 场景为游戏内时自动播放网易云。
- 离开游戏内场景时，如果正在播放则自动暂停。
- 不得通过固定转场覆盖控制台用户选择。
- `v1.5.0` 目标是控制台场景按钮不再修改 OBS 转场；当前对应测试失败，尚需补齐 `pushScene` 行为。

## 素材库

已实现：

- 导入任意格式文件和文件夹。
- 以绝对路径保存索引。
- 分层文件夹浏览和面包屑导航。
- 大图标模式。
- 图片、视频和音频缩略图/预览。
- PSD 等不可直接预览文件使用 Windows 关联程序打开。
- 鼠标框选、Ctrl、Shift、Ctrl+A 多选。
- 批量仅删除索引或删除文件系统源文件。
- 导入文件夹后同步外部新增、删除和重命名。

### 磁盘根目录保护

曾误选 `G:\`，产生超过 41 万条索引并导致页面无法加载。现已在 `material-library.js` 实现：

- 导入前拒绝磁盘根目录。
- 在递归 `walk()` 前完成拦截。
- 轮询忽略盘符根监控。
- 启动时清理历史危险监控根及其索引，不删除磁盘源文件。

快照时素材库状态：

```json
{
  "entries": 346,
  "watchedFolders": ["E:\\2026追风杯"],
  "fileBytes": 81677
}
```

盘符根目录不得重新加入监控。

## OBS 素材路径迁移

素材库提供：

- `文件路径确认`
- `OBS 同步`
- `撤销上次同步`

逻辑：

1. 用户选择素材库中已索引的完整素材包根目录。
2. 后端扫描 OBS 输入源和源滤镜设置。
3. 仅处理位于开发根 `E:\2026追风杯` 下的绝对路径。
4. 按严格相对路径映射到新素材包根目录。
5. 所有目标文件存在后才允许同步。
6. 同步串行写入并逐对象回读校验。
7. 任一步失败时自动恢复本次已修改对象。
8. 保存字段级同步记录，服务重启后仍可撤销。
9. OBS 被外部修改或原路径不存在时阻止撤销覆盖。

核心文件：

- `server/obs-path-migration.js`
- `server/obs-path-migration.test.js`
- `data/obs-path-migration.json`

自动测试不得执行真实 OBS 写入。

## 更新日志规范

- 当前版本：`1.5.0`。
- 当前更新日志包含 21 个版本节点。
- 每次功能更新或问题修复必须更新 `data/update-log.json`。
- 使用语义化版本号。
- `currentVersion` 必须与 `releases[0].version` 相同。
- 同步修改 `server/release-service.test.js` 中的当前版本断言。
- 更新日志页面使用压叠式圆角版本卡片。

## v1.5.0 当前目标

更新日志声明的功能：

- 七个 BP 阶段可以分别设置倒计时时长。
- 新配置从下一阶段开始生效。
- 启动时扫描固定解说图片目录。
- BP 页面生成本场解说组图下拉框。
- 解说组图选择保存到本场 BP 记录并同步固定 OBS 图片源。
- “切换场景至 BP”先载入、同步，再切场景。
- 控制台按钮只推节目画面，不修改转场。
- BP 按钮按频率重排，辅助和危险操作可展开收起。

但快照测试显示其中阶段时长、解说图服务方法和控制台直切方法仍不完整，必须先修复测试失败后再认为 `v1.5.0` 完成。

## BP 动画与概念页面

仓库中存在独立实验/设计页面：

- `public/bp-animation-design.html`
- `public/match-intro-concept.html`
- `public/assets/css/bp-animation-design.css`
- `public/assets/css/match-intro-concept.css`
- `scripts/verify-bp-design.js`
- `scripts/capture-bp-design.js`

近期版本 `1.4.2` 至 `1.4.7` 主要围绕 BP 板材、立绘边界、入场顺序和渐变时间条调整。继续编辑前应先查看当前页面截图和验证脚本，避免破坏现有坐标、层级和动画时序。

## Windows 打包规划

已完成设计文档：

```text
docs/windows-packaging-and-update-design.md
```

规划内容：

- 可指定安装路径。
- C# .NET 8 WinForms 托盘程序。
- 静默启停和监听 Node.js 后端。
- 托盘直接打开前端。
- 文件哈希驱动的增量更新。
- 更新 staging、校验、备份、原子替换和失败回滚。
- 程序目录与用户数据目录分离。

当前仅为设计稿，尚未实现：

- `StellaDirector.exe`
- `StellaUpdater.exe`
- `StellaSetup.exe`
- `/api/system/health`
- 受控关闭接口
- `%ProgramData%` 数据迁移
- 完整包和增量包生成流程

正式打包前必须先完成运行数据与安装目录分离。

## 前端设计约束

- 沿用现有星澜赛事导播系统视觉风格。
- 操作型页面保持安静、紧凑、适合长时间导播操作。
- 控制台在缩小到四分之一屏时仍应在一个视口内显示主要控件。
- 窄窗口导航从侧栏切换为顶栏。
- 不得出现卡片嵌套卡片。
- 固定格式控件使用稳定尺寸，动态内容不得造成跳动。
- 按钮、下拉框和弹窗不能被页面底部裁切。
- 图标按钮应提供提示，常见命令优先使用熟悉图标。
- 修改前端后应使用桌面与窄窗口截图进行视觉检查。

## 工程约束

- 手工修改文件使用补丁方式，避免无关格式化。
- 工作区可能包含其他任务或用户正在进行的修改，禁止回退来源不明的文件。
- 修改前先重新读取目标文件。
- 不使用 `git reset --hard`、`git checkout --` 等破坏性操作。
- 删除文件系统内容前必须确认绝对路径位于预期工作区或用户明确指定目录。
- 素材库“仅移除索引”不得删除源文件。
- 自动测试规模应与修改风险匹配。
- OBS 真实写操作不能在自动测试中执行。
- 敏感配置不得写入日志、更新文档或上下文导出。

## 常用验证命令

完整测试：

```powershell
runtime\node.exe --test server\*.test.js
```

JavaScript 语法检查：

```powershell
runtime\node.exe --check server\server.js
runtime\node.exe --check server\bp-service.js
runtime\node.exe --check server\obs-controller.js
runtime\node.exe --check public\assets\js\bp-control.js
```

检查服务端口：

```powershell
netstat -ano | Select-String ':3788'
```

启动后端：

```powershell
runtime\node.exe server\server.js
```

## 建议的下一步

1. 先解决当前 4 项 `v1.5.0` 测试失败。
2. 重启 PID `38220` 对应后端，让磁盘最新代码生效。
3. 验证七阶段时长在阶段切换后正确应用。
4. 验证解说组图选择能持久化并推送固定 OBS 图片源。
5. 验证控制台直切场景不会更改或覆盖 OBS 转场。
6. 验证 BP 页载入、完整同步、切换场景的顺序。
7. 完成后更新版本日志并重新运行全部测试。

## 上下文边界

这份快照记录了当前项目中最重要的业务约束和实现状态，但不替代读取代码。以下内容容易随开发变化，开始任务时必须重新确认：

- OBS 场景、输入源和固定图片源名称。
- 当前赛事数据和赛程数量。
- BP 配置 JSON 的字段结构。
- `v1.5.0` 新功能是否已经在其他任务中继续实现。
- 后台 PID 和服务是否仍在运行。
- 完整测试结果。

