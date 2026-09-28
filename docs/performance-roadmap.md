# 性能与代码质量路线图（持久化计划）

建立于 2026-09-20。本文件是"性能优化最优、代码最完善干净版本"的执行计划，按批次推进。
每批完成后更新状态与验收证据；新会话动性能或结构相关代码前必须先读本文件与 AGENTS.md。
背景：docs/system-audit-2026-09-19.md 是全量体检报告；2.4.1 至 2.4.3 已完成的部分见其执行记录附录。

## 基线（2026-09-20，2.4.3 上线时）

- 测试 198/198 全绿；健康端点报版本。
- 接口实测：profile/notifications 约 5ms，通讯 bootstrap 约 9ms，character-stats 热 7ms，events 热 22ms，bp/bootstrap 约 54ms。
- 首屏：脚本 defer 化完成（46 个标签），ui-text.json 预载，pinyin 懒加载；CSS 仍渲染阻塞（批次 2 处理）。
- 稳定性：主 handler 兜底、SSE 断线增量补拉、广播容错、状态写入失败回滚、定时器加固全部就位。

## 批次清单

### 批次 1：传输压缩与通讯测试（2026-09-20 完成）
- [x] 静态资源 gzip 压缩协商（serveStatic：js/css/json/svg/html/txt，大于 1KB 且客户端接受时压缩，Vary: Accept-Encoding）
- [x] communication-service 测试补缺口（原文件已有 13 个用例，新增 2 个：markChannelRead 驱动的批量未读水位线、afterInsert 钩子失败时消息与通知同事务回滚）
- 验收：200/200 全绿；实测 control.css 167457B 转 25201B（降 85%）、ui-text.json 81133B 转 24660B（降 70%）、data-cache.js 12396B 转 3187B，Content-Encoding 均为 gzip。

### 批次 2：CSS 渲染阻塞治理（2026-09-20 完成，范围经实施修正）
- [x] control.css 拆分：实施时发现 8132 行里没有干净的面板边界（仅 8 个分区注释，面板样式交错），按原计划"按面板拆分"需要语义分析且有级联回归风险。改为**尾部整段字节级搬移**：control.css 保留 1-4630（核心壳层加滑动指示块），control-character.css 新增 4631-7842（角色数据/编辑器/日志详情 67K），control-hud.css 新增 7843-8132（HUD 中心加 BP 提示 5.5K），加载顺序紧跟 control.css，级联关系字节级不变（重组校验通过）。
- [x] gzip 已覆盖传输收益（167K 传输 25K），拆分的实际收益为组织性与缓存粒度，首绘收益有限（诚实记录：原前提"首绘大头"在 gzip 落地后已大部分兑现）。
- [ ] 关键 CSS 内联与构建期压缩：收益边际，暂缓。
- 验收：200/200 全绿；control.html 引用 v94 加两个 v1 新文件。

### 批次 3：server.js 路由表化拆分（2026-09-28 完成，执行分解定稿 2026-09-20）

现状基准（2026-09-27 核实）：server.js 4744 行，if 链约 85 个路径模式（32 个正则匹配加 50 多个精确或前缀判断），2.5.1 的心跳、Keep-Alive、bp-bootstrap-cache 模块尚未落盘（安全头部分出现在两处 SSE 响应）。开工前提：先确认 2.5.1 已落地或与本批合并执行，避免两次冻结。

五项设计决策（开工前定稿）：
1. 匹配器：声明式路径编译正则，:id 捕获进 ctx.params；现有 32 处 match 正则逐一转录；startsWith 的域前缀语义保持
2. ctx 统一：{ req, res, url, pathname, params, query, requestSession, body }；骨架负责会话校验、豁免判断、权限检查、body 读取与 JSON.parse（失败 400）、异常兜底
3. 权限：requiredPermission 前缀函数退役，改表项 permission 字段；迁移前导出"端点到权限"基线矩阵，搬移后逐项比对
4. handler 自行 sendJson（保留 201/403/自定义头），骨架只兜异常
5. 特殊路径留骨架：/ 的 sendShell 分流、OBS_PAGE_PATHS 与 /hub/:id 重写、六处 SSE、五处 sha256 ETag 媒体响应、音视频 Range 流、BP 导出下载、shutdown 令牌特判。此清单是搬移边界地图

