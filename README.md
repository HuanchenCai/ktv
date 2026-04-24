# KTV 家庭点歌系统

手机扫码点歌 → 百度盘按需下载 → NAS 落盘 → MacBook 播放 → 电视显示 + Soundbar 出声。

完整设计见 [计划文件](../../Users/huanc/.claude/plans/floating-baking-snail.md)。

## 当前状态

**M0 Brown M&M** — 手工验证最高风险路径，**尚未完成**。下面的 runbook 是必须先走一遍的步骤。

## M0 Runbook（你手工执行）

目标：用最小动作证明三件事能跑，之后再写任何业务代码才有意义。

### 准备

在 NAS 上（SSH 进去）：

```bash
sudo mkdir -p /volume1/docker/ktv/{openlist,library,backend}
sudo chown -R 1000:1000 /volume1/docker/ktv
```

把这个项目的 `docker-compose.yml` 放到 NAS 上（或在 UGOS 容器管理器 → Compose 直接粘贴），起 OpenList：

```bash
docker compose up -d openlist
docker logs ktv-openlist 2>&1 | grep -i "password\|admin"
```

首次启动会打印随机初始管理员密码，记下来。

### 配置 OpenList 两个存储

浏览器打开 `http://<NAS IP>:5244`，用 `admin` + 上面那个密码登录。

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
- Root folder path：`/library`（对应 Docker 里挂进来的 `/volume1/docker/ktv/library`）
- 保存

### 测试 1：Baidu 在 Stockholm 的真实下载速度

在 OpenList UI 里找一首你曲库里的 MV（~100 MB 左右的 MKV），记下它的完整路径，比如 `/baidu/KTV/魔幻力量/如果明天世界末日[MTV].mkv`。

从任一终端发：

```bash
NAS=<your-nas-ip>
TOKEN=<从 OpenList 用户设置页拿到的 API token>

# 触发 copy: 百度 → 本地
curl -X POST "http://$NAS:5244/api/fs/copy" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "src_dir": "/baidu/KTV/魔幻力量",
    "dst_dir": "/local",
    "names": ["如果明天世界末日[MTV].mkv"]
  }'

# 拿到任务后轮询进度（每秒一次）
while true; do
  curl -s "http://$NAS:5244/api/task/copy/undone" -H "Authorization: $TOKEN" | jq .
  sleep 1
done
```

**记录下来：**

- [ ] Wall-clock 总耗时：____ 秒
- [ ] 文件大小：____ MB
- [ ] 平均速度：____ MB/s
- [ ] `progress` 字段是否平滑增长（不是 0 跳 100）？y / n
- [ ] 下到 NAS 后在 `/volume1/docker/ktv/library/` 里能看到文件？y / n

**及格线：平均 ≥ 5 MB/s，progress 平滑。** 低于这个要考虑 HK/SG 中转 VPS。

### 测试 2：MacBook mpv 运行时切声道无爆音

把下好的那个 MKV scp 到 Mac：

```bash
scp <nas-user>@<nas-ip>:/volume1/docker/ktv/library/如果明天世界末日*.mkv ~/Desktop/
```

Mac 上装工具：

```bash
brew install mpv socat
```

一个终端起 mpv（带 IPC socket）：

```bash
mpv --input-ipc-server=/tmp/mpvsocket ~/Desktop/如果明天世界末日*.mkv
```

视频开始后听清楚现在的状态（双声道 = 原唱 + 伴奏）。

另一个终端发切声道命令：

```bash
# 只听左声道（假设是伴奏）
echo '{"command": ["af", "add", "@karaoke:lavfi=[pan=stereo|c0=c0|c1=c0]"]}' | socat - /tmp/mpvsocket

# 切到只听右声道（假设是原唱）
echo '{"command": ["af", "remove", "@karaoke"]}' | socat - /tmp/mpvsocket
echo '{"command": ["af", "add", "@karaoke:lavfi=[pan=stereo|c0=c1|c1=c1]"]}' | socat - /tmp/mpvsocket

# 回到双声道（移除 filter）
echo '{"command": ["af", "remove", "@karaoke"]}' | socat - /tmp/mpvsocket
```

**记录下来：**

- [ ] 切换时有没有"咔哒"爆音？
- [ ] 哪边是原唱、哪边是伴奏？（记下这首的 vocal_channel 约定）

**及格线：切换无明显爆音。** 有爆音需要改方案（双 mpv crossfade）。

### 测试 3：AirPlay 全路径体感

MacBook 上 AirPlay 投屏到电视（QN700B 原生支持）或 Apple TV；电视声音走 eARC 到 HW-S810B Soundbar。拿麦克风唱两句你熟悉的歌，确认：

- [ ] 能跟得上伴奏、不觉得拍子错位（详见 memory: `feedback_latency_karaoke.md`，应该不会错位）
- [ ] 电视 MV + 歌词虽然晚 ~300 ms 但不妨碍唱

## M0 完成后

把三项结果填回来，我再根据数据启动 M1（backend + player 代码）。如果测试 1 不及格要先改方案；测试 2 不及格要换播放策略；测试 3 只是体感验证。

## 后续里程碑

见 [计划文件](../../Users/huanc/.claude/plans/floating-baking-snail.md) §里程碑 M1–M4。

## 目录结构

```
├── docker-compose.yml    # OpenList（M0+）、backend（M1+ 启用）
├── backend/              # Node 20 + Fastify（M1 开始填）
├── web/                  # Vue 3 + Vite（M2 开始填）
└── player/               # Python + mpv（M1 开始填）
```
