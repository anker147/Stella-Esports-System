# ZFB 全系统体检报告

日期：2026-09-19
范围：后端全部服务代码、数据库、前端数据加载机制、仓库卫生、两项网页设计审查（格式与交互动画规范、审美）
性质：纯检查，本次未修改任何业务代码与数据

## 0. 体检方式与开销说明

- 后端、前端、仓库卫生三个方向各由一个只读探查完成，关键结论用 ripgrep 定向复核到 file:line
- 数据库体检用 node:sqlite 以 readonly 模式打开 data/app.db 一次，只执行 SELECT 与 PRAGMA，全程零写入
- 测试基线全量仅运行一次（2.3 秒）
- 设计审查渲染了 4 个页面（Edge 无头 + 一次性 CDP 脚本，进程用完即退），截图仅用于审查
- 未读取任何图片素材、tar 包与数据库二进制内容；未对 node_modules 与 public 图片目录做遍历

## 1. 基线

| 项 | 现状 |
| --- | --- |
| 测试 | 197/197 全绿（node --test，2.3 秒；9 月 5 日基线为 175，其后新增 22 个） |
| 后端规模 | server/ 约 30 个核心文件，server.js 4468 行，路由 90+ 个端点，5 条 SSE 流 |
| 前端规模 | 6 个 HTML、35 个 JS（约 689K）、17 个 CSS（约 448K）、vendor 316K、ui-text.json 80K（1600 键） |
| 数据库 | 71 表加 1 视图，38 个显式索引，数据文件 16.65MB 加 WAL 4.1MB，user_version 31 |
| 运行环境 | Node v24.14.0（engines 声明 >=22），零 npm 依赖，服务运行于 127.0.0.1:3788 |
| 会话 | 当前 1 个活跃登录（developer） |

## 2. 崩溃与稳定性问题（建议 P0 修复）

### 2.1 主 handler 无最外层异常兜底（最危险）
server.js:2424 起的 async handler 一直延伸到 4426 行，全文件 82 个 try/catch 全部在分支内部，最外层没有任何兜底。任何一个未包裹的分支抛错（包括 SQLite busy_timeout 耗尽抛出的 SQLITE_BUSY）都会变成 unhandled rejection，Node 15 以上默认直接退出进程。导播系统在直播中整个服务消失，是当前系统最大的单点风险。

### 2.2 obs-controller 三个方法整段重复定义
server/obs-controller.js 中 locateSource（97 与 127 行）、setSourceVisible（111 与 141 行）、sourceVisible（122 与 152 行）各定义了两次，后者静默覆盖前者，属于复制粘贴残留。当前两组实现恰好一致所以无行为差异，但任何人只改其中一组就会埋雷。

### 2.3 obs 联动的空值与越界
obs-controller.js:286 对 `tournament.event.date.split('-')` 在 date 为空时直接抛 TypeError；轮次文案取数组下标，roundNumber 大于 9 或比赛不在列表（findIndex 返回 -1 变 0）时会产出 undefined 或"第零轮"。

### 2.4 bp-config 加载失败即崩进程
bp-config.js:131 在模块加载期对空配置直接 throw，角色配置一旦为空服务无法启动且无降级路径；同时 loadCharacterMeta（42-54 行）把全部角色立绘 base64 进内存并随 /api/bp/bootstrap 整包下发（server.js:3772-3775）。

### 2.5 内存态与数据库分叉风险
bp-service 以内存 this.sessions 为权威态，persist()（189-273 行）后写数据库；persist 抛错时内存 revision 已自增、状态已变，SSE 广播与后续操作都基于脏内存，重启后状态回跳（38、470-501 行）。hubs 的 ensureHub 与 saveHubState 同模式（server.js:1522、1690-1726）。

## 3. 数据一致性问题

