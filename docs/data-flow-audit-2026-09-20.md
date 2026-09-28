# 第四轮审计：数据链路专项（调用流动性、连通性、速度、传输体积）

日期：2026-09-20（2.5.0 运行中）
范围：API 调用流动性（请求响应周期与 Keep-Alive）、SSE 数据连通性与稳定性、调用速度分解（TTFB 与传输）、大流量传输排查、生产代理兼容性。全部结论来自当日在运行服务上的实测（TTFB 分解、SSE 六端点 40 秒窗口探针、五并发客户端、载荷普查）。

## 1. API 调用流动性（实测）

### 1.1 TTFB 分解（各 15 次，gzip）

| 端点 | TTFB 均值 | 总耗时均值 | 传输 |
| --- | --- | --- | --- |
| /（主控台 shell） | 7.2ms | 8.8ms | gzip |
| bp/bootstrap | 36.3ms | 37ms | gzip |
| character-stats | 3.1ms | 3.8ms | gzip |
| communications/bootstrap | 2.4ms | 2.6ms | gzip |
| notifications | 1.7ms | 1.9ms | gzip |
| logs（50 行） | 2.6ms | 3ms | gzip |
| operations/terminal | 23ms | 23.1ms | 无（492B） |
| friends | 0.9ms | 0.9ms | 无 |
| bp/presentation | 0.9ms | 1.1ms | gzip |

流动性结论：TTFB 与总耗时差值普遍在 1ms 内（响应一次性成型后快速下发，无分块迟滞）；压缩在服务端完成后流式下发正常。**唯一 20ms 级的是 operations/terminal（每 10 秒被主控台轮询），成因是系统信息采集本身，量级可接受。**

### 1.2 Keep-Alive（实测）

同连接连发 5 请求：首请求 4.8ms（含 TCP 握手），后续 1.1 到 1.3ms——连接复用正常，无重复握手开销。

## 2. SSE 数据连通性与稳定性（六端点 40 秒窗口探针）

| 端点 | 首字节 | 窗口内事件 | 字节 | 心跳 | 掉线 |
| --- | --- | --- | --- | --- | --- |
| session/events | 30ms | 1（初始） | 51B | 0 | 0 |
| notifications/events | 3ms | 1 + 心跳 2 | 65B | 2（25s 周期） | 0 |
| communications/events | 2ms | 1 + 心跳 1 | 52B | 1（25s 周期） | 0 |
| bp/events | 2ms | 1（初始 obs-status 等） | 198B | 0 | 0 |
| hubs/:id/events | 1ms | 1（初始 state） | 214B | 0 | 0 |
| bp/presentation/events | 2ms | 41（每秒心跳） | 8668B | 40（1s 周期） | 0 |

连通性结论：六端点全部秒级出首事件，40 秒零掉线零错误；5 并发 hub 客户端 40 秒合计仅 1070B（每客户端 214B），聚合带宽可忽略。

**发现（P1）：hubs/events 与 bp/events 没有心跳**。空闲时连接完全静默，中间代理与 NAT（典型 60 秒空闲超时）会掐断静默连接；浏览器自动重连加 onopen 补拉可以恢复，但会形成"断连窗口"。建议给这两条流加注释行心跳（`: ping\n\n`，15 到 25 秒周期），与 communications/notifications 的既有节奏对齐。约 2 小时。

## 3. 调用数据的速度

TTFB 均值即服务端处理时间：常规接口 1 到 3ms；bp/bootstrap 36ms（序列化累加，见第三轮审计第 4 节）；operations/terminal 23ms（系统信息采集，10 秒轮询一次）。压缩已在服务端完成（TTFB 含压缩），传输在 10M 带宽下：主控台全量约 75K wire，0.06 秒。

## 4. 大流量传输排查

1. 全端点载荷普查：最大响应为页面 shell 182K（wire 34K gzip），其次 bp/bootstrap 112K（wire 18K）、character-stats 113K（wire 19K）；无任何端点超过 200K wire。
2. 媒体端点：角色立绘 BLOB 表 0 行、赛事媒体 0 行——大 BLOB 传输端点当前空载；用户头像 1 行（上限 600KB）走独立缓存端点。
3. 页面媒体：主控台 263K、登录页 310K（KV 已压缩）、bp-overlay 683K 视频（OBS 一次性加载）——均非反复传输。
4. SSE 聚合：全端点心跳加事件合计约 0.5KB/秒/客户端量级，无大流量形式传输。
结论：**不存在大流量传输问题**；传输层最大风险（明文 API）已在 2.5.0 由全链路 gzip 消除。

## 5. 生产代理兼容性缺口（代码层）

1. **keepAliveTimeout 未设置**（Node 默认 5 秒）：反代（nginx 默认上游空闲 60 秒）复用超过 5 秒的连接会偶发 502。建议 server.listen 后设置 `server.keepAliveTimeout = 720000; server.headersTimeout = 750000;`。10 分钟。
2. **零安全响应头**：建议加 X-Content-Type-Options: nosniff 与 X-Frame-Options: SAMEORIGIN（不冲突系统自身的 iframe 预览；注意 OBS 源页面同源不受影响）。约 30 分钟。
3. 登录失败限速的内存 Map 无过期清扫：加定时清扫，10 分钟。