六阶段执行分解（约 6 个工作日）：
- 阶段 0（0.5 天）：routes/ 目录与匹配器，handleRequest 收缩为骨架四步，不搬 handler，测试全绿（新旧共存验证）
- 阶段 1（0.5 天）：system、logs、update-log、hubs 四域（hubs 含 beforeState 回滚广播细节，用于打磨手法）
- 阶段 2（0.5 天）：communications、notifications（验证 ctx.body 统一设计，通讯域有 11 处 body 原样传 service）
- 阶段 3（1 天）：operations、events（正则最多，32 个 match 大部分在此，含 startsWith 与精确匹配的语义核对）
- 阶段 4（1 天）：admin 全组、profile、friends、presence、materials、media、character-stats
- 阶段 5（1 天）：bp 全域（与 bpService、bpPresentation、obsController 三个单例交互最密，放最后）
- 阶段 6（0.5 天）：删旧 if 链与 requiredPermission 函数、路线图收尾、发版

三个实施陷阱：startsWith 与精确匹配混用需逐条核对原语义；同一路径的 GET 与 POST 是不同 handler，表项必须带 method；部分分支失败时的 recordAuditLog 副作用必须随 handler 搬移。验收：每阶段全量测试；迁移前采集全部端点状态码基线矩阵，每域搬移后逐端点比对；纯移动禁止顺手改逻辑；server.js 冻结期间不做其他修改。

- [x] 90+ 端点 if 链改为路由表（2026-09-28 全量完成：116 个端点表驱动，链上仅剩边界清单特殊路径；routes 集中注册于 server.js 路由表区未拆 routes/ 目录，随 requiredPermission 退役一并决策为维持现状——声明式表与权限表已内联，拆目录收益边际）
- 状态：完成。
- 验收：全量测试全绿；每域代表端点探针状态码不变。

### 批次 4：文字解耦存量收编（2026-09-20 完成，event-management 模板留作债务）
- [x] notifications.js 来源标签（5 键）、accounts.js 弹窗与地区回退（4 键）、permissions-center.js 脏编辑弹窗（3 键）、obs-connection.js 状态文案（6 键）
- [x] control.html 静态文案挂 data-text：赛制与房间选项、周几 pills、开始阶段按钮、赛事空闲态、Logo 回退字（16 处，复用 schedule.startStage，新增 13 键）
- [x] text-catalog-contract.test.js 增加棘轮断言：宿主无 data-text 的静态中文文本节点不得超过基线（control 42、login 0、overlay 0、bp-overlay 0、概念稿 14 加 4），收编后手动下调基线
- [x] event-management.js 创建向导的 innerHTML 模板文案（约 33 行）：2026-09-28 经核实已收编，债务关闭（见状态日志）
- 版本参数：notifications v3、accounts v9、permissions-center v4、obs-connection v2。
- 验收：201/201 全绿（含棘轮断言）；抽改键值页面跟随（契约测试双向覆盖）。

### 批次 5：图片资产治理（2026-09-20 完成）
- [x] 登录 KV 压缩：kv-board.jpg 2485K 降到 304K（1920 宽、质量 82，原件备份 data/backups/media-20260920）
- [x] 哈希去重：bp-background.png、bp-layout/base.png、bp-original/base.png 三份同文件（sha1 598990719fc9）删两份；bp-layout/cover.png 与 bp-original/cover.png 第二对孪生（7d09f9442a33）删一份；base-shell 与 cover-shell 同理互为孪生随目录处理
- [x] matchup-background.png（RGB 无透明）转 JPEG：1218K 降到 76K，CSS 引用同步更新
- [x] zhuifeng-base.mp4 用 ffmpeg 重编码（CRF 28）：7762K 降到 683K，1080p 30fps 不变
- [x] 删除零引用的 bp-original 目录（base-shell、cover-shell、cover 三件，全部 git 跟踪可恢复）
- [x] teams 队标（RGBA 透明艺术图 355K 到 1.3M）保留：透明度必需，缩放有质量风险，体积为内容固有
- 验收：202/202 全绿；match-intro 目录 18M 降到 3M；公共资产净减约 17M；matchup-background.jpg 转换质量人工核对无伪影。