1. activeAuditActor 是模块级可变量（server.js:1925 定义，4153 赋值，4252/4257 清空，1930 在异步事件里消费）：并发 BP 操作时 OBS 审计日志可能归因到错误用户。
2. 读接口带写副作用：communication-service.js:82-105 的 ensureMember/ensureObserver 在 GET 序列化路径里执行 INSERT 且不在事务内，拉一次 bootstrap 会写库。
3. sendMessage 落库、通知创建、广播三步不在一个事务（server.js:3172-3180）：中途失败则消息已存但无通知，客户端却收到 400。
4. recallMessage 两条 UPDATE 无事务（communication-service.js:547-557）。
5. tournamentResolver 用启动时一次性快照（server.js:1528、1559）：运行期对 teams/matches 的直接变更不反映，重启才刷新；BP 选人候选依赖它。
6. SSE 无事件补偿：服务端不保留最近事件、多数流不带序号（bp 流有 sequence 防回退但断档不补拉），客户端断线窗口内的事件永久丢失，详见第 6.3 节矩阵。

## 4. 后端性能问题

1. 会话校验放大：会话整体以 JSON blob 存在 app_settings（server.js:236、258-265），validateSession 每请求读整行加 JSON.parse 全部会话加一次 users 查询；SSE 广播对每个客户端再各验一次（1821、1837、1873、1885），一条广播等于 N 倍全量解析；页面请求还会校验两次（2318 静态入口加 2436 主入口）。
2. N+1 查询：通讯 serializeChannel 每频道约 7 次查询（communication-service.js:178-249），developer 账号 bootstrap 序列化全部频道且逐消息再加 2 到 3 查询；赛事快照对每场比赛发两条查询（event-management-service.js:341-345、395-397）；角色统计每请求全量重算（character-stats.js:686-694，请求内有 memo 但跨请求无缓存）。
3. BP persist 全删全插（bp-service.js:207-214）：每次保存按 session_id 全删重插 slots、results、history，配合每动作写入一条含完整 snapshot_json 的历史（470-484），单局 BP 写放大为 O(n 的平方) 量级；当前 bp_session_history 已有 3308 行。
4. 静态资源缓存策略缺位：JS、CSS、JSON 一律 no-store（server.js:2361-2364），每次进页面全量回源约 908K 脚本；图片有 ETag 但每个请求都整文件读入内存算 SHA1（2338-2358）。
5. text.js 用同步 XHR 加载 ui-text.json 且带时间戳参数（text.js:6-7）：80K 文件永不过浏览器缓存，还阻塞其后全部 31 个脚本。
6. overlay 每 15 秒拉整页 HTML 只为 diff 版本号（overlay.js:21、33），每个 OBS 观看端持续轮询整页文档。
7. 无缓存的热点：GET /api/character-stats 每次全量重算（character-stats.js:686）。

## 5. 数据库规范评估

### 5.1 健康度
quick_check 返回 ok，foreign_key_check 零违例，freelist 仅 0.01MB，WAL 4.1MB 属正常。建表纪律高于平均水平：CHECK 约束丰富、多数外键带正确的 CASCADE 或 SET NULL、热路径索引齐全（通讯消息、BP 历史、通知等均有复合索引）。

### 5.2 问题清单
1. 约 20 个外键为 NO ACTION（无删除策略）：bp_sessions.match_id 与 replay_of、bp_session_slots 的 players/characters/bp_slots 三个、bp_forfeits 的 teams 两个加 matches、bp_session_results.teams、bp_phase_slots.bp_slots、bp_ui_sections.bp_slots、event_teams.teams、match_participants 的 teams 加 matches、match_rooms 的 teams 两个、matches.teams。删除父行会被阻塞或需要像 purgeTestMatchData（bp-service.js:292-298）那样手工清子表。
2. 迁移链瑕疵：v26 被并入小于 27 的分支没有独立版本（db.js:1744-1749），v14/16/17 是空迁移。
3. 会话以 JSON blob 存 app_settings（见 4.1），无法索引、无法按用户查询。
4. 遗留痕迹：characters.nickname/display_name 可空靠迁移回填（db.js:304-305），players.slot 为无 CHECK 的 TEXT（db.js:83）。
5. BLOB 图片能力存在但用量极低：user_avatars（1 行，上限 600KB）、user_profile_covers（1 行）、character_portraits（0 行）、event_media（0 行）、communication_channels.avatar（BLOB，12 个频道）。当前立绘与头像已走文件 URL（characters.portrait_url 为 TEXT）。数据库总体 16.65MB，无膨胀问题，图片出库不是当务之急。
6. asset_path_sync_records 无主键无索引（74 行，量小不紧迫）。

## 6. 前端数据加载机制评估