## 6. 写路径与并发（分析性结论）

单连接 SQLite 天然串行化全部写入，runTransaction 提供嵌套感知原子边界；180 并发读实测零失败零 BUSY。写并发场景（多人同时操作）由 busy_timeout 5 秒兜底，队列化执行；本轮未对真实数据做并发写压测（避免污染业务数据），写入争用的行为已有 try/catch 加回滚加纠正广播兜底。

## 7. 发现汇总

| 级别 | 发现 | 建议 | 工作量 |
| --- | --- | --- | --- |
| P1 | hubs/events 与 bp/events 无心跳，静默断连风险 | 加注释行心跳（15 到 25 秒周期） | 2 小时 |
| P1 | keepAliveTimeout 默认 5 秒，反代后偶发 502 | 显式设置 720 秒加 headersTimeout | 10 分钟 |
| P2 | 零安全响应头 | nosniff 加 X-Frame-Options: SAMEORIGIN | 30 分钟 |
| P3 | 登录失败 Map 清扫；CSP 策略 | 择机 | 小 |

## 8. 结论

数据链路的流动性、速度与传输体积三项全部达标：TTFB 毫秒级、Keep-Alive 复用正常、SSE 零掉线、全端点 wire 体积 200K 内、无大流量传输。连通性有一个稳定性缺口（两条 SSE 流无心跳，代理静默断连）和一个生产代理兼容缺口（keepAliveTimeout），加上安全响应头，合计约 3 小时工作量即可补齐；完成后数据链路达到公网部署标准。

## 9. 第五轮专项：BP 活跃期推送体积实测（发现大流量堵塞）

第四轮结论"无大流量传输"覆盖的是**空闲与常规读取**场景；本轮对**活跃 BP（计时运行中）**的推送链路实测后推翻其中一部分：BP 活跃期存在持续的大流量推送。

### 9.1 载荷构成实测（真实库副本，46 个可序列化会话）

serialize() 的 clone 含完整 history（每条历史自带整会话快照），因此事件载荷随历史长度线性膨胀：

| 会话 | 历史条数 | session 事件 JSON | gzip 后 | 剥离 history 后 |
| --- | --- | --- | --- | --- |
| mobile-2026-08-01-sf-winner-1 | 157 | 253K | 8K | 2K |
| pc-2026-08-01-sf-winner-1 | 154 | 243K | 7K | 2K |
| pc-2026-07-26-qf-1 | 121 | 187K | 6K | 2K |
| 平均（46 会话） | — | 90K | 约 3K | 2K |

### 9.2 推送链路与带宽估算

活跃 BP、计时运行中，每秒两条链路同时推全量载荷：

1. bp/events 的 timer-tick：每秒 emitSession → serialize（90 到 253K）→ JSON 后向每个 bp 客户端写（SSE 不压缩）。
2. bp/presentation/events 的 1 秒心跳：payload 含 active 会话的完整 snapshot（同一 serialize），同样 90 到 253K。

带宽估算（10M 上行 1.25MB/s）：

| 场景 | 每秒推送 | 占用上行 |
| --- | --- | --- |
| 平均会话 × 1 客户端 | 90KB/s | 0.70Mbps |
| 最重会话 × 1 客户端 | 253KB/s | 1.98Mbps |
| 最重会话 × 5 客户端 | 1265KB/s | **10.1Mbps（上行饱和）** |

结论：**BP 活跃期确实存在"信息太多堵塞"**——3 到 5 个 OBS 加控制端同时在线时，仅 timer-tick 与呈现心跳就打满 10M 上行，且每秒 57 次 JSON 结构里 97% 是 history 快照（对客户端渲染无用的冗余）。CPU 成本（每秒一次 0.7 到 2ms 的 serialize 加 stringify）反而次要。

### 9.3 修复设计（P0，直播期必做）

1. **呈现流心跳瘦身**：bp/presentation/events 的 1 秒心跳只带 serverTime、sequence、playing 状态（小于 200B），客户端发现 sequence 变化再按需拉快照——心跳从 253K 降到 0.2K。
2. **timer-tick 精简载荷**：tick 每秒只推 timer 剩余秒数加 revision（约 0.3K），客户端 renderHeader 原地更新时钟；full serialize 仅在动作事件（slot-updated 等，用户操作频率）发送。
3. **动作与快照事件剥离 history**：serialize 加 historyLimit 参数——SSE 事件与呈现快照默认不带 history（客户端历史面板改惰性拉取 /api/bp/sessions/:id/history 端点，该端点已有），restore 依赖的最近 20 条可保留在动作事件内。
预期：活跃 BP 的推送总带宽从最高 10.1Mbps 降到 0.1Mbps 内（降 99%），10M 上行从饱和回到空闲。工作量约 1 天（含客户端惰性历史拉取改造与回归测试）。

### 9.4 数据库与 CPU 影响复核

serialize 的 CPU 成本（每秒 0.7 到 2ms）与 SQLite 读（热查询亚毫秒）在活跃期均非瓶颈；瓶颈纯在传输体积。剥离 history 后 JSON 序列化成本同步下降（clone 不含 history 数组），CPU 与带宽同时受益。
