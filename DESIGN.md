---
name: 星澜赛事导播系统
description: 面向赛事现场操作员的浅色、克制、精确的本地导播工作台。
colors:
  primary: "#0078d4"
  primary-hover: "#106ebe"
  primary-active: "#005a9e"
  status-green: "#107c41"
  status-red: "#d13438"
  warning-orange: "#d83b01"
  collaboration-purple: "#6264a7"
  signal-rose: "#c2396b"
  text-primary: "#323130"
  text-secondary: "#605e5c"
  text-tertiary: "#8a8886"
  text-on-accent: "#ffffff"
  page: "#f3f3f3"
  card: "#ffffff"
  subtle: "#faf9f8"
  border: "#e0e0e0"
typography:
  display:
    fontFamily: "Segoe UI, Microsoft YaHei UI, Microsoft YaHei, Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontFamily: "Segoe UI, Microsoft YaHei UI, Microsoft YaHei, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.5
  title:
    fontFamily: "Segoe UI, Microsoft YaHei UI, Microsoft YaHei, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.5
  body:
    fontFamily: "Segoe UI, Microsoft YaHei UI, Microsoft YaHei, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Segoe UI, Microsoft YaHei UI, Microsoft YaHei, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.5
  mono:
    fontFamily: "Cascadia Code, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  nav: "10px"
  pill: "999px"
  circle: "50%"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text-on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
    height: "36px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
    height: "36px"
  input-default:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "38px"
  card-default:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "24px"
  status-pill-online:
    backgroundColor: "rgba(16, 124, 65, 0.10)"
    textColor: "{colors.status-green}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "28px"
  navigation-item-active:
    backgroundColor: "rgba(0, 120, 212, 0.12)"
    textColor: "{colors.primary}"
    typography: "{typography.body}"
    rounded: "{rounded.nav}"
    padding: "0 10px"
    height: "36px"
  profile-quick-link:
    backgroundColor: "color-mix(in srgb, {colors.primary} 5%, white)"
    textColor: "{colors.text-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 11px"
    height: "34px"
  segmented-selected:
    backgroundColor: "{colors.card}"
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "0 12px"
    height: "32px"
  toggle-enabled:
    backgroundColor: "{colors.status-green}"
    rounded: "{rounded.nav}"
    height: "20px"
    width: "38px"
  account-status:
    backgroundColor: "rgba(255, 255, 255, 0.72)"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "4px 6px 4px 5px"
    height: "42px"
---

# Design System: 星澜赛事导播系统

## Overview

**Creative North Star: "本地导播工作台"**

星澜的界面像一张长期值守的本地控制台：安静、精确、明亮、中性且实用。内容密度服务于快速扫描和连续操作，身份、权限与连接状态先于个性表达；个人中心是操作员确认值班身份并配置工作入口的账号工作站，而不是社交资料页。

视觉系统是既有 Operate UI 的 code-first 延伸。它继承浅色卡片、星澜蓝状态语义、克制的线性运动与逐层进入，不引入独立的个人品牌语言，也不让装饰干扰运行状态和恢复路径。

**Key Characteristics:**

- 浅色冷中性画布与清晰白色工作面
- 星澜蓝主状态，绿色成功、红色异常
- 8px 内容卡片与紧凑、直接的表单控件
- 环境感、浅层的阴影，不做戏剧化悬浮
- 适合桌面值守、窄窗口和键盘操作的响应式结构

**The Workstation Rule.** 每个个人化选择都必须强化工作身份、登录落点或常用入口，不能把账号工作站改造成社交档案。

## Colors

色彩以星澜蓝为唯一主声音，辅以语义明确的绿、红和冷中性表面；紫与玫红只作为用户可选强调色，不改变全局状态含义。

### Primary

- **星澜蓝:** 用于主操作、当前导航、等待状态、焦点边框和个性强调的默认值。
- **深星澜蓝:** 用于主要按钮悬停，保持状态连续而不引入新色相。
- **沉星澜蓝:** 用于按下状态，提供短促、明确的操作反馈。

### Secondary