### 6.1 架构判断
data-cache.js（280 行）作为唯一请求入口的设计是好的：内存 Map 缓存、32 条近似 LRU、按路由前缀的 TTL（默认 30 秒）、in-flight promise 去重、写操作后按前缀批量失效、导航悬停预热。问题不在架构，在健壮性与联动。

### 6.2 首屏瀑布（control.html）
1. 12 个阻塞 CSS 约 358K（control.css 单文件 167K）加 31 个脚本约 908K（含 pinyin-pro 316K），全部无 defer 或 async，解析器串行加载（control.html:8-19、1879-1910）。
2. text.js 同步 XHR 卡在所有脚本最前（见 4.5）。
3. 缓存预热全部排在 /api/profile 完成之后（data-cache.js:275-276，profile.js:972），profile 慢则所有页面数据后移。
4. hub state 拉完才开 SSE（control.js:553-565）；BP 初始化四连串行（bp-control.js:1228-1233）。

### 6.3 SSE 断档矩阵（8 处 EventSource，全部依赖浏览器自动重连，无一处 onopen 补拉）

| 端点与位置 | onerror | 断线期间 | 重连后 |
| --- | --- | --- | --- |
| /api/hubs/:id/events，overlay.js:26 | 无 | 静默冻结最后一帧 | 等下一条推送，最差 |
| /api/hubs/:id/events，control.js:533 | 仅改文案 | 数据冻结 | 被动等下一条 state |
| /api/bp/events，bp-control.js:921 | 无 | 静默；ensureInitialized 兜底实际不触发（EventSource 对象仍在） | 被动等下一条 session 推送 |
| /api/bp/presentation/events，bp-overlay.js:267 | 清空舞台待机 | 空白 | 等心跳或下一条推送 |
| /api/communications/events，communications.js:1347 | 置 error 态 | 提示断线 | 下一条事件触发 80ms 去抖全量补拉，全站最好 |
| /api/notifications/events，notifications.js:268 | 无 | 静默 | 下一条事件触发全量补拉 |
| /api/bp/events，character-stats.js:1185 | 无 | 静默 | 下一条事件 220ms 防抖全量重拉 |
| /api/session/events，presence.js:79 | 校验会话 | 无数据需求 | 可接受 |

结论：纯推送驱动的四个页面（control 倒计时、overlay、bp-control、bp-overlay）断线窗口内事件不重放，只能等服务端下次变更。最小修复是给 8 处 EventSource 统一加 onopen，按端点 force 重拉对应 bootstrap，data-cache 已具备 force 语义，改动小收益大。

### 6.4 缓存健壮性
1. 无重试、无超时（data-cache.js:118-140）：挂起的请求让共享 promise 的所有等待方无限等待。
2. `response.json().catch(() => ({}))` 把非法 JSON 吞成空对象再抛"请求失败"，丢失真实原因。
3. 32 条上限在预热队列（15 条以上）加页面切换时可能挤掉 /api/profile 这类热数据。
4. SSE 与缓存无联动桥：非 force 的读在断线后最长陈旧 30 秒且无人失效。
5. 导航按钮 pointerenter 预取无冷却（data-cache.js:200-204），悬停扫过即可反复回源。

### 6.5 正面清单
accounts.js:665 与 operations-center.js:956 的轮询有可见性加面板双守卫；presence 心跳有 pending 去重；写后缓存失效映射完整；?v= 缓存参数体系整体健康（仅 text.js 与 tooltip 存在 1 和 2 的版本漂移，ui-text.json 靠时间戳另说）。

## 7. 设计审查 A：格式与交互动画（vercel Web Interface Guidelines）

方法：规范正文 190 条清单，对照四页真实渲染截图与代码定向扫描。

通过项：
1. transition: all 零命中；无 user-scalable=no 禁缩放；无内联 onclick。
2. control.html 有 109 个 aria-label，图标按钮可访问名称覆盖很好；按钮与链接语义使用规范。
3. font-variant-numeric: tabular-nums 在 7 个 CSS 中广泛使用，数字列不跳动。
4. 登录页 KV 背景图 alt 为空并 aria-hidden，装饰图处理正确。
5. overscroll-behavior 在弹窗类组件有覆盖；control 与 communications 的 CSS 已有 prefers-reduced-motion 区块。