### 批次 6：db.js 拆分与数据层遗留收口（2026-09-20 完成）
- [x] db.js 拆分：SCHEMA_OBJECTS 与 SCHEMA_DDL（约 910 行）移入 server/schema.js，db.js 从 1800 行降到 1087 行，require 接管
- [x] 迁移 v33：characters.nickname/display_name 收 NOT NULL（重建表）、players.slot 加 15 值域 CHECK（重建表）、asset_path_sync_records 补自增主键；沿用 v32 套路（foreign_keys OFF 加逐表行数守恒加 foreign_key_check），并修复一个实施陷阱——players 被视图 v_team_candidates 引用，RENAME 会重解析视图，需在重建窗口开 legacy_alter_table
- [x] 迁移测试断言同步（3 处 32 改 33）；event-management-ui.test.js 的 DDL 源码断言改为读 db.js 加 schema.js 拼接
- [x] 图片 BLOB 空表（character_portraits/event_media）去留决策：2026-09-28 关闭——event_media 空表经 v35 迁移删除，character_portraits 保留（活功能，随上传量信号再评估）
- 验收：线上实测 user_version 33、foreign_key_check 零违例、quick_check ok、characters 零 NULL 昵称、players 238 行守恒。

### 批次 7：结构解耦杂项（2026-09-20 部分完成）
- [x] pointerenter 预取加 30 秒冷却（data-cache.js bindPrediction，per-button Map 节流）
- [x] data-cache 与 SSE 联动桥：评估后暂缓——各模块的 onopen 补拉加事件触发 force 重拉已覆盖实时性，通用失效桥是新设计面，收益边际
- [x] bp-overlay.css 对概念稿 CSS 的 @import 拆开：评估后保留——拆出共用子集需静态枚举 JS 动态生成的类名，漏一个就是 OBS 呈现面的视觉回归，代价高于 11.6K（gzip 后约 3K）的体积
- 验收：data-cache 冷却生效（200/200 全绿）。

### 批次 8：极限项（最后执行）
- [x] text.js 真异步化（Text.ready 承诺加 35 模块初始化改造加契约测试重写）——放弃形态记录在案（system-audit 执行记录），defer 化已拿走大头
- [x] 运行时微优化：2.5.3 落地 cachedStatement 预编译缓存与 PRAGMA optimize/checkpoint 周期维护；serialize history 增量复用经实测评估不做（0.3ms 级 CPU，失效检测复杂度远超收益）
- [x] 真实故障演练：persist-failure-drill.test.js 完成（真实 SQLITE_BUSY 注入，验证 400 回滚、进程存活、state-rolled-back 广播、锁释放自愈）
- 验收：每项独立评估后单独出结论，不捆绑发版。

## 明确不做（除非触发条件，详见 AGENTS.md 第 8 节与战略台账）

- BEGIN IMMEDIATE 或连接池（触发：日志出现 SQLITE_BUSY 或第二常驻写进程）
- ~~图片 BLOB 出库~~（**2026-09-27 已部分实施**：tournament_event_media 8 行 8.1MB 已落盘为文件加 file_path，v34 迁移完成；账号头像/封面/频道小图维持 BLOB——量小且有上传事务优势。剩余大图 BLOB 仅角色立绘 2MB 上限一类，随上传量信号再评估）

## 状态日志