- **状态绿:** 表示 HUB/OBS 在线、保存成功与已启用开关。
- **状态红:** 表示连接失败、错误、危险动作与退出操作。
- **警示橙:** 保留给警告和需要注意但尚未失败的状态。
- **协作紫 / 信号玫红:** 仅作为个人强调色选项，不能替代绿、红的语义职责。

### Neutral

- **深墨正文:** 承载标题、主要正文和高置信信息。
- **中性灰:** 承载说明、岗位和次要操作信息。
- **弱化灰:** 承载占位、未激活状态和低优先级元数据。
- **冷灰画布:** 作为全局页面底色，衬托白色工作面。
- **卡片白:** 用于卡片、输入和选中分段控件。
- **浅雾面:** 用于只读字段、分段控件底槽和弱层级分区。
- **冷边界:** 用于输入、分隔线和低对比边框。

**The Blue Means State Rule.** 星澜蓝必须指向主操作、当前项、焦点或进行中状态，不把它扩散成大面积装饰背景。

**The Semantic Status Rule.** 在线与成功始终用绿，异常与危险始终用红；个人强调色不得重写这些状态。

## Typography

**Display Font:** Segoe UI（回退至 Microsoft YaHei UI、Microsoft YaHei、Arial、sans-serif）  
**Body Font:** Segoe UI（回退至 Microsoft YaHei UI、Microsoft YaHei、Arial、sans-serif）  
**Label/Mono Font:** Cascadia Code（回退至 Consolas、monospace）仅用于日志会话和机器信息

**Character:** 系统字体保持 Windows 本机感和中文可读性。层级依赖字重、字号和中性灰度，不使用装饰字体、负字距或夸张标题。

### Hierarchy

- **Display**（700，24px，1.2）：页面标题与个人身份名称；窄屏页面标题降至 21px，身份名称降至 20px。
- **Headline**（700，18px，1.5）：卡片标题和主要模块标题。
- **Title**（700，14px，1.5）：品牌标题与紧凑区域中的强标签。
- **Body**（400，14px，1.5）：默认界面正文；身份简介限制在约 68ch 内。
- **Label**（600，12px，1.5）：字段标签、状态、按钮和辅助控制；低优先说明可降至 11px。
- **Mono**（400，11px，1.5）：日志会话、细节和需要逐字符辨认的数据。

**The Scan-First Type Rule.** 先用字重和灰度表达层级；不以超大字号、全大写或紧缩字距制造视觉戏剧性。

## Layout

桌面框架使用左侧固定导航和右侧主工作区。导航距视口 12px，展开宽度 200px，折叠为 68px 轨道；主区与导航保留 24px 间距。页面头部最小高度为 64px，右上角持续显示头像、姓名、权限身份及 HUB/OBS 连接状态。

个人主页内容最大宽度为 1260px，外边距 24px。顶置图与头像构成主要身份层，下方依次是可选赛事统计、公开资料与执行记录；设置不占用主页版面，而是通过模糊微透明的阻断式模态集中管理。表单内部使用 4px 基线的 4/8/12/16/20/24px 节奏。

通讯工作区在桌面使用两张同层级主卡片，以 2:8 分配频道导航与当前会话；左卡片只承担频道选择和创建入口，右卡片按“会话头部、可滚动消息流、固定输入区”纵向组织。空间开始收紧时先为频道栏保留可扫描的最小宽度，再缩为约 1:3；在 760px 及以下改为上下排列，频道行进入横向滚动轨道，消息流保持主要高度，不能把不可操作的窄 2:8 结构带到移动端。

在 900px 及以下，导航固定为图标轨道，头部纵向排列，个人主页内容改为单列，页面内边距降至 16px。在 560px 及以下，页面内边距降至 12px；身份层、统计网格、公开资料和设置模态全部重排，操作按钮占满可用宽度。结构顺序始终是确认身份、查看履历、阅读公开资料，再进入设置。

**The First-Viewport Rule.** 顶栏身份和连接状态必须持续可扫描；桌面首屏必须呈现身份概览及两张配置卡的入口，而不是欢迎式大标题或社交封面。