问题项（按优先级）：
- A1 login.css:458-461：登录输入框 :focus 同时清掉 outline 和 box-shadow，没有任何替代焦点指示，键盘用户在登录页看不到焦点在哪。表单页的可访问性硬伤。
- A2 四个页面均无 color-scheme 与 theme-color 声明：Windows 深色系统下原生控件、滚动条会出现反色错乱。
- A3 登录密码输入无可访问名称：label 内只有 aria-hidden 图标与裸 input（login.html:57、73），屏幕阅读器读不到字段用途；且密码框缺 autocomplete="current-password"（用户名框有 autocomplete，密码没有）。
- A4 focus-visible 体系不完整：components.css、login.css、dialog-theme.css 均无 focus-visible 样式，components.css:85 还有裸 outline: none，焦点指示不统一。
- A5 登录页粒子背景（particles.js）与入场动效未接 prefers-reduced-motion（login.css 零命中）。
- A6 小项：登录提交按钮应有请求中禁用加 spinner 状态；?v= 版本漂移（text.js 在 control 是 v2 其余页 v1，tooltip.css 同样漂移）。

说明：overlay 与 bp-overlay 是 OBS 源页面，无交互控件，清单多数条目不适用。

## 8. 设计审查 B：审美（design-taste-frontend）

方法：取该技能第 4 章设计工程指令、第 6 章性能与可访问性护栏、第 9 章 AI 味禁用模式，对照四页截图与 CSS 逐项核。

总体判断：这是一套有真实设计体系的产品界面（tokens.css 变量体系、统一圆角与间距、克制的阴影），不是模板拼装，不需要重构式整改。

逐项：
1. 色彩纪律：主界面单一蓝色 accent 配中性灰阶，一个页面一个主色执行到位；状态 chips 用色克制。达标。
2. 登录页 CTA 为蓝到紫渐变按钮，与主界面扁平蓝有轻微漂移。该技能不建议默认紫渐变（AI 味信号之一）；若保留建议收敛为品牌蓝的同族深浅渐变或纯色。低优先级。
3. 排版与首屏：登录大标题两行内、副标题短、CTA 不需滚动可见，hero 纪律全达标；个人中心层级清晰，标题副标题加卡片节奏舒服。达标。
4. 形状一致性：卡片大圆角、控件小圆角、chips 全圆，体系统一无混用断裂。达标。
5. 交互状态：空态有替代内容（今日无赛程时的提示卡）、禁用项灰显、悬停反馈齐全；失败态偏弱（呼应 6.4），建议补请求失败的行内错误样式。中优先级。
6. 动效：粒子、悬浮岛、滑动指示块属克制的流体级动效，动画属性书写规范（只动 transform 与 opacity），缺 reduced-motion 降级一处（同 A5）。
7. AI 味扫描：无 div 假截图、无假精确数字、无装饰线堆砌、无通用假人名；元信息分隔符每行不超过一个。达标。
8. 图片：登录 KV 与赛事素材均为真实物料，无占位垃圾图。达标。

结论：审美不需要大动，建议项只有两条，渐变收敛（B2）与失败态补全（B5）。

## 9. 冗余文件清单

### 建议直接删除（检查产物与明确遗留，约 16MB）
| 文件 | 说明 |
| --- | --- |
| 根目录 12 张 PNG 截图 | bp-character-nickname、bp-console-audit、bp-hub-preview-check、bp-hub-preview-fixed、bp-hub-standby、bp-hud-preview-dialog、bp-hud-preview-page、bp-queue-fixed、bp-toast-feedback、hud-center-bp-dialog、hud-center-cd-dialog、hud-center-grid，合计约 4.3MB，9 月 19 日检查产物 |
| stella-source.tar.gz | 11.5MB，8 月 31 日源码打包，git 历史完整无需留 |
| CODEX_CONTEXT_2026-07-31.md | 17K 旧上下文导出 |
| .tmp-server.log | 1K 运行残留 |
| test-results/ | 空目录 |
| ~~server/CloudMusicAudio.cs~~ | 已从删除清单移除：二次审查确认它是 media-session.ps1 运行时 Add-Type 编译的网易云媒体控制依赖（误删后已从 git 恢复，见执行记录） |

