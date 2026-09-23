# 带着笔记本去聚会

笔记本运行 KTV 和 mpv，电视显示笔记本的画面。歌曲可以留在百度网盘或家中 NAS；手机通过互联网房间入口点歌、操作队列、暂停、切歌、重唱、调音量和切换原伴唱。

## 两条网络连接

```text
手机（Wi-Fi / 4G / 5G）
       │ HTTPS + WebSocket：点歌、队列、播放控制
       ▼
互联网房间地址 → 隧道 → 聚会笔记本 KTV → mpv → HDMI / 系统屏幕镜像 → 电视
                              │
                              │ 视频流（与手机控制通道分开）
                              ▼
                    OpenList → 百度云 / 家中 NAS / WebDAV
```

手机只收发控制和歌曲信息。视频由笔记本读取，不经过手机，也不必经过房间公网隧道。扫描曲库仅保存元数据索引，不下载几 TB 的视频。

## 先接歌曲来源

OpenList 可以运行在笔记本上，也可以运行在家中的 NAS 上。一个 OpenList 可同时挂载百度盘、NAS 文件夹和其他支持的来源。

**方案一：笔记本上的 OpenList 连接百度网盘。** 保持原有 `openlist.auto_spawn: true`，不填写 `base_url`；在 OpenList 挂载百度盘，设置 `openlist.root` 为挂载后的歌曲目录，例如 `/baidu/KTV`。百度授权和速度限制仍由百度及 OpenList 驱动决定。

