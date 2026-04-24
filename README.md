# KTV 家庭点歌系统

手机扫码点歌 → 百度盘按需下载 → 本地存储 → mpv 播放 → 电视显示 + 音响出伴奏。

**架构**：单个本地 Node.js 应用管一切（backend + OpenList + mpv），NAS 可选充当存储。适合个人用，也适合打包后分享给其他人。

完整设计见 [实施方案](../../Users/huanc/.claude/plans/floating-baking-snail.md)。

## 当前状态

**M0 Brown M&M** — 手工验证最高风险路径，**尚未完成**。业务代码写前先跑通下面这个 runbook。

## 硬件/软件需求

- **本机**：Mac（M 系列最稳）或 Windows PC，放在电视旁
- **电视 / 音响**：任意 HDMI 输入，或 AirPlay 2 接收
- **麦克风**：带自己音响的那种（零延迟监听）
- **手机**：任意带浏览器的手机
- **百度盘 SVIP** 账号（你自己的曲库）
- **mpv**：本机装好（Win: `winget install shinchiro.mpv`；Mac: `brew install mpv`）
- **存储**：~500 GB 本地磁盘 / SMB 挂载的 NAS（用户选）

## M0 Runbook（手工验证）

目标：用最小动作证明三件事能跑，之后再写任何业务代码才有意义。**全部在本机（Windows 或 Mac）跑，不用 NAS、不用 Docker。**

### 准备 OpenList 二进制

从 https://github.com/OpenListTeam/OpenList/releases/latest 下载对应平台：

- **Windows x64**：`openlist-windows-amd64.zip`
- **Mac Apple Silicon（M1/M2/M3/M4）**：`openlist-darwin-arm64.tar.gz`
- **Mac Intel**：`openlist-darwin-amd64.tar.gz`

解压到项目目录 `bin/` 下：

```bash
mkdir -p H:/Projects/KTV/bin
# 把解压出来的 openlist.exe 或 openlist 放进 H:/Projects/KTV/bin/
```

### 启动 OpenList

**Windows cmd**：
```cmd
cd /d H:\Projects\KTV\bin
openlist.exe server --data ..\openlist-data
```

**Mac / Linux**：
```bash
cd H:/Projects/KTV/bin
chmod +x ./openlist
./openlist server --data ../openlist-data
```

首次启动会在日志里打印初始管理员密码，记下来。

浏览器打开 http://localhost:5244，用户名 `admin` + 刚才那个密码登录。

### 配置两个存储

**存储 1：百度盘（源，只读）**

- 管理 → 存储 → 添加
- 驱动：`BaiduNetdisk` 或 `Baidu.OnlineAPI`（推荐后者，OAuth 免 cookie）
- 挂载路径：`/baidu`
- 按页面指引扫码授权你的百度账号（SVIP）
- 保存

**存储 2：本地（目标，可写）**

- 再加一个
- 驱动：`Local`
- 挂载路径：`/local`
- Root folder path：指向你要下载 MV 的物理目录。例：
  - 本地盘：`H:\ktv-library`（Windows）或 `/Users/你/ktv-library`（Mac）
  - 挂载的 NAS：`Z:\KTV`（Windows SMB 盘符）或 `/Volumes/NAS/KTV`（Mac）
- 保存

在 OpenList 右上角用户菜单 → 我的 Token，复制 Token 备用。

### 测试 1：Baidu 在 Stockholm 的真实下载速度

在 OpenList UI 里找一首你曲库里的 MV（~100 MB 左右的 MKV），记下它的完整路径，比如 `/baidu/KTV/魔幻力量/如果明天世界末日[MTV].mkv`。

**Windows cmd / PowerShell**：

```powershell
$TOKEN = "在这里粘贴你的 Token"

# 触发 copy: 百度 -> 本地
curl -X POST "http://localhost:5244/api/fs/copy" `
  -H "Authorization: $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{\"src_dir\": \"/baidu/KTV/魔幻力量\", \"dst_dir\": \"/local\", \"names\": [\"如果明天世界末日[MTV].mkv\"]}'

# 每秒轮询一次进度
while ($true) { curl -s "http://localhost:5244/api/task/copy/undone" -H "Authorization: $TOKEN"; Start-Sleep 1 }
```

**Mac / Linux bash**：

```bash
TOKEN="在这里粘贴你的 Token"

curl -X POST "http://localhost:5244/api/fs/copy" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"src_dir":"/baidu/KTV/魔幻力量","dst_dir":"/local","names":["如果明天世界末日[MTV].mkv"]}'

while true; do curl -s "http://localhost:5244/api/task/copy/undone" -H "Authorization: $TOKEN"; sleep 1; done
```

**记录下来：**

- [ ] Wall-clock 总耗时：____ 秒
- [ ] 文件大小：____ MB
- [ ] 平均速度：____ MB/s
- [ ] `progress` 字段是否平滑增长（不是 0 跳 100）？y / n
- [ ] 下到目标目录后能看到文件？y / n

**及格线：平均 ≥ 5 MB/s，progress 平滑。** 低于这个考虑 HK/SG 中转 VPS。

### 测试 2：mpv 运行时切声道无爆音

```bash
# Windows
mpv H:\ktv-library\如果明天世界末日*.mkv

# Mac
mpv ~/ktv-library/如果明天世界末日*.mkv
```

视频开始后听清楚当前状态（双声道 = 原唱 + 伴奏混合）。

**在 mpv 窗口里按反引号 `` ` `` 打开控制台**，输入（不带引号）：

```
af add @karaoke:lavfi=[pan=stereo|c0=c0|c1=c0]
```

回车 → 只剩左声道（双喇叭播 L）。再输入：

```
af remove @karaoke
af add @karaoke:lavfi=[pan=stereo|c0=c1|c1=c1]
```

回车 → 只剩右声道（双喇叭播 R）。最后 `af remove @karaoke` 回到双声道。

**记录下来：**

- [ ] 切换瞬间有"咔哒"爆音？y / n
- [ ] 哪边是原唱、哪边是伴奏？（记下 vocal_channel 约定，例："B'in MUSIC 发行 = L 伴奏 R 原唱"）

**及格线：切换无明显爆音。** 有爆音需改方案（双 mpv 实例 crossfade）。

### 测试 3：AirPlay / HDMI 全链路体感（Mac 上做，Windows 跳过）

Mac 上 AirPlay 到电视（QN700B 原生支持）或 Apple TV；电视声音走 eARC 到 Soundbar。拿麦克风唱你熟悉的歌两句，确认：

- [ ] 能跟得上伴奏、不觉得拍子错位（详见 memory: `feedback_latency_karaoke.md`）
- [ ] MV 画面/歌词延迟可以接受

## M0 完成后

三项结果填回来，我根据数据启动 M1（backend 脚手架 + node-mpv 控制 + openlist 子进程编排）。任一项不及格前要先改方案。

## 后续里程碑

见 [实施方案](../../Users/huanc/.claude/plans/floating-baking-snail.md) §里程碑 M1–M4。

## 目录结构

```
├── README.md                  # 这个文件，含 M0 runbook
├── package.json               # (M1 起) 根 Node 项目
├── config.example.json        # (M1 起) 配置模板
├── scripts/                   # (M1 起) 启动脚本 + OpenList 下载脚本
├── bin/                       # OpenList 二进制放这（gitignored）
├── backend/                   # Node 20 + Fastify + node-mpv
└── web/                       # Vue 3 + Vite 手机前端
```

## 许可

（待定）