### 需要你确认后处理
| 目标 | 体量 | 说明 |
| --- | --- | --- |
| data/backups/ | 43MB | 6 个迁移前旧库备份（8 月 31 至 9 月 2 日），迁移已稳定 17 天，可删或转冷备 |
| data/ 下迁移遗留 JSON | 约 20MB | bp-state.json.backup 与 .migrated 两个大文件加 7 个小 .migrated 文件 |
| .impeccable/、.codex-artifacts/、.codex-spreadsheet/ | 约 1MB | 旧审查与工具产物 |

### 建议保留
server/*.ps1 四个脚本（music-controller.js 与 server.js 实际引用，不是垃圾）；pinyin-pro.js（有真实用途，建议改为搜索首用时动态加载，属性能项）；概念稿双件套 bp-animation-design.html 与 match-intro-concept.html（2026-09-19 你明确保留，不删除；注意 bp-animation-design.css 被 bp-overlay.css @import 引用，二者是一体的）；docs/、DESIGN.md、PRODUCT.md、defaults/、desktop/、runtime/。

## 10. 重构路线建议（报告确认后分批实施）

### 批次 P0：稳定性（约半天）
1. server.js 主 handler 加最外层 try/catch 兜底，转 500 并记日志，不影响分支内已有的 4xx 语义。
2. 删除 obs-controller 三对重复定义，修 date 空值与轮次越界。
3. bp-config 空配置从进程崩溃改为明确的服务错误响应。
4. 前端 8 处 EventSource 统一加 onopen 按端点 force 重拉（data-cache 已有 force 语义），overlay 补 onerror 提示。

### 批次 P1：性能（1 到 2 天）
1. 会话校验加进程内缓存（token 到会话，短 TTL 加写时失效），SSE 广播不再逐客户端全量解析。
2. serializeChannel 与赛事快照改批量 IN 查询；character-stats 加短 TTL 结果缓存。
3. persist 改增量写：history 只追加新记录，slots 用 upsert。
4. 静态资源：JS 与 CSS 从 no-store 改为 ETag 加 max-age（与 ?v= 参数联动）；text.js 改异步加载；pinyin-pro 动态加载。
5. data-cache 补超时与一次重试，失败给 UI 错误态。
6. 去掉 overlay 的整页 HTML 轮询，改轻量版本探针或 SSE 通知。

### 批次 P2：数据库（约半天，全程不丢数据）
1. 迁移前先 WAL checkpoint 加双备份（文件拷贝加 VACUUM INTO 存入 data/backups）。
2. 迁移链 v32：为第 5.2 节列出的约 20 个 NO ACTION 外键补删除策略（涉及重建表）、新增 auth_sessions 独立表并把 app_settings 里的会话 blob 全量迁入、players.slot 补 CHECK、characters 昵称列收口。
3. 迁移后校验：逐表行数对比迁移前后一致、foreign_key_check 零违例、quick_check ok、197 个测试全绿。
4. 注意：会话迁独立表后，现有"诊断会话种法"要同步改为插表。

### 批次 P3：清理与发版
1. 按第 9 章清单处置冗余文件（先处置"建议直接删除"档；概念稿双件套按你 2026-09-19 的决定保留）。
2. 统一 ?v= 版本漂移并递增。
3. 走标准发版清单：update-log.json、release 测试断言同步、缓存参数递增。

## 11. 数据解耦性检查（2026-09-19 补充）

### 结论
解耦机制本身运转正常，问题在覆盖面断层。具体：

1. 关联完整性：达标。全部页面声明的 data-text 键与全部模块 t() 调用键都能在 ui-text.json 中命中（text-catalog-contract.test.js 双向断言持续把关），宿主元素纯文本节点约定未见破坏。
2. 控制台页覆盖密度好：control.html 有 473 个 data-text 声明；login.html 与 bp-overlay.html 零硬编码中文文本节点，完全干净。
3. 覆盖缺口一（HTML）：赛程面板一批用户可见文案未进目录，包括创建阶段表单的赛制选项（双败淘汰、单败淘汰等 4 项）、房间选项（PC 端、PE 端）、周一到周日的 weekday pills、开始阶段按钮、部分初始态文案（当前没有正在进行的赛事）以及 document.title（目录里已有 app.title 键但没人消费它）。
4. 覆盖缺口二（JS，用户可见字符串未收编）：event-management.js 最重（创建赛事向导的整批 innerHTML 模板文案，如选择创建方式、正式赛事、民间赛事、表单字段标签）；permissions-center.js 与 accounts.js 的确认弹窗标题与正文；notifications.js 的通知来源标签映射；obs-connection.js 部分状态文案。
5. 合规但值得说明的形态：hud-center.js 用 titleKey 加同值 fallback 的写法（键在目录，兜底串为设计使然），operations-center.js 与 bp-control.js 的无汉字合同只覆盖这两个文件加 helper 级检查的 communications.js 与 schedule-manager.js；其余模块没有同等合同约束。
6. 建议：不强制本轮全量收编（改动面大），先立规矩再渐进补齐：给 text-catalog-contract.test.js 增加"HTML 中文文本节点必须有 data-text 或加入豁免清单"的弱断言，新代码一律走目录，存量按模块渐次收编（优先 event-management 与两个弹窗密集模块）。

## 12. 结语

架构与工程纪律高于平均水平：零依赖、事务封装统一、CHECK 约束丰富、文字全部进目录、测试 197 个全绿，没有需要推倒重来的部分。三件事最值得先做：主 handler 无兜底（单个请求能打死整个直播服务）、SSE 断线不补拉（直播场景断档感知明显）、静态资源不缓存（每次进页面白拉 900K）。数据库本身很健康，重构收益主要在外键策略与会话存储形态，图片出库暂无必要。

## 附录：执行记录（2026-09-19 当日，按报告批次实施）

概念稿双件套按你的决定保留；数据解耦性检查结论见第 11 节，本轮只立规矩未做存量收编。各批次落地情况：

- P0 稳定性：主 handler 改为独立函数加最外层兜底（未捕获异常返回 500 并记日志）；obs-controller 三对重复定义删除，比赛日期空值与轮次越界修复；bp-config 空配置改为降级启动；8 处 EventSource 全部补 onopen 断线重连补拉（control、overlay、bp-control、bp-overlay、communications、notifications、character-stats、presence 中除 presence 外的 7 处加 overlay 共 8 个连接点），overlay 补 onerror。
- P1 性能：会话校验加 15 秒内存缓存（写时全清、命中深拷贝返回、systemAccess 关闭时绕过缓存）；通讯序列化改为批量上下文预取（tracker、偏好、各频道最后一条消息、加一统计合并为全局查询加每频道 1 条统计查询，unread 与 firstUnread 合并单查询）；赛事快照用窗口函数批量取 nextMatch 加批量取队伍；BP 历史改增量持久化（含测试场清空路径的计数重置与历史回退的全量重写兜底）；角色统计加 30 秒结果缓存；serveStatic 改 stat 型 ETag 加 304 免读文件，js、css 与 ui-text.json 启用 max-age 缓存；text.js 去掉时间戳改固定版本参数；data-cache 加 12 秒超时与 GET 网络级失败单次重试；overlay 的 15 秒整页轮询替换为 /api/system/health 版本探针。pinyin-pro 动态加载经评估暂缓（search.js 的工厂模式与索引构建耦合较深，收益风险比不足，留待后续）。
- P2 数据库：迁移链 v32 上线。迁移前 VACUUM INTO 加文件拷贝双备份（data/backups/app-pre-v32-20260919.db 等）；会话从 app_settings 的 auth.sessions blob 全量迁入独立表 auth_sessions（含 token、user_id 索引，原 blob 键删除）；重建 bp_sessions、bp_session_slots、bp_forfeits、bp_phase_slots、bp_ui_sections 五张表补外键删除策略（match 与 slot 级联、可空引用置空、队伍引用显式 RESTRICT），迁移内置逐表行数守恒断言与 foreign_key_check 校验。迁移后实测：user_version 32、八张 BP 相关表行数与迁移前完全一致（57、741、47、3308、5、9、13、13）、外键违例 0、quick_check ok、迁移前登录会话迁移后原 cookie 直接可用。
- P3 清理与发版：删除 12 张检查截图、stella-source.tar.gz、CODEX_CONTEXT 旧文档、空 test-results 目录与 .tmp-server.log（约 16MB；原清单中的 CloudMusicAudio.cs 经二次审查确认为运行时依赖，误删后已恢复，见下文）。data/backups 与迁移遗留 JSON 未获确认保留原样。发版清单完成：update-log.json 新增 2.4.1（直播稳定性与加载提速，优化 6 条修复 4 条）、package.json 与 release 测试断言同步、10 处 ?v= 缓存参数精确递增（text.js 统一到 v3 顺带消除版本漂移）。
- 验证：每批次后全量测试一次，最终 197/197 全绿；服务已重启至 2.4.1（健康端点确认），静态缓存 ETag 与 304、外键策略、会话迁移均实测生效。本批解耦缺口（赛程面板文案、event-management 等模块）与 pinyin-pro 动态加载留作后续迭代。

### 二次审查（执行当日的复查）

以挑错立场复核全部改动，发现并修复三处问题、订正一处误判：

1. 严重：BP 历史增量持久化在"重启后首次保存"场景会把库中已有历史整段重复插入，原因是 ensureHistory 从库装载历史时没有锚定增量计数。修复为装载时同步锚定，并用临时库探针实测：重启场景首次 persist 后历史仍为 3 条（修复前会翻倍到 6 条），再次 record 后正确增至 4 条。
2. 全新安装路径不一致：SCHEMA_DDL 里五张 BP 表仍是旧外键策略（NO ACTION），与 v32 迁移后的库不一致。已把 SCHEMA_DDL 五表改为与迁移一致（CASCADE、SET NULL、RESTRICT），探针实测全新内存库八项外键策略全部正确。
3. 死代码与残留：event-management 的 nextMatch 函数批量改造后无调用方，删除；server.js 的 SESSION_SETTING_KEY 常量随会话迁表后失效，删除。
4. 误判订正：CloudMusicAudio.cs 并非杂散文件，而是 media-session.ps1 运行时 Add-Type 编译的网易云媒体控制依赖；误删后已从 git 恢复。教训：删除任何文件前必须全库检索文件名引用，包括 ps1 的 Add-Type 与 Join-Path 这类动态引用形态。

复查后全量测试 197/197 全绿，服务已重启加载全部修复（健康端点确认 2.4.1）。

### 补充批次 2.4.2（同日，读取优化剩余项与战略台账）

按"正收益项一次做完"的决策实施五项：角色立绘 BLOB 移出 bootstrap（has_blob 时下发按需读取地址，实测立绘本就多为文件 URL，此项为防御未来上传撑爆接口）；计时日志断线增量补拉（/api/hubs/:id/logs?after= 增量端点加 control.js lastCountdownLogId 追踪）；userCard IN 批量化（userCards 助手，userCard 委托，消息列表与频道成员受益）；SSE 广播 sseWrite 单连接容错加 7 个注册点 error 清理；sendMessage 通知入同事务（新增 db.js 嵌套感知 runTransaction，WeakMap 深度，内层并入外层，notification-service 同步接入）加 recallMessage 事务加 activeAuditActor 删除改为 operation.actor 显式传递。期间修复一处自身引入的 TDZ 缺陷（WeakMap 声明必须在迁移链执行前）。全量测试 197/197 全绿，以 2.4.2 发版（update-log、package.json、release 断言、control.js?v=40 同步）。优化战略（已完成清单、明确不做清单与触发条件）已写入项目记忆 zfb-optimization-strategy.md，防止后期二次优化。

### 补充批次 2.4.3（2026-09-20，两项战略项实施）

经计划确认后实施两大战略项：首屏 defer 化（6 页全部外部 script 加 defer 保序、ui-text.json preload 预载、pinyin-pro 懒加载并从首载移除，text.js 同步契约保留不动）与 write-through 失败重载回滚（persist 拆分 writePersistedState，失败时按库重载受影响会话并广播 state-rolled-back 纠正，tick 与 schedulePhaseAdvance 定时器崩溃路径加固，hub 动作路由 saveHubState 与日志写入进同一事务、失败回退内存并广播）。新增失败注入测试守护回滚路径，全量测试 198/198 全绿，以 2.4.3 发版。两项在战略台账中由"不做清单"移入"已完成"，text.js 真异步化与 SQL-first 全量反转作为放弃形态记录在案。
