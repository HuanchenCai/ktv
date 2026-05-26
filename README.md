<div align="center">

# 寰宇KTV

**把家庭服务器变成 KTV 包厢**

为海外华人 homelab 玩家做的自部署 KTV 引擎。
手机扫码点歌 · 真 MV 跟唱 · 多连接器 · 不订阅 · 不限制 IP

[![License](https://img.shields.io/badge/license-TBD-orange)](#-许可与商业模式)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)](#-快速开始)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-green)](#0-前置)
[![Status](https://img.shields.io/badge/status-alpha-yellow)](#%EF%B8%8F-roadmap)

<sub>English summary at bottom · 中文为主</sub>

</div>

---

> [!NOTE]
> **这是一个 self-hosted 项目**，不是云服务。你需要一台一直开机的电脑（Mac mini / NUC / 群晖 / 任意 NAS）和一个百度网盘 SVIP（或同等云盘）。如果这些对你不是问题，欢迎继续。
>
> 如果你想要"点开就唱"的零配置 SaaS，这个项目不适合你——
> Apple Music sing-along 是更省事的选择（虽然没 MV）。

## ✨ 解决什么问题

在海外开 KTV 派对，现有选项都有硬伤：

| 选项 | 痛点 |
|---|---|
| Apple Music sing-along | 没 MV，气氛不对 |
| 唱吧 / 全民K歌 | 月度订阅 + 需要国内 IP |
| YouTube + 蓝牙麦 | 大家不能各自手机点歌、不能共建队列 |
| 商业 KTV 机顶盒 | 国内才有，不能定制曲库 |
| 自己拼 mpv + 字幕 | 一晚上就过去了 |

**寰宇KTV 把国内商业 KTV 的"多人扫码点歌 + 排队 + 原伴切换"完整搬到你的家庭服务器上**，曲库连接你已有的百度盘 / NAS / Jellyfin / 本地文件夹。

## 🎬 Demo

<!-- TODO: 放上一段 30 秒 demo GIF 或 YouTube 链接 -->

> 演示视频准备中。届时这里会嵌入：
> - 30 秒 — 客厅场景：手机扫码 → 搜歌 → MV 跳出 → 副歌
> - 60 秒 — 完整流程演示（搜索、排队、原伴切换、跨设备点歌）

## 🧐 这适合你吗？

打勾越多越合适：

- [ ] 你有一台 7×24 开机的电脑（Mac mini / NUC / 群晖 / OmniOS / 任意 NAS）
- [ ] 你有百度网盘 SVIP，或愿意开一个（~30 元/月）
- [ ] 或者你已经把曲库放在自己的 NAS / Jellyfin / Emby 上
- [ ] 你能接受花 30 分钟一次性配置
- [ ] 朋友常来家里聚

如果打勾 ≥ 3，继续往下看。
如果打勾 ≤ 2，先 [star 一下](https://github.com/HuanchenCai/ktv) 关注后续，等 Pro 一体机版本（在规划中）。

## 🏗️ 架构

```
                    📱 手机（每人一台，扫码进入）
                          │
                          │  Wi-Fi
                          ▼
              ┌──────────────────────────┐
              │   寰宇KTV Backend         │
              │   Fastify · Node 22+      │  ← 单进程编排
              │   ┌────────────────────┐  │
              │   │  SQLite 曲库索引   │  │
              │   │  + 队列状态       │  │
              │   └────────────────────┘  │
              └──┬──────────────────┬─────┘
                 │                  │
                 │ HTTP REST       │ IPC
                 ▼                  ▼
        ┌──────────────┐      ┌──────────┐
        │  OpenList    │      │   mpv    │
        │ (多源适配)   │      │ (播放器) │
        └──┬──────┬────┘      └────┬─────┘
           │      │                │
           ▼      ▼                ▼
      百度盘   NAS / SMB     HDMI → TV
       SVIP   Jellyfin       L/R 声道 → 音响
              本地文件        (原唱 / 伴奏切换)
```

**关键设计：**
- **单进程**：一个 Node 进程编排所有子进程（OpenList、mpv），不用 Docker compose、不用 PM2
- **存算分离**：曲库视频在云盘 / NAS，本地只缓存最近播放的（LRU，默认 50GB）
- **OpenList 抽象层**：百度盘、阿里云盘、WebDAV、SMB、本地，统一接口
- **L/R 声道切原伴**：商业 KTV 发行版约定 MV 左声道原唱、右声道伴奏，mpv 实时切

## 🚀 快速开始

### 0. 前置

- **Node 22+**（用了 Node 内置的 `node:sqlite`，省去 native build 痛苦）
- **mpv**
  - Windows: `winget install shinchiro.mpv`
  - macOS: `brew install mpv`
  - Linux: `apt install mpv` / `pacman -S mpv`
- **歌源**（任选其一）
  - 百度网盘 SVIP 账号（推荐，海外可用，最大曲库）
  - 阿里云盘 / 115 / 夸克
  - 自己的 NAS（Jellyfin / Emby / SMB / WebDAV）
  - 本地硬盘里的 MV 文件

### 1. 安装

```bash
git clone https://github.com/HuanchenCai/ktv.git
cd ktv
npm run setup
```

`setup` 会做三件事：装依赖、下载 OpenList 二进制到 `bin/`、打包 Vue 前端到 `web/dist/`。

跑一次 doctor 验证环境：

```bash
npm run doctor
```

全绿 ✓ 表示可以 `npm start`。

### 2. 启动

```bash
npm start
```

启动时会自动从 `config.example.json` 拷一份 `config.json`，并拉起 OpenList 子进程（监听 `:5244`）、mpv 子进程，Fastify 监听 `:8080`。

日志里找这一行（**只在首次启动时打印一次**）：

```
[openlist] Successfully created the admin user and the initial password is: XXXXXXXX
```

记下来，下一步要用。

### 3. 配置 OpenList（一次性）

浏览器打开 `http://localhost:5244`，用 `admin` + 上面的密码登录，加两个存储。

<details>
<summary><b>存储 1：百度盘（只读源）</b></summary>

- 管理 → 存储 → 添加
- 驱动：`BaiduNetdisk` 或 `Baidu.OnlineAPI`（推荐 OAuth，免 cookie）
- 挂载路径：`/baidu`
- 按指引扫码登录百度账号（SVIP）

</details>

<details>
<summary><b>存储 2：本地缓存（可写目标）</b></summary>

- 驱动：`Local`
- 挂载路径：`/local`
- Root folder path：填本地真实路径，例如 `H:\ktv-library` 或 `Z:\KTV`（NAS）

</details>

<details>
<summary><b>使用 NAS 替代百度盘</b></summary>

把存储 1 换成 `Jellyfin` / `Emby` / `WebDAV` / `SMB` 即可。架构上完全等价——backend 只跟 OpenList API 对话。

</details>

**最后拿 API token**：OpenList 右上角用户菜单 → 我的 → 我的 Token，复制。

### 4. 填 config.json

```json
{
  "library_path": "H:/ktv-library",
  "baidu_root": "/baidu/KTV",
  "openlist": {
    "api_token": "粘贴你刚才复制的 token"
  }
}
```

重启 backend（`Ctrl+C` → `npm start`）。

### 5. 扫描曲库入索引

浏览器打开 `http://localhost:8080/admin`，点 **"开始扫描"**。曲库所有 MV 的元数据（标题/艺人/拼音/大小）几秒到几分钟入 SQLite。

> 💡 **想跳过百度盘配置先验证播放？**
> Admin 页有"导入本地文件"按钮：往 `library_path` 丢一两个 `.mkv`，点这个按钮就会作为已缓存歌曲入库。烟雾测试用。

### 6. 开唱

手机扫 admin 页上的二维码（或直接访问 `http://<本机-LAN-IP>:8080`）：

- **搜歌**：拼音首字母（`zyn` → 只有你）
- **已点**：队列 + 下载进度 + 置顶/删除
- **播放**：原唱/伴唱、切歌、重唱、音量

第一次点没缓存的歌，backend 通过 OpenList 从百度盘下载到 `library_path/`，下完自动播。重复点秒播。

## 🎵 歌从哪来？

**我们不分发任何歌曲文件**。三个推荐姿势：

### A. 百度网盘 SVIP（推荐给 90% 用户）

- 海外可用，曲库最大
- ~30 元/月，按月付
- 你可以从论坛、TG 频道、网盘资源圈拿到公开分享链，转存到自己账号
- App 通过 OpenList 直接读你账号里的 MV，按需下载

### B. 自己的 NAS / Jellyfin / Emby

- 已经有 homelab 的玩家最舒服
- 完全离线 / 高速 / 不依赖外部服务
- 配 OpenList 的 WebDAV / SMB / Jellyfin 驱动即可

### C. 本地硬盘

- 把 MV 文件丢到 `library_path/`，点 admin 页"导入本地文件"
- 适合临时演示或小曲库场景

> ⚖️ **法律说明**：寰宇KTV 是一个本地播放工具，不存储、不分发任何受版权保护的内容。
> 用户自行准备并合法使用所播放的素材，相关责任由用户承担。

## 💰 许可与商业模式

> 🚧 **状态：alpha，定价和许可证还在最终确定中。**

计划走"**开源核心 + 付费增值**"双轨：

### 🆓 Core（开源，本仓库）

所有核心功能：手机点歌、扫码、队列、原伴切换、多 connector、字幕同步。
**免费，无限制，永久。**

License：MIT 或 AGPL-3.0（请到 [Issue #1](https://github.com/HuanchenCai/ktv/issues) 投票）

### 💎 Pro（规划中，~$39 一次性 + 可选 $4.99/月）

差异化的"省心"版本：

| 功能 | Core | Pro |
|---|---|---|
| 核心点歌引擎 | ✓ | ✓ |
| 所有 connector | ✓ | ✓ |
| Mac 公证签名版（免"未识别开发者"） | ✗ | ✓ |
| Windows 数字签名版 | ✗ | ✓ |
| 自动更新 | ✗ | ✓ |
| 内置 GUI 安装器（不用命令行） | ✗ | ✓ |
| 优先 issue 处理 | ✗ | ✓ |
| **歌库索引订阅** ($4.99/mo) | ✗ | ✓ |
| - 每周新增热门歌元数据 | | |
| - 时间轴校对过的字幕库 | | |
| - 歌曲别名 / 拼音 / 多版本去重 | | |

歌库订阅卖的是**劳动成果**（索引、字幕、元数据），不是歌曲文件本身——所有歌曲依然由用户自己的网盘提供。

**预约通知**：[Lemon Squeezy 商品页 TODO]

## ❓ FAQ

<details>
<summary><b>海外用百度盘速度够吗？</b></summary>

SVIP 在海外典型 1-5 MB/s（看地区和 ISP）。一首 200MB MV 边下边播没问题，30 秒缓冲就能开唱。
首次下载较慢，但 app 有 LRU 缓存（默认 50GB），常唱的歌只下一次。

如果你那边百度盘慢得离谱，建议改用阿里云盘或自建 NAS。

</details>

<details>
<summary><b>必须用百度盘吗？</b></summary>

不是。OpenList 支持百度、阿里、115、夸克、Jellyfin、Emby、WebDAV、SMB、Local 等几十种驱动。
任意能存视频的地方都能接。

</details>

<details>
<summary><b>支持哪些平台？</b></summary>

Backend：Mac / Windows / Linux（Node 22+ 跑得起来都行）。
手机端：浏览器即可，iOS / Android 都行，**不需要装 app**。

</details>

<details>
<summary><b>字幕从哪来？</b></summary>

商业 KTV MV 通常自带内嵌字幕（硬字幕），mpv 直接播。如果是裸视频，可以放同名 `.ass` / `.lrc` / `.srt` 字幕文件，mpv 自动识别。

Pro 版的歌库订阅会提供已校对的字幕。

</details>

<details>
<summary><b>原唱 / 伴奏怎么切？</b></summary>

商业 KTV 发行的 MV 通常左声道原唱、右声道伴奏（或反过来）。app 在播放界面提供"原唱 / 伴奏"按钮，实时切 mpv 的 `audio-channels`。

不同发行版约定不一致（B'in、雷石、视易），UI 提供"这首 L/R 反了"按钮按首歌校正，校正结果存到 SQLite。

</details>

<details>
<summary><b>支持评分动画 / 麦克风升降调吗？</b></summary>

Roadmap M2，还没做。

</details>

<details>
<summary><b>可以商用吗？开 KTV 店行不行？</b></summary>

技术上行，法律上**自负**。这个项目针对的是"家庭/朋友聚会"自部署场景。商用涉及音乐授权、表演权等版权问题，跟本项目无关。

</details>

## 🗺️ Roadmap

- [x] **M0** — Brown M&M 验证（OpenList 百度盘 + mpv 切声道 + Fastify WebSocket）
- [x] **M1** — 手机扫码 + 搜歌 + 队列 + 下载调度 + 原伴切换
- [ ] **M2** — 评分动画 + 麦克风预处理（混响 / 升降调）
- [ ] **M3** — 多 connector connector matrix 测试（阿里云盘、115、Emby、Jellyfin）
- [ ] **M4** — Pro 版打包（Mac/Win 签名 + GUI 安装器 + 自动更新）
- [ ] **M5** — 歌库订阅服务（索引同步 + 字幕库）
- [ ] **M6** — AirPlay / Chromecast 输出（不依赖 HDMI）

## 🤝 社区

- **GitHub Issues** — bug、feature request
- **GitHub Discussions** — 配置疑问、connector 适配
- **预约 Pro 版通知** — [Lemon Squeezy TODO]
- **作者** — [@HuanchenCai](https://github.com/HuanchenCai) · 在海外想唱歌的工程师 · 也会唱一两首

## 🛠️ 开发命令

```bash
npm start            # 生产启动
npm run dev          # backend watch 模式
cd web && npm run dev  # web dev server (Vite), 代理到 :8080
npm test             # vitest 单元测试
npm run typecheck    # TS 类型检查
```

## ⚠️ 已知限制

- **OpenList 的百度盘驱动可能被百度风控**，token/cookie 失效要重新授权
- **跨海外 IP 限速**：欧美到百度服务器速度看 ISP，瑞典实测 SVIP 1-3 MB/s
- **mpv 切声道依赖发行商约定**：不同 KTV 发行版 L/R 不统一，UI 提供按首歌校正

---

## English Summary

**HuanyuKTV** is a self-hosted karaoke engine for the overseas Chinese homelab community. Phone-based QR code song requesting, real music videos (not just lyrics), multi-source connector (Baidu Netdisk, NAS, Jellyfin, local files), original/karaoke channel toggle.

This is **not** a SaaS — you need a 7×24 host (Mac mini, NUC, NAS) and your own content source (Baidu Netdisk SVIP recommended for the overseas Chinese audience, or use your own Jellyfin/Emby/SMB).

We do **not** distribute any copyrighted content. Users source their own media.

**Status**: alpha. Pricing under design — core will be open source (MIT or AGPL, TBD), Pro tier (Mac/Win signed builds, auto-update, indexed song library subscription) coming Q1.

Issues and PRs welcome.