- 2026-09-20：建立路线图与 AGENTS.md 硬规约；批次 1 完成（gzip 协商、通讯测试补缺口 2 用例，测试基线 198 加至 200）。
- 2026-09-20：批次 2、4、6、7 完成（CSS 尾部拆分、文字收编加棘轮断言、schema.js 拆分加 v33 迁移、预取冷却），测试基线 201。
- 2026-09-20：生产就绪审计完成（docs/production-audit-2026-09-20.md，目标 2C2G 加 10M）。
- 2026-09-20：**批次 5 媒体治理完成**：match-intro 目录 18M 降到 3M（zhuifeng-base.mp4 重编码 7762K 降 683K、三份同文件与零引用原件删除、matchup-background 转 JPEG 1218K 降 76K），brand KV 2485K 降 304K，公共资产净减约 17M；teams 透明队标保留。
- 2026-09-20：**第三轮审计（后端性能深审）完成**（docs/backend-performance-audit-2026-09-20.md）。实测：常规端点 6ms 内、SQLite 热查询全索引覆盖亚毫秒（数据库非瓶颈）、内存 71MB 稳定；**核心发现：bp/bootstrap 单次约 35ms 同步阻塞事件循环（57 会话 × serialize 平均 0.72ms 累加），60 并发下排队 6.2 秒**。新增待办：bp/bootstrap 序列化缓存或剥离 history（半天，P1）；登录失败 Map 清扫（10 分钟，P3）。
- 2026-09-20：**第四轮审计（数据链路专项）完成**（docs/data-flow-audit-2026-09-20.md）：TTFB 毫秒级、Keep-Alive 复用正常、SSE 六端点零掉线、无大流量传输（全端点 wire 200K 内）。新增待办：hubs 与 bp 两条 SSE 流补心跳（P1，防代理静默断连）、keepAliveTimeout 显式设置（P1，反代后偶发 502）、安全响应头（P2）。
- 更正：此前判断"communication-service 无专项测试文件"有误，该文件已有 13 个用例（bootstrap 频道形态、私聊好友限制、身份频道、开发者检查、消息上限、分页、编辑、撤回审计、删除、加一、未读窗口），本批仅补缺口。
- 2026-09-20：**2.5.1 与批次 3 的协调规则登记**。2.5.1 各工作流（SSE 心跳、Keep-Alive、安全头、登录失败清扫、bootstrap 缓存）与批次 3 路由表化逐项评估结论：心跳与清扫落在骨架区既有挂点、Keep-Alive 与安全头在 handleRequest 入口，均随入口原样保留，零冲突；唯一交互点是 WS-E 的失效 bump 分布在约 10 个路由处理器内，路由表化时随处理器整体搬移。约束：1) WS-E 的 bootstrap 缓存对象做成独立模块（bp-bootstrap-cache）而非 server.js 内联状态，失效入口收敛为单一 bump 函数；2) WS-E 交付必须带"BP 操作后缓存立即失效"的自动化测试，作为批次 3 搬移时的保护网；3) 顺序规则：2.5.1 先行，批次 3 专项会话后做，两者不并行，server.js 执行期间冻结。
- 2026-09-20：**第五轮专项（BP 活跃期推送体积）审计完成**（data-flow-audit 第 9 节）：实测发现活跃 BP 期间 timer-tick 与呈现心跳每秒推送含完整 history 的全量 serialize（90 到 253K/秒/客户端），3 到 5 端并发即打满 10M 上行。修复设计已定（呈现心跳瘦身为状态包、tick 精简载荷、事件与快照剥离 history，客户端历史改惰性拉取，约 1 天，P0 直播期必做）。本条登记时 2.5.1（不含推送瘦身）已发布，推送瘦身为下一版本首项。
- 2026-09-27：**推送瘦身与数据链路三缺口全部落地（2.5.2）**：BP 活跃期推送瘦身（serialize 加 historyLimit、emitSession 缺省裁到最近 20 条、tick 走 0 裁剪，每秒推送从 90 到 253K 降到 2 到 6K；客户端 tick 改原地合并计时，bp-control v33）、hubs 与 bp 推送流 25 秒空闲心跳（实测 52 秒 2 次 ping）、keepAliveTimeout 720 秒加 headersTimeout 750 秒（反代兼容）、nosniff 加 X-Frame-Options 安全头（实测在位）、登录失败计数每日清扫。多端活跃期推送总带宽从最高 10.1Mbps 降到 0.1Mbps 内（降 99%）。同时订正第三轮报告的错误归因：bootstrap 36ms 的实际热点是 commentatorImages 解说席扫描（已加 5 秒 TTL 缓存，命中后 4ms），"serialize×57 累加"归因有误。
- 2026-09-27：**复查审计补遗（2.5.2 内）**：解说席图列表缓存的写路径失效钩子接线完成（素材导入、单条删除/改名、批量删除三路由调用 invalidateCommentatorImagesCache），新图上传后列表最长 5 秒内可见；复查扫描确认 bootprof 计时与 dataVersion 无残留、bp-original 构建输入已恢复、203/203 全绿。
- 2026-09-27：**收尾两项关闭（纯结构，不发版）**：1) control.html 内联 fetch-401 补丁外部化为共享 auth-guard.js（逐字同行为，defer 序列 text.js 之后、data-cache.js 之前，执行先于一切发请求模块，语义等价；AGENTS.md 第 5 节规约同步改写，新增 auth-guard-ui.test.js 两用例锁定），测试基线 203 加至 205。2) start-production.ps1 启动循环内新增 14 天前 server-*.log 轮转清理，覆盖崩溃重启循环下的日志无限增长（production-audit P0 日志轮转子项关闭）；残余边界：脚本连续健康运行超 14 天不停机时首日文件需下次重启或计划任务补扫。data/backups 按周轮转（production-audit 建议项）维持不做：现库仅 26M、目录内全是手动迁移快照，自动删除风险大于收益，触发条件为备份目录超 500M 或接入每日自动备份。
- 2026-09-28：**运行时微优化落地（2.5.3）**：db.js 新增 cachedStatement 语句缓存（bp-service writePersistedState 的 10 条固定 SQL 全部复用预编译语句），新增每小时 PRAGMA optimize 加 wal_checkpoint(TRUNCATE) 周期维护（unref 定时器，:memory: 库跳过），WAL 活跃期 10M 级膨胀不再长期占盘。serialize history 增量复用子项**评估后不做**：实测 3.2K 载荷单次序列化 34 微秒，每秒最坏 10 次推送合计 0.3ms 级 CPU（占单核 0.03%），失效检测复杂度远超收益。测试基线 209 加 statement-cache 3 用例。
- 2026-09-28：**真实故障演练完成**：新增 persist-failure-drill.test.js——spawn 真实服务器（文件库）加外部连接 BEGIN IMMEDIATE 持锁注入真实形态 SQLITE_BUSY，验证五点：锁下 BP 动作 400 且库事务整体回滚（status 仍 ready）、进程存活（health 200）、SSE 流收到 state-rolled-back 纠正广播、锁释放后同动作自愈成功。附带确认：新建会话的 persist 失败走内存移除（库中无行可回滚，无广播），属设计使然。测试场维度注意：attempt 2 是重赛语义（replayOf 标记，start 被拒），多会话演练用独立 room。
- 2026-09-28：**批次 3 路由表化执行至表链混合态**：router.js 两级分发（精确 Map O(1) 加参数化正则）接入 handleRequest，46 个端点表驱动（system/auth/session/presence/profile/social/notifications/operations/events/logs/window/character-stats 全部高频读路径），handler 以 ctx 解构头逐字搬移、全端点状态码矩阵每阶段锁定。sha256 ETag 媒体五组与剩余 materials/admin/communications/hubs/bp 写路径暂留 if 链（链兜底为正式形态，表命中优先），阶段 6 的 server.js 收缩顺延至剩余域迁完后执行；蓝图与矩阵保护网就位，增量续迁零协调成本。
- 2026-09-28：**批次 3 路由表化全量完成（续迁会话）**：communications（16 项含 SSE 与消息动作）、admin（21 项含账号/权限/通知/实验室/系统访问/角色管理）、materials（12 项，content Range 流留链）、hubs（6 项含 events SSE 与 actions 回滚事务）、bp（11 项含 bootstrap 缓存、三个 SSE、actions 全分支）、obs 写路径 2 项、bracket-image、events PUT 全部入表，累计 116 端点表驱动；链上仅剩既定边界清单——sha256 ETag 媒体五组（event media/profile media/channel avatar/character portrait/skill icon）、素材 content Range 流、BP 导出下载、shutdown 令牌特判、/hub/:id 重写与 sendShell。router.js 扩展 `:id#` 数字参数语法（等价原 `(\d+)` 正则，消息 id 与角色更新记录 id 的非数字段保持 404）；hub actions 的隐式全局 `action` 赋值按纯移动原则原样保留。验收：全量 209/209 绿、endpoint-matrix 矩阵通过、另起真实服务器 62 项只读探针（覆盖矩阵外全部迁移写路径）状态码逐项符合原语义。**剩余收尾单项：requiredPermission 退役**——表项 permission 字段尚未启用，权限门仍是骨架区 requiredPermission 全局前缀函数；其退役需先把媒体五组与导出/Range 流要么入表（带 permission 字段）要么在骨架内逐一挂权限，属边界清单调整，留待下次专项决策后执行。纯结构变更不发版。
- 2026-09-28：**批次 3 全部关闭——requiredPermission 退役**：权限改为 ROUTE_PERMISSIONS 声明表（键 "METHOD /模式" 共约百项，logs 按查询串、operations/:view 按段解析走 ({url, params}) 函数形态权限），骨架门改为"表命中读表项、表未命中读 residualPermission"（后者仅覆盖媒体五组、素材 content 流、BP 导出六类 GET 残留路径），requiredPermission 前缀函数删除；router.js 新增 hasRoute 启动断言，权限表键名漂移在启动期即抛错而非静默丢权限门。验收：改前改后三身份 135 端点 405 项状态码探针逐行零差异，209/209 全绿含 endpoint-matrix。附带确认：默认 operator 身份权限面宽，原前缀函数对"错误方法访问受限路径"的 403 兜底在真实身份下从未显现（本就落链尾 404），退役为零可观察行为差异。纯结构变更不发版。
- 2026-09-28：**文案收编债务关闭**：permissions-center.js 24 处加 notifications.js 8 处用户可见文案全部进目录（45 新键），两文件硬编码 UI 文案清零（仅存合规注释与 accounts.js 的 CSV 表头识别输入解析）；event-management.js 创建向导与赛程面板 HTML 文案经核实已收编，路线图 57 行债务记录关闭。event_media 空表经 v35 迁移删除（0 行、无写入路径，仅 v24 legacy 迁移读作源）；character_portraits 保留——BLOB 立绘是活功能且"明确不做"清单锁定随上传量信号再评估。
- 2026-09-28：**"数据解耦文字与图标丢失"排查报告与机制加固**：全维度实测（36 个前端 JS 语法全过、目录 1732 键完整无空值、control.html 661 个 data-text 键全命中、浏览器实测 8 个视图含截图：登录页/权限中心/通知面板/赛事管理/BP 控制台/BP overlay/倒计时 overlay/选手管理与素材库）——当前代码无任何文字或图标丢失；真实库媒体落盘 8 行文件全在。用户侧若见丢失，优先怀疑升级窗口期的浏览器缓存混合（硬刷新 Ctrl+F5）或生产进程未重启至 2.5.3（注意：2.5.2 旧进程重启会因库已 v35 拒绝启动，必须先部署新代码再重启）。机制加固两项：1) text.js apply 增加纯文本宿主守卫（宿主含子元素时跳过 textContent 替换并 console.warn，textContent 赋值清子元素正是"图标被吃"的唯一机制通道；实测守卫行为：图标宿主保留、纯文本宿主正常应用），text.js?v= 递增至 9；2) text-catalog-contract.test.js 新增 data-text 宿主纯文本契约（按宿主自身闭合边界扫描内联图标标签，当前 661 宿主零违规棘轮锁定），测试基线 209 加至 210。
