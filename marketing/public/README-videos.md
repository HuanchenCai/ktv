# Demo Videos — Shot List

落到这个目录的文件命名：

| 文件名 | 用途 | 时长 |
|---|---|---|
| `hero.mp4` | Hero 段大视频 | 30s |
| `hero.jpg` | Hero 视频海报图 (1920x1080) | — |
| `founder.mp4` | 创始人段视频 | 60s |
| `founder.jpg` | Founder 视频海报图 | — |

拍完后在 `app/page.tsx` 把 hero / founder 两个占位 `<div>` 换成 `<video>` 标签：

```tsx
<video
  className="h-full w-full object-cover"
  poster="/hero.jpg"
  controls
  preload="metadata"
>
  <source src="/hero.mp4" type="video/mp4" />
</video>
```

## Hero 视频（30 秒）

**场景**：海外华人客厅，关大灯，电视 + 一盏侧灯营造 KTV 氛围。

**镜头**：固定机位，三脚架，拍电视 + 你侧影。

**分镜**：
- 0:00 — 0:05  你拿麦走到电视前坐下
- 0:05 — 0:12  手机扫码、点歌界面展示
- 0:12 — 0:18  歌曲加载，MV 跳出，字幕亮起
- 0:18 — 0:30  你唱副歌一句（不用整首）

**收音**：现场混响真实感强，不要后期配音。

## Founder 视频（60 秒）

**场景**：同一客厅，正面机位对你。

**分镜**：
- 0:00 — 0:10  你正脸对镜头：「嗨，我是 Huanchen…」简单 30 字介绍
- 0:10 — 0:50  你唱拿手歌一段（30-40s），切几个电视画面 cut-in
- 0:50 — 0:60  收尾，"如果你也想在家里这样，下载试试"

**歌曲建议**：选 90s-00s 华语经典（《十年》《光辉岁月》《海阔天空》《童年》类），不要太新的网络歌。

## 拍摄技术参数

- **分辨率**：1080p 即可（用户网速参差，4K 反而拖加载）
- **格式**：导出 H.264 mp4，码率 4-6 Mbps
- **可选 webm 副本**：用 `ffmpeg -i hero.mp4 -c:v libvpx-vp9 -crf 32 -b:v 0 hero.webm` 出一个，浏览器优先用 webm，体积小一半
- **海报图**：从视频里截一帧最好看的，1920x1080 jpg，质量 85
