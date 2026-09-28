# 生产就绪审计报告（2 核 2G、10M 带宽目标）

日期：2026-09-20
目标环境假设：2 核 CPU、2GB 内存、10Mbps 带宽（上行 1.25MB/s）；并发规模按导播团队 10 到 30 人加 3 到 5 个 OBS 源评估；局域网或小规模公网访问。若实际为公网直接暴露，P0-3（登录限速）与 TLS 反代为硬性前提。
方法：全部结论来自当日在运行服务上的实测（curl 体积、进程内存、数据库直查、四页渲染截图）加定向代码检索；诊断会话用后即删，零数据写入。

## 1. 基线实测

| 维度 | 实测 | 对 2C2G/10M 的含义 |
| --- | --- | --- |
| Node 进程内存 | RSS 75MB | 2GB 内存余量巨大，无压力 |
| 数据库 | 17.2MB 加 WAL 1.6MB，quick_check ok | 磁盘与缓存占用可忽略 |
| 日志增长 | 审计约 19 行/天、OBS 约 8 行/天、BP 历史 57 行/天 | 两年不足 10 万行，暂不需要保留策略 |
| 静态资源 | gzip 已生效（CSS 降 85%） | 传输已优化 |
| 测试 | 201/201 全绿 | 回归有保障 |

## 2. 发现一：带宽（10M 是最紧的约束）

### P0-1 API 与页面 shell 完全没有压缩（最高优先）
实测明文体积：主控台 shell 182145B、bp/bootstrap 112633B、character-stats 113047B、审计日志接口 51948B、update-log 18856B、通讯 bootstrap 16207B。批次 1 的 gzip 只覆盖了 /assets/ 静态目录；sendJson（全部 API JSON）与 sendShell（页面 shell）都不压缩。一次主控台完整加载约 430KB 明文，10M 上行多人并发时线性放大。
建议：sendJson 按请求 Accept-Encoding 走 zlib.gzip（异步，2 核线程池足够）；sendShell 同样处理。预计 shell 182K 降到约 50K、JSON 降到约三成。工作量约半天，风险低（304 与 ETag 语义不变）。

### P1-1 登录页 KV 图 2.4MB
brand/kv-board.jpg 2485KB，未登录首屏单独就要约 2 秒。建议压到 400KB 内（System.Drawing 降质或预生成 1600 宽版本）。约 1 小时。

### P1-2 大图治理（含实锤重复文件）
大于 500KB 的媒体 11 个：最大是 teams 两张 1.3MB 的队标 PNG 与 match-intro 背景组。哈希实证 bp-background.png、bp-layout/base.png、bp-original/base.png 三份是同一文件（sha1 598990719fc9，各 1.26MB），去重可省 2.5MB。zhuifeng-base.mp4 7.7MB 只在 bp-overlay（OBS 源，一次性加载可接受）。
建议：去重三份同文件（改引用路径，需按规约先查引用）；大 PNG 按透明度要求转 JPEG 或压缩，逐图视觉核对。约半天加视觉核对。

### P1-3 SSE 心跳（可接受，记录在案）
bp 呈现心跳每秒约 2.8KB/客户端，10 个观看端约 0.23Mbps，10M 下无压力。无需改动。

## 3. 发现二：内存与 CPU（2C2G 判定：无结构性风险）

- 进程 RSS 75MB，SQLite 页缓存默认 2MB，SSE 每连接开销为套接字加缓冲，30 连接内无压力。
- 需要补的稳定性项见发现四（uncaughtException 守卫与定时器之外的未知抛出路径）。
- gzip 的 CPU 成本：异步 zlib 走 4 线程池，单次 167K CSS 约 2 到 5ms，2 核下并发可承受；若未来 CPU 紧张可换预压缩文件。

## 4. 发现三：存储与数据库（结论：结构不需要再改）

v33 已收口全部遗留（昵称 NOT NULL、slot 域 CHECK、sync_records 主键、外键策略、视图重解析问题）。表结构、索引、约束达到生产标准。
剩余是运维性而非结构性：
1. 备份策略：建议每日 VACUUM INTO 到 data/backups 加按周轮转（现有习惯的固化）。
2. 日志增长缓慢（见基线），保留策略可两年内不做。
3. WAL 1.6MB 正常；可在启动时加一次 PRAGMA optimize（一行，低成本）。

## 5. 发现四：生产化代码规范缺口

1. 无 process.on('uncaughtException') 与 unhandledRejection 守卫：已知的抛出路径都已加固（主 handler、tick、阶段推进定时器），但流式错误等未知路径仍会退出进程。生产环境建议加守卫记日志不退出（与主 handler 兜底同等语义），配合自动重启的进程守护。
2. 进程守护与自启缺失：当前是裸 node 后台进程，退出后无人拉起。建议任务计划程序或 NSSM 服务化，崩溃自动重启加日志按天分割（当前 stdout 重定向追加，无轮转）。
3. 登录无速率限制：/api/auth/login 无失败锁定。局域网风险低，公网暴露则有爆破面。建议内存级计数（账号加 IP 维度，5 次失败锁 10 分钟），约 2 小时。
4. /api/system/shutdown 有独立令牌守卫（x-stella-token，未配置令牌时恒 403），设计安全；上线时确保令牌不外泄或干脆不配置。
5. 建议反代 TLS（nginx 或 caddy 终结 HTTPS）：server 已支持 x-forwarded-proto 判定安全 Cookie，反代后 Secure 标记自动生效。
6. OBS 公开端点（/api/bp/presentation/events、/api/hubs/:id/events）无鉴权属设计使然（OBS 源需要），公网部署时注意路径可见即可，无敏感数据。