## Elevation & Depth

系统采用“环境感且浅层”的混合深度：冷灰画布与白色卡片先建立层级，低透明阴影只补充分离。普通卡片保持近乎平坦，身份概览可使用略宽但仍克制的环境阴影；浮动导航是更强一级的壳层，而不是内容卡片的默认模板。

### Shadow Vocabulary

- **卡片微影** (`0 1px 3px rgba(0, 0, 0, 0.04)`): 普通卡片和开关滑块。
- **控件中影** (`0 2px 8px rgba(0, 0, 0, 0.06)`): 需要额外分离的紧凑控件或短暂层级。
- **悬停浅影** (`0 4px 12px rgba(0, 0, 0, 0.10)`): 仅用于确有抬升反馈的交互表面。
- **身份概览环境影** (`0 8px 24px rgba(15, 35, 60, 0.07)`): 个人中心身份概览的轻量强调。
- **导航壳层影** (`0 12px 32px rgba(15, 35, 60, 0.10), 0 2px 8px rgba(15, 35, 60, 0.06)`): 固定侧栏与其页面背景分离。

**The Shallow-by-Default Rule.** 内容层级先靠表面色和边界表达，阴影不能成为每个容器的装饰轮廓。

## Shapes

内容界面的形态克制而直接：小控件用 4px，按钮、输入和选择项用 6px，卡片统一用 8px。10px 仅用于导航项和开关轨道；圆形只用于头像、状态点、色板和明确的圆形图标按钮。浮动侧栏的 18px 与飞出菜单的 14px 是导航壳层的既有例外，不能扩散到内容卡片。

边界以 1px 冷灰或低透明黑为主。选中态通过轻量混色背景和更清晰的边框表达，避免粗描边；药丸形只用于角色、状态等短标签，不用于普通命令按钮。

**The Eight-Pixel Card Rule.** 所有工作内容卡片保持 8px 圆角；更大的圆角只属于导航壳层，不能用来制造卡片套卡片的软糖外观。

## Components

### Buttons

- **Shape:** 直接、紧凑的 6px 圆角，最小高度 36px，常规内边距 8px 16px。
- **Primary:** 星澜蓝底配白字，用于单一主要提交；悬停进入深星澜蓝，按下缩放至 0.97。
- **Hover / Focus:** 背景、边框使用 120ms ease；表单相关隐藏输入的代理按钮使用 2px 星澜蓝系焦点轮廓与 2px offset。
- **Secondary / Danger:** 次要按钮透明底、冷灰边框；危险按钮白底红边红字，悬停只加 8% 红色底。

### Chips

- **Style:** 状态和角色标签使用短文本、600 字重与药丸轮廓；在线状态为 10% 状态绿底，角色标签使用当前个人强调色的浅混色。
- **State:** 点状状态标记与文字同色；等待、在线、异常分别使用蓝、绿、红，不依赖文字之外的颜色变化。

### Cards / Containers

- **Corner Style:** 工作卡片统一 8px。
- **Background:** 白色卡片位于冷灰画布上；只读字段和分段底槽使用浅雾面。
- **Shadow Strategy:** 普通卡片使用卡片微影，身份概览使用身份概览环境影。
- **Border:** 1px 低对比边界；个人强调只轻微混入身份概览边框。
- **Internal Padding:** 常规 24px，紧凑模式与窄屏概览为 16px。

### Inputs / Fields

- **Style:** 白底、1px 冷灰边框、6px 圆角、高度 38px、水平内边距 12px；文本域保持同一语言并允许垂直调整。
- **Focus:** 边框转为星澜蓝，并出现 `0 0 0 3px rgba(0, 120, 212, 0.12)` 焦点环。
- **Error / Disabled:** 错误信息使用状态红；只读身份字段使用浅雾面和弱边界，不伪装成可编辑输入。

### Navigation

展开态为 200px 固定侧栏，窄屏与折叠态为 68px 图标轨道。导航项高 36px、10px 圆角，默认中性灰；悬停使用 7% 蓝色底，当前项使用 12% 蓝色底、星澜蓝文字和 600 字重。分组通过 260–320ms 的线性层级展开，折叠态用飞出菜单恢复文字导航。