**方案二：连接家中 OpenList / NAS。** 推荐在 NAS 和笔记本之间建立受认证的私有网络，例如 [Tailscale 的 NAS 远程访问方案](https://tailscale.com/docs/use-cases/personal-or-at-home-use/access-nas-media-file-servers)。笔记本用这个网络里的 OpenList 地址；手机不需要加入这个私有网络。已有可信 HTTPS 远程地址也可使用。

**绿联 NAS + MacBook，先做最简外网播放测试：** 在 MacBook 和 NAS 上登录同一 Tailscale 网络；从 [Tailscale 设备列表](https://console.tailscale.com/admin/machines)找到 NAS 的 `100.x.x.x` 地址。MacBook 的 Finder 按 `⌘K`，连接 `smb://100.x.x.x`，输入 NAS 文件共享账号并选择歌曲共享文件夹。确认 Finder 中能打开至少一首视频；外出时让 MacBook 改用手机热点验证。启动 KTV 后，在本机 `http://localhost:8080/admin` 的“导入本地或 NAS 歌曲”处选择已挂载的 NAS 歌曲文件夹，例如 `/Volumes/KTV`，然后搜索、点歌。这个入口只把文件路径与歌曲信息写入本机索引；mpv 播放时直接从 NAS 共享目录读取，歌曲不必复制到笔记本。MacBook 重连网络或重启后，先确认共享目录仍挂载在相同路径；如果短暂断线使歌曲显示不可用，重新扫描即可恢复。[Tailscale 的 macOS 文件共享说明](https://tailscale.com/docs/use-cases/personal-or-at-home-use/access-nas-media-file-servers?tab=macos)

如果还要同时接入百度网盘，或希望 OpenList 管理多个歌源，可以改走 OpenList：在**MacBook 上由 KTV 自动启动的 OpenList**中添加 `Local` 存储，挂载路径如 `/nas`，根目录填已挂载的歌曲目录；KTV 配置 `openlist.root: "/nas"`，保留 `auto_spawn: true`。也可在同一个 OpenList 下另挂百度网盘，此时把 `openlist.root` 设为包含两种挂载的共同上级路径。[OpenList 本地存储说明](https://doc.oplist.org/guide/drivers/local)

远程 OpenList 配置示例：

```json
"openlist": {
  "base_url": "https://nas.example.com",
  "root": "/KTV",
  "auto_spawn": false,
  "api_token": "填写你自己的 OpenList token"
}
```

- `root` 是 OpenList 中的路径，不是 NAS 上的磁盘路径。省略时兼容旧 `baidu_root`。
- `base_url` 是 OpenList 服务地址，不是单首歌曲的下载地址。可以有服务子路径，不带查询参数、用户名和密码。
- 配置 `base_url` 时必须关闭 `auto_spawn`，避免同时启动另一台本地 OpenList。
- NAS 的 `192.168.x.x` 地址出了家门通常不可达；先建立私有网络或 HTTPS 入口。仅填写地址不会自动完成穿透。
- 在 OpenList 中为歌曲存储开启签名并允许代理读取，先验证文件能通过 `/p/` 代理访问。播放器使用临时签名链接，NAS 私有直链和驱动所需请求头由 OpenList 处理。[OpenList 存储通用设置](https://pages.doc.oplist.org/guide/drivers/common)
- 远程 OpenList 需要保持开机。公开网络使用 HTTPS；HTTP 只用于本机或受保护的私有网络。
- OpenList 的登录令牌可能失效。需要无人值守重启或长期开机时，可同时填写 `openlist.username` 和 `openlist.password`（建议创建仅能读取歌曲目录的专用账号），KTV 会在令牌失效时重新登录并重试一次。密码只保存在本机被忽略的 `config.json`，不要提交到 Git 或发给来宾。留空这两个字段时，仍兼容已有的 `api_token` 配置，但失效后需要手动更新。

## 再接手机互联网入口

为**聚会笔记本**建立一个 HTTPS 隧道，把自己的域名转发到 `http://127.0.0.1:8080`，并支持 WebSocket `/ws`。例如 [Cloudflare Tunnel 官方设置指南](https://developers.cloudflare.com/tunnel/get-started/)支持把公网域名映射到本地服务。隧道客户端运行在带出门的笔记本上，而非只运行在家中的 NAS 上。

然后在 `config.json` 填写：

```json
"room": {
  "public_url": "https://party.example.com",
  "guest_code": "填写聚会来宾口令",
  "admin_code": "填写另一条主持人管理口令"
}
```

`public_url` 必须是实际的 HTTPS 根地址，不支持 `/ktv` 等子路径。它只决定二维码和允许的请求来源，**不会创建域名、隧道或云服务**。

来宾口令至少 8 个字符，主持人口令至少 24 个字符，两者不能相同。建议使用随机口令。可分别执行下面的命令生成两条 32 字符口令，再填入配置；不要把主持人口令分享给来宾：

```bash
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
```

提供了完整的 `config.remote.example.json` 作为参考。其中域名是占位符、口令留空，直接复制会拒绝启动，必须先填自己的配置。现有配置请合并相应字段，不要覆盖原有百度凭据。

启用公网房间后：

- 服务默认仅监听 `127.0.0.1`，通过隧道访问；笔记本自己访问 `http://localhost:8080`。容器或特殊反向代理环境可显式设置 `http_host`。
- 电视二维码、浮窗二维码和网页二维码都使用公网房间地址；不再要求来宾先连 Wi-Fi。
- 手机打开地址，输入来宾口令即可使用播放控制。主持人输入管理口令后才可扫描、下载、整理曲库和查看管理信息。
- 本机浏览器同样需要登录，不能按本机来源绕过验证，因为隧道流量也来自本机。
- 登录有效期 12 小时；重启服务会使已有登录失效。修改口令后重启即可为新聚会换口令。
- 反向代理应透传 Cookie、Origin 和 WebSocket 升级请求，并且不要缓存 `/api/*`。

不配置 `room.public_url` 时保留原来的受信任局域网模式，没有房间登录。不要将这种模式直接发布到公网。

## 开唱顺序

1. 按 README 安装并构建项目；编辑配置后重启 KTV。
2. 在笔记本打开 `http://localhost:8080/admin`，输入主持人口令。查看 OpenList 是否在线。
3. 点击“扫描云盘 / NAS 曲库”。多来源可挂载到同一个 OpenList 根目录下。深层目录也支持扫描；较大曲库建议在本机管理页操作，避免隧道请求超时。
4. 手机关闭 Wi-Fi，用流量打开房间公网地址，输入来宾口令，搜索并点歌。
5. 笔记本 mpv 播放视频。通过 HDMI 或操作系统已有的无线屏幕镜像把笔记本画面送到电视；应用没有新增电视原生播放器或 Chromecast/AirPlay 协议实现。

## 视频和磁盘空间

通过 OpenList 扫描的歌曲使用 `openlist://` 来源标识。点歌时重新获取签名链接并直接流式播放，保留 KTV 的原伴声道控制；不同来源不会统一当成普通立体声视频。播放仍取决于视频本身的声道 / 音轨结构。

想准备离线备用歌曲，可在曲库页选择少量歌曲并下载。下载保存在 `library_path/remote/`，文件名使用来源路径摘要避免同名文件冲突；临时文件在完成并核对大小后才转为可用。再次点歌优先使用已有离线副本。失败后可重新选择下载。

**手动下载的文件不会自动清理，也没有 50 GB 自动上限。** 不要将整库批量下载作为外出前提；常规远程播放不会自动在该目录囤积视频。旧的百度 BDUSS 直连歌曲仍按原有下载流程工作，要使用流式模式，请通过 OpenList 扫描该来源。

原有本地、百度直连索引和下载文件保留。旧版 OpenList 的未标记路径不会自动改写；重新扫描后会生成新的 `openlist://` 记录，可能与旧记录显示为两个版本。确认新来源可用后再手动整理旧记录，不自动删除或迁移个人曲库。

## 出发前验证

- 手机关闭 Wi-Fi 后能登录、搜歌，页面连接状态显示“在线”。
- 连续点两首，确认暂停、原伴唱、切歌、重唱和重开可用。
- 关闭家庭 Wi-Fi、改用手机热点后，笔记本仍能访问 NAS 上的 OpenList 并播放。
- 在真正使用的电视上验证声音输出和屏幕镜像。低延迟优先用 HDMI。
- 准备几首离线备用歌曲；源端断线、百度限速或 NAS 上行带宽不足仍会影响视频。

应用代码测试不能代替上述真实外网与电视验证。未提供 NAS 地址、账号授权和隧道配置时，可以测试程序和模拟来源，但不能声称已连通你的家庭设备。