## 6. 发现五：UI 美化与完善审计（design-taste-frontend 加 vercel 界面规范）

四页截图逐项对照两套技能标准复核。总体结论不变：设计体系成熟（token 变量、单一蓝色 accent、克制动效、信息密度健康），四页渲染全部正常（登录 KV、主控台真实数据、倒计时透明源、BP 待机舞台），无需美化级重构。需要修的是可访问性与声明类细节：

1. 登录输入框焦点不可见（login.css:458 同时清掉 outline 与 box-shadow 且无替代）：vercel 规范 Focus States 条目硬伤，键盘用户不可用。建议补 :focus-visible 焦点环。约半小时。
2. 全站缺 color-scheme 与 theme-color 声明：Windows 深色系统下原生控件反色错乱。四页 head 各加一行。约 20 分钟。
3. 登录密码框无可访问名称（label 内仅 aria-hidden 图标）且缺 autocomplete="current-password"。约 20 分钟。
4. focus-visible 体系缺口：components.css、login.css、dialog-theme.css 无焦点样式，统一补焦点环变量。约 1 小时。
5. 登录页粒子与入场动效未接 prefers-reduced-motion（design-taste 第 6.B 强制项）。约 1 小时。
6. 新增确认：登录页 KV 2.4MB 同时是体验问题（design-taste 第 6.D Core Web Vitals：LCP 约 2 秒超标），与 P1-1 同一件事。
7. 通过项（持续有效）：transition:all 零命中、无禁缩放、无内联 onclick、control 109 个 aria-label、tabular-nums 广泛使用、装饰图 alt 处理正确、overscroll 覆盖弹窗、单一 accent 锁定、无 AI 味签名。

## 7. 上线前清单（按序）

| 序 | 项 | 工作量 | 优先级 |
| --- | --- | --- | --- |
| 1 | sendJson 与 sendShell 加 gzip | 半天 | P0 |
| 2 | uncaughtException 守卫加进程守护与日志轮转 | 半天 | P0 |
| 3 | 登录失败限速 | 2 小时 | P0（公网必做） |
| 4 | login KV 压缩 | 1 小时 | P1 |
| 5 | 大图去重与压缩 | 半天加核对 | P1 |
| 6 | UI 可访问性五项修复 | 2 到 3 小时 | P1 |
| 7 | 部署文档（反代 TLS、备份、守护） | 2 小时 | P1 |
| 8 | 启动加 PRAGMA optimize | 10 分钟 | P2 |

合计约 2 到 3 个工作日后可上线。数据库结构不需要再动。

## 8. 复查审计（修复完成后的验证轮，同日）

对第 1 到 7 节的全部修复逐项实测复核，并扫描修复是否引入新问题。

### 复实测（全部达标）
| 项 | 修复前 | 复查验值 |
| --- | --- | --- |
| 主控台 shell 传输 | 182145B 明文 | 33852B（gzip，降 81%） |
| bp/bootstrap | 112633B 明文 | 18157B（降 84%） |
| character-stats | 113047B 明文 | 18621B（降 84%） |
| 通讯 bootstrap | 16207B 明文 | 1690B（降 90%） |
| 审计日志接口 | 52170B 明文 | 2658B（降 95%） |
| 登录 KV 图 | 2485K | 310K（降 88%） |
| 进程内存 | 75MB | 71MB |
| 登录限速 | 无 | 第 6 次失败实测 429，未触发账号不受影响 |
| 异步文案 | 同步阻塞 | 四页渲染零键名泄漏，主控台标题渲染目录值 |

### 在位性扫描
十个工作流的关键标记全部在位：sendJson 与 sendShell 的 Content-Encoding（4 处）、末级守卫（4 处）、每日维护（3 处）、限速（LOGIN_RATE_LIMITED）、四页 color-scheme、Text.ready（4 文件）、pageCopy 键存储（31 键）、event-management 汉字仅剩注释行、deployment.md 与 start-production.ps1 双双在位。

### 复查发现并修复的新问题
1. **build-bp-shells.py 构建输入被误删**：脚本通过目录拼接动态引用 bp-original 源图（与 CloudMusicAudio.cs 事故同类的动态引用形态），此前的去重删掉了构建输入。已从 git 恢复 bp-original 目录与 bp-layout 的 base、cover、sample 三张（磁盘加回约 6.5MB；该批净收益仍约 10.5MB）。教训重申：查引用必须覆盖"目录拼接动态构造路径"的脚本形态。
2. text.js 异步化后，control.js 初始页标题会渲染键名（初始激活先于文案就绪）——已在 Text.ready 后补当前页标题重渲染；bp-control 与 logs-control 直读 window.UI_TEXT 的两处补可缺省守卫。

### 复查后的遗留清单
1. 批次 3（server.js 路由表化）：唯一未执行的重构项，设计已定于路线图，需专项会话。
2. teams 透明队标（355K 到 1.3M）：透明度必需，体积为内容固有，保留。
3. 文字解耦剩余：event-management 已收编完毕；control.html 42 个非目录中文节点为 JS 动态覆写的初始态与标题等，棘轮基线已锁定不再增长。
4. 数据库：结构无需再改，v33 加运维任务（每日 optimize 加 checkpoint）已上线。

### 复查结论
生产就绪审计的全部 P0 与 P1 项已实施并经实测验证，2.5.0 运行稳定（202/202 测试、四页渲染正常、零键名泄漏、限速与压缩实测生效）。系统达到 2C2G 加 10M 目标环境的部署标准；剩余仅路由表化一项可维护性重构。
