# AGENTS.md：AI 助手工作规约（硬约束）

本文件是给所有 AI 会话的强制规约。做任何改动前先读完本文件；与本文件冲突的做法一律以本文件为准。
背景材料：README.md、PRODUCT.md、DESIGN.md、docs/system-audit-2026-09-19.md（体检与优化全记录）、docs/performance-roadmap.md（优化路线图与批次状态）。

## 1. 项目形态

零 npm 依赖。后端 Node 内置 http 加 node:sqlite（单连接，WAL，数据 data/app.db）；前端原生 JS 无框架、无构建步骤（源码即产物）。任何引入依赖、构建器、框架的建议一律先停下询问用户。

## 2. 发版仪式（每次改完可感知内容必须走完）

1. data/update-log.json 新增版本条目：只写导播用户可见内容，最新版本必须在首位；内容超过约 10 条必须拆分版本号；bullet 一条一事。
2. package.json 与 server/release-service.test.js 的 currentVersion 断言同步。
3. 改动的 JS 与 CSS 在引用页递增 ?v= 版本参数；ui-text.json 内容变更时同步递增 public/assets/js/text.js 里的 TEXT_DATA_VERSION（当前写死 ?v=3）。
4. schema 变更时：db.js SCHEMA_VERSION 递增并新增迁移块，profile-migration.test.js（2 处）与 identity-catalog-migration.test.js（1 处）的 user_version 断言同步。

## 3. 文字解耦（用户立规，永久生效）

全部可变文字进 public/assets/data/ui-text.json，前端用 t() 或 window.text(键, 兜底)，HTML 用 data-text/data-text-placeholder/data-text-title/data-text-aria 声明，宿主必须是纯文本节点。operations-center.js 与 bp-control.js 源码禁止出现任何汉字（连注释都不行，character-stats.js 同）；写这些文件时注释一律用英文。存量未收编清单见 docs/system-audit-2026-09-19.md 第 11 节，新代码一律走目录。

## 4. 数据与事务规约

- 跨语句原子写入一律用 db.js 导出的 runTransaction(database, fn)（嵌套感知，内层并入外层）；不要手写 BEGIN/COMMIT。
- bp-service 的内存权威态有失败回滚保护（persist 失败自动从库重载并广播 state-rolled-back），新增变更方法必须继续走 this.persist，不要绕过。
- 会话存 auth_sessions 表（不是 app_settings 的 JSON，那是旧形态）；server.js 的 validateSession 有 15 秒进程内缓存，saveSessions 写时自动失效。
- 测试在 require 前设 process.env.STELLA_DB_PATH（':memory:' 或临时文件），绝不写真实 data/app.db。
- db.js 的 transactionDepths 声明必须在迁移链执行之前（迁移在模块加载期运行，放后面会 TDZ）。
- bp-service 的 ensureHistory 从库装载历史时会同步锚定增量持久化计数，改动装载逻辑必须保留该锚定，否则重启后历史会重复插入。

## 5. 前端加载规约

- 所有外部 script 带 defer，文档顺序即执行顺序，text.js 必须保持每页第一位；401 拦截由 auth-guard.js 统一承担（control.html 在 text.js 之后、data-cache.js 之前以 defer 引用，不要回退成内联补丁）。
- text.js 内部的同步 XHR 是契约测试锁定的行为，不要改成异步。
- pinyin-pro 是懒加载（search.js 动态注入），不要把它加回页面首载。
- 静态 js/css/ui-text.json 带 ETag 与 max-age 缓存并走 gzip 协商；其余 JSON 与 html 是 no-store，不要改。
- data-cache.js 是唯一请求入口：改请求逻辑必须保留 12 秒超时、GET 单次重试、写后失效映射。

## 6. 已知坑（全部实际踩过）

- server/bp-service.test.js 等测试文件底部有失败注入用例，改 persist/writePersistedState 签名要同步。
- control.css、control.html、bp-control.js 是 CRLF 且用户常手改，禁止整页覆写，改前 grep 确认落点。
- updateSlot 入参是 { slotId, field, characterId... } 对象，不是位置参数。
- BP 槽位与阶段 id 要从 bp_slots/bp_phases/bp_phase_slots 动态查，不要写死。
- 向 auth_sessions 种诊断会话：INSERT 一行（token 前缀 diag），用完 DELETE；不要写 app_settings。
- 删除任何文件前必须全库检索文件名引用（含 ps1 的 Add-Type/Join-Path 动态引用；CloudMusicAudio.cs 误删事故的教训）。
- 命令行 curl 带中文请求体会写坏编码，接口验证用 node 脚本或页内 fetch。

## 7. 验证要求

任何一批改动结束：node --test server/*.test.js 全绿才算完成；涉及时用只读探针（健康端点、curl）给出生效证据。当前测试基线 198 个，只增不减。

## 8. 性能优化边界

性能相关改动前先读 docs/performance-roadmap.md 的批次状态与 zfb-optimization-strategy 记忆台账：已完成的不许重复优化，明确不做清单里有触发条件，未到触发条件不要动。
