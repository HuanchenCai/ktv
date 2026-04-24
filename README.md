# KTV 家庭点歌系统

手机扫码点歌 → 百度盘按需下载 → 本地存储 → mpv 播放 → 电视显示 + 音响出伴奏。

**架构**：单个本地 Node.js 应用管一切（backend + OpenList + mpv），NAS 可选充当存储。适合个人用，也适合打包后分享给其他人。

完整设计见 [实施方案](../../Users/huanc/.claude/plans/floating-baking-snail.md)。

## 快速开始

### 0. 前置

- **Node 22+**（本项目用 Node 24 里内置的 `node:sqlite`，免 VS 编译）
- **mpv**：Windows `winget install shinchiro.mpv`，Mac `brew install mpv`
- **百度盘 SVIP 账号**（你自己的 KTV 曲库所在账号）

### 1. 安装 + 拉 OpenList + 打包 web

```bash
cd H:/Projects/KTV
npm run setup
```

干了三件事：装 node 依赖、下载 OpenList 二进制到 `bin/`、打包 Vue 前端到 `web/dist/`。

### 2. 启动

```bash
npm start
```

启动时会：
- 从 `config.example.json` 拷贝一份 `config.json`（如果还没有）
- 拉起 OpenList 子进程（:5244）
- 拉起 mpv 子进程
- Fastify 监听 :8080，同时 serve 手机 Web UI

日志里会看到：

```
[openlist] Successfully created the admin user and the initial password is: XXXXXXXX
```

**这个密码记下来**（首次启动才打印一次），下一步要用。

### 3. 配置 OpenList（一次性）

浏览器打开 http://localhost:5244，用 `admin` + 上面的密码登录。

**加两个存储：**

**存储 1：百度盘（只读源）**
- 管理 → 存储 → 添加
- 驱动：`BaiduNetdisk` 或 `Baidu.OnlineAPI`（推荐 OAuth，免 cookie）
- 挂载路径：`/baidu`
- 按指引扫码登录你的百度账号（SVIP）

**存储 2：本地（可写目标）**
- 再加一个
- 驱动：`Local`
- 挂载路径：`/local`
- Root folder path：填 `config.json` 里 `library_path` 对应的**本地真实路径**，例如 `H:\ktv-library` 或 `Z:\KTV`（挂载的 NAS）

**拿 API token：** OpenList 右上角用户菜单 → 我的 → 我的 Token，复制。

### 4. 填 config.json

编辑 `H:/Projects/KTV/config.json`：

```json
{
  "library_path": "H:/ktv-library",      // 或你的 NAS 盘符路径，如 "Z:/KTV"
  "baidu_root": "/baidu/KTV",            // OpenList 里百度盘存储下你放 KTV 的子目录
  "openlist": {
    "api_token": "粘贴你刚才复制的 token"
  }
}
```

重启 backend（Ctrl+C 然后 `npm start`）。

### 5. 扫描曲库入索引

浏览器打开 **http://localhost:8080/admin**（手机也能扫那上面的二维码），点"开始扫描"。等几秒到几分钟，曲库里所有 MV 的元数据（标题/艺人/拼音/大小）就进 SQLite 了。

### 6. 开唱

手机扫 admin 页上的二维码（或直接访问 `http://<本机-LAN-IP>:8080`）：
- **搜歌**页：拼音首字母（例 "zyn" → 只有你）
- **已点**页：看队列 + 下载进度条 + 置顶/删除
- **播放**页：原唱/伴唱、切歌、重唱、音量

第一次点一首没缓存的歌，backend 会通过 OpenList 从百度盘下载到 `library_path/`，下好自动播。重复点就秒播。

## 目录结构

```
├── package.json / package-lock.json
├── config.example.json        # 模板；运行时会自动拷一份成 config.json
├── README.md                  # 本文件
├── backend/                   # Node 20 + Fastify + node-mpv + node:sqlite
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts           # 入口，编排所有子进程
│       ├── config.ts          # JSON 配置加载 + 路径推断
│       ├── db.ts              # SQLite schema + withTransaction
│       ├── pinyin.ts          # 汉字 → 每字首字母
│       ├── openlist-client.ts # REST: fs/list, fs/copy, task/copy/*
│       ├── openlist-spawner.ts# 起 OpenList 子进程
│       ├── mpv-controller.ts  # node-mpv 封装，含 @karaoke 切声道
│       ├── queue-orchestrator.ts  # 队列 + 下载调度 + 播放衔接
│       ├── scanner.ts         # 扫百度盘入库
│       ├── api/               # REST 路由
│       └── ws.ts              # WebSocket 广播
├── web/                       # Vue 3 + Vite + Tailwind 手机前端
│   └── src/
│       ├── App.vue            # 底部 tab 导航
│       ├── views/             # Search / Queue / NowPlaying / Admin
│       └── lib/               # api.ts / ws.ts
├── scripts/
│   ├── fetch-openlist.mjs     # 平台自识别下载 openlist 二进制
│   ├── start.bat              # Windows 包装脚本（纯 ASCII）
│   └── start.sh               # Mac/Linux 包装脚本
├── bin/                       # openlist 二进制（gitignored）
├── openlist-data/             # OpenList 自己的数据目录（gitignored）
└── data/                      # SQLite 数据库落地（gitignored）
```

## 开发命令

```bash
npm start                # 生产启动
npm run dev              # backend watch 模式
cd web && npm run dev    # web dev server (Vite), 代理到 :8080
npm test                 # vitest 跑单元测试
npm run typecheck        # TS 类型检查
```

## M0 Brown M&M 验证（可选，架构风险检查）

如果你想在开干前先单独验证最高风险的三件事，见 [plan 里的 M0 章节](../../Users/huanc/.claude/plans/floating-baking-snail.md#里程碑)。
核心三件事现在都被业务代码覆盖了，走完上面的快速开始流程就相当于跑了 M0。

## 已知限制

- **OpenList 的百度盘驱动可能被百度风控**，要备着 cookie/token 失效要重新登录。
- **跨海外 IP 限速风险**：Stockholm 到百度服务器速度待实测。
- **mpv 切声道依赖发行商约定**：B'in、雷石、视易 L/R 谁原唱谁伴奏不统一，UI 提供"这首 L/R 反了"按钮按首歌校正。

## 后续里程碑

见 [plan](../../Users/huanc/.claude/plans/floating-baking-snail.md) M2-M4。

## 许可

（待定）
