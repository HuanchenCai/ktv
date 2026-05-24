# 寰宇KTV — Marketing Site

Next.js 14 landing page for huanyuktv.com. Deploys to Vercel.

## 本地开发

```bash
cd marketing
npm install
cp .env.example .env.local   # 填入真实 key
npm run dev                  # http://localhost:3000
```

## 还要做的事（在上线前）

按重要性排序：

1. **买域名** — Cloudflare Registrar，`huanyuktv.com` 推荐，按批发价 ~$10/年
2. **拍 demo 视频** — 两段，参见 `public/README-videos.md`，放到 `public/hero.mp4` 和 `public/founder.mp4`
3. **填占位 URL** —— `app/page.tsx` 顶部几个常量：
   - `DOWNLOAD_MAC` / `DOWNLOAD_WIN` → 真实下载链接
   - `STRIPE_BUY_URL` → Stripe Payment Link
   - `TAOBAO_URL` → 你的淘宝店铺
   - `SUPPORT_EMAIL` → 你打算用的客服邮箱
4. **Stripe Payment Link** — dashboard 创建，定价 $39 一次性
5. **Resend** — 在 huanyuktv.com 验证发件域名
6. **Crisp** — 注册账号后把 `<script>` snippet 加到 `app/layout.tsx`
7. **隐私 / 退款 / 条款页** — 3 个 `app/(legal)/{privacy,refund,terms}/page.tsx`（footer 已经留好链接）

## Stripe + Resend 流程

```
用户点击购买
    ↓
Stripe Checkout (hosted)
    ↓
checkout.session.completed
    ↓
POST /api/stripe-webhook
    ↓
1. 验证 Stripe 签名
2. 生成 HMAC-签名的离线 license key
3. Resend 发激活邮件
```

激活码格式 `<base64url payload>.<base64url hmac>`，payload 含 email、购买时间、Stripe session id。

App 端需要内置 `LICENSE_SIGNING_SECRET` 来本地验签（HMAC 对称密钥）。
要更高安全等级可以换成 ed25519：服务端用私钥签，app 内置公钥验。

## 部署到 Vercel

```bash
# 在 marketing/ 目录里
npx vercel link        # 关联项目
npx vercel env add ... # 把 .env.local 里的变量传上去
npx vercel --prod      # 部署
```

Vercel project root 设为 `marketing/`（不是仓库根）。

## 部署到 Cloudflare（备选）

Next.js on Cloudflare Pages 用 `@cloudflare/next-on-pages`。如果完全不需要服务器渲染，可以 `output: 'export'` 出静态站。但 Stripe webhook 需要 Node runtime，那部分要么留在 Vercel，要么单独放 Cloudflare Workers。

最省事方案：站点 Vercel + DNS Cloudflare（指 CNAME 到 Vercel）。

## 视频占位资源

`public/README-videos.md` 描述了两段 demo 视频的拍摄要求。拍好后命名：

- `public/hero.mp4`（30s，客厅+电视+你侧影）
- `public/founder.mp4`（60s，你正脸唱歌）

加上对应的 `.webm` 副本和 `.jpg` 海报图可以再优化首屏体验。

## 文件结构

```
marketing/
├── app/
│   ├── api/stripe-webhook/route.ts   webhook → 发激活邮件
│   ├── globals.css                    Tailwind + 自定义样式
│   ├── layout.tsx                     html shell + metadata
│   └── page.tsx                       全部 landing 内容（单文件好改）
├── public/                            favicon / 演示视频
├── .env.example                       环境变量模板
├── next.config.mjs
├── package.json
├── postcss.config.mjs
├── tailwind.config.ts
└── tsconfig.json
```
