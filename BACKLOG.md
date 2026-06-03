# KTV 待办

不急做的事写在这里，后续接着干时直接读这个文件。

## 8TB 百度盘整理 — 不全下载就缩成一个干净小库

**目标**：现状 8TB / ~48k 行百度索引，一首一首下载不可行。要按规则筛掉重复 / 低质量，最终只把精选下到 NAS（估 1.5–2TB 量级）。

### 阶段 0：元数据扫描（已完成）

- BDUSS 直连扫整个 `/KTV` 进 DB（cached=0 占位）
- 增量同步：`last_seen_at` 列 + scan 完成后 prune；新增的入库，百度上删除的同步删（已缓存的不动）

### 阶段 1：纯元数据筛选（不下载，先做这个）

需要新加：

- `songs.exclude` boolean 列（迁移 + INSERT/UPSERT 兼容默认 0）
- `/api/admin/bulk-tag` 端点：按 SQL 条件批量设 `exclude=1`
- `/library` 顶部加"批量打标"工具：
  - 文件名包含 `(替换)` / `(演)` / `(中国好声音...)` → 标记
  - `size_bytes < 10MB`（低码率代理） → 标记
  - 路径前缀 `/KTV/MKV（7300首）/` 跟新包重叠的 → 标记（先 keep newer 包）
  - artist 是 `unknown` 或文件名乱码 → 标记
- 列表页加 "隐藏 excluded" 开关；exclude=1 的不参与下载、不出现在搜索
- 批量"反向打标 / 撤销"按钮

价值：48k → 可能砍到 ~20k 候选，这是不下载就能完成的。

### 阶段 2：声道判断启发式（背景跑，跟阶段 1 并行）

需要新加：

- `songs.vocal_channel_confidence: "guessed" | "verified"` 列
- 启动时按路径前缀启发式批量赋 vocal_channel + 标 "guessed"：
  - `/歌星分类大全/` → R = 原声（B'in / 公关流通约定）
  - `/常唱1万首MKV/` → R = 原声（同套压制）
  - `/mkv22-23/` → 多数 R = 原声，但有反例
  - `-合唱-` 后缀 → vocal_channel="both"
- 用户在播放时切换 → 后端从 mpv 当前 channel 推回 vocal_channel，升级 "verified"
- 真歌的 `track-started` 事件：如果 confidence="guessed" 且用户点了"切原唱/伴唱"，把推断结果保存

### 阶段 3：精选下载（执行减肥）

需要扩展：

- `/library` 选择工具栏加"按规则全选"下拉：
  - "(artist, title) 中 size 最大的"
  - "排除已 exclude 的"
  - "排除 (演) / (替换) 的"
- 一次性勾几千首 → DownloadManager 批量下到 NAS

### 阶段 4：下载到 NAS 后的最后 normalization

需要新加：

- `/api/admin/probe-cached` 端点：对 cached=1 的 local 文件跑 ffprobe
  - 抽 duration, bitrate, audio_track_count, channel_layout
  - 写回 DB（新加几列）
- 重新跑一遍 dedupe（这次 score 函数能用真 bitrate 排序）
- vocal_channel="guessed" 的尝试用 SOX/ffmpeg 简单 vocal extraction 自动 verify
- 失败的留 "guessed"，用户播放时再人工纠正

### 实施优先级（从最高 ROI 起）

1. 阶段 1 的"批量打标 + exclude 字段 + UI"
2. 阶段 3 的"按规则批量勾选"
3. 阶段 2 的"启发式 vocal_channel 标注"
4. 阶段 4 等真下载完再说

### 容量估算

- 当前 baidu_root 下 ~48k 行
- 每行平均 size 还没统计（先 SELECT AVG(size_bytes) FROM songs WHERE size_bytes IS NOT NULL）
- 假设 (artist, title) 唯一化能砍 60%，再砍 (演)/(替换)/低码率 20%，剩 ~10k 行
- 如果平均 100MB/首，约 1TB；若 200MB/首约 2TB

---

## macOS 适配现状

已修：
- mpv `--no-native-fs` + `--macos-fs-animation-duration=0` — 切歌不再因 Space 切换闪桌面
- mpv binary 自动查 `/opt/homebrew/bin/mpv` (Apple Silicon brew) / `/usr/local/bin/mpv` (Intel) / `/Applications/mpv.app/Contents/MacOS/mpv`
- folder-picker 走 osascript 选目录
- OpenList fetcher 支持 darwin-arm64 / darwin-amd64
- start.sh 行尾 LF，可执行
- QR 贴图浮窗 mac 版（`scripts/qr-floater.swift`）：AppKit NSWindow + `CGShieldingWindowLevel()` + `collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary,.stationary]`，跟 Windows 版本同形态（顶层、鼠标穿透、不进 Dock）。需要 `xcode-select --install` 装 swift CLI

要在 mac 上跑：
1. `brew install mpv node@22` (or nvm 装 Node ≥ 22)
2. clone + `npm run setup`
3. 编辑 `config.json`：`library_path` 用 mac 路径（NAS 用 `/Volumes/ktv` 等 SMB 挂载点，本地路径 `/Users/.../KTV`）
4. `bash scripts/start.sh`

mac 上还可能的小坑（碰到再修）：
- 若 brew mpv 是 0.34 以下版本，`--macos-fs-animation-duration` 不被识别——升级 mpv
- mpv 在 macOS 多显示器场景下 fullscreen 跑哪个屏：`--fs-screen-name=…` 可指定
- AirPlay 镜像通常稳，但 macOS Catalina 之后镜像可能要在"系统设置 → 屏幕镜像"启用

## 其他未做（review agent 找出但暂搁的）

- `fillerActive` 用 discriminated union 状态机重构（当前两 flag 工作正常）
- `registerAdminRoutes` 11 个参数 → deps 对象（影响所有调用点）
- `/api/songs?artist=` 7-way GLOB 触发全表扫 → 加 `artist_tokens` 列 + 索引（schema migration + UPDATE 75k 行）
- `/api/library/stats` 5 个 query 序列化 → 缓存
- mpv EOF 轮询 → 换 `observe_property` / `end-file` event（node-mpv 1.x event 暴露不全）