### Communications Workspace

- **Channel Rows:** 频道按公共、私聊和自建分组，单行包含头像、名称、单行摘要与未读数；当前频道使用浅蓝选中面，长名称和摘要省略而不撑开左栏。频道行是列表项，不再套入独立卡片。
- **Message Flow:** 会话头部持续显示频道名称、类型和实时连接状态；消息流独立滚动，靠近顶部时自动读入更早消息并保持当前位置，不出现“加载更多”按钮。自己的消息只用浅蓝气泡区分，双方消息均保留发送者、身份和时间元数据。
- **Composer:** 输入区固定在会话卡片底部，文本域、字符计数与图标发送按钮形成一个整体。第一版只发送纯文字，每条最多 500 个 Unicode 字符；换行必须保留，连续长字符串使用任意点换行，绝不能造成气泡或页面横向溢出。
- **Realtime State:** 使用紧凑的“连接中 / 实时 / 正在重连”状态指示通信链路，不用遮挡消息流的全屏提示；新消息更新未读与当前会话，连接恢复过程必须可见。
- **Create Dialog:** 创建入口打开原生阻断式对话框，以分段控件切换私聊和自定义频道。联系人使用头像、姓名、身份说明与原生单选或复选控件；无可选好友时显示明确空状态并禁用提交。
- **Loading / Empty / Error:** 频道列表和消息流分别具备加载、空、错误与禁用状态。错误态提供就地重试，空态说明下一步，输入区在没有可写频道或请求进行中时保持禁用，不能用空白区域或单独的“-”代替状态。

### Account Status

顶栏账号状态由独立 50px 圆形头像与右侧三行信息面组成：昵称、身份与岗位、HUB/OBS 连接状态。头像是个人主页入口。个人主页增加顶置图、地区、公开资料、赛事统计和执行记录；账号修改需要当前密码，权限身份保持只读。

### Selection Controls

设置模态使用左侧分类标签和右侧表单面板；主页统计使用带原生复选框的选择项，地区项固定选中且不可关闭。所有隐藏文件输入都必须通过相邻可见按钮提供清晰的 `:focus-visible` 轮廓，模态打开时阻断下层操作并在关闭后归还焦点。

动效只解释层级与状态：页面子层以 320ms 标准缓动从 14px 下方逐层进入，间隔 45ms 左右；导航和选择控件使用 120–320ms 的短过渡。角色排行榜行使用独立的 580ms 动画与 90ms 层间间隔，不能修改全局页面进入速度；实时更新仅在名次顺序变化时重播榜单动画。`prefers-reduced-motion: reduce` 时取消非必要动画和过渡。

## Do's and Don'ts

### Do:

- **Do** 让身份、权限和 HUB/OBS 连接状态在任何页面首屏都可快速确认。
- **Do** 沿用星澜蓝主状态、绿成功、红异常的固定语义。
- **Do** 使用 4/8/12/16/20/24px 间距节奏和 8px 内容卡片。
- **Do** 让桌面双列在 900px 以下收为单列，并在 560px 以下重排状态与操作。
- **Do** 让通讯工作区的消息流占据主视觉，并持续显示连接状态、未读和 500 字字符计数。
- **Do** 使用短促、线性的层级动效，并完整尊重 reduced motion。

### Don't:

- **Don't** 把个人中心做成社交资料页、营销欢迎页或脱离导播任务的个性展示。
- **Don't** 发明新的主色、渐变主视觉、深色玻璃体系或大面积高饱和背景。
- **Don't** 用个人强调色替代在线、成功、异常和危险状态的固定颜色。
- **Don't** 把浮动导航的 14–18px 圆角复制到工作内容卡片，或制造卡片嵌套卡片。
- **Don't** 用手动“加载更多”、不可见的连接失败或单行截断代替通讯页的渐进历史加载、实时状态和长消息换行。
- **Don't** 以强阴影、弹跳或长距离运动干扰连续值守和状态扫描。
