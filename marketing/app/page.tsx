import Link from "next/link";

const DOWNLOAD_MAC = "https://example.com/huanyu-ktv-mac.dmg";
const DOWNLOAD_WIN = "https://example.com/huanyu-ktv-win.exe";
const STRIPE_BUY_URL = "https://buy.stripe.com/test_REPLACE_ME";
const TAOBAO_URL = "https://shop.taobao.com/REPLACE_ME";
const SUPPORT_EMAIL = "hello@huanyuktv.com";

export default function Page() {
  return (
    <main className="bg-ink-900 text-slate-100">
      <Nav />
      <Hero />
      <PainPoint />
      <HowItWorks />
      <SongSource />
      <Comparison />
      <Founder />
      <Pricing />
      <FAQ />
      <Footer />
    </main>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-ink-700/60 bg-ink-900/80 backdrop-blur">
      <div className="container-prose flex h-14 items-center justify-between">
        <Link href="#top" className="font-display text-lg font-semibold tracking-wide text-glow">
          寰宇<span className="text-slate-100">KTV</span>
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <a href="#how" className="hidden px-3 py-1.5 text-slate-300 hover:text-glow sm:inline">
            如何使用
          </a>
          <a href="#source" className="hidden px-3 py-1.5 text-slate-300 hover:text-glow sm:inline">
            歌从哪来
          </a>
          <a href="#pricing" className="hidden px-3 py-1.5 text-slate-300 hover:text-glow sm:inline">
            价格
          </a>
          <a href={STRIPE_BUY_URL} className="btn-primary !py-2 !px-4 text-sm">
            立即购买
          </a>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden bg-glow-radial">
      <div className="container-prose pb-24 pt-20 text-center sm:pt-28">
        <span className="chip mb-6">海外华人 · Mac + Windows · 买断不订阅</span>
        <h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-slate-50 sm:text-6xl">
          在海外，<br className="sm:hidden" />
          把家变回 KTV 包厢
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-300 sm:text-xl">
          有真 MV ·  不用国内 IP ·  买断不订阅
        </p>

        <div className="mx-auto mt-12 aspect-video w-full max-w-3xl overflow-hidden rounded-xl border border-ink-600 bg-ink-800 shadow-2xl shadow-glow/10">
          {/* TODO: 替换为 30 秒演示视频（客厅+电视+你侧影） */}
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink-700 via-ink-800 to-ink-900">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border border-glow/40 bg-ink-900/60">
                <svg className="h-7 w-7 text-glow" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <p className="text-sm text-slate-400">演示视频准备中</p>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <a href={DOWNLOAD_MAC} className="btn-primary w-full sm:w-auto">
            <DownloadIcon />
            <span className="ml-2">Mac 下载</span>
          </a>
          <a href={DOWNLOAD_WIN} className="btn-ghost w-full sm:w-auto">
            <DownloadIcon />
            <span className="ml-2">Windows 下载</span>
          </a>
        </div>
        <p className="mt-4 text-sm text-slate-400">
          7 天免费试用 · 到期后 <span className="text-glow font-medium">$39</span>{" "}
          <span className="text-slate-500 line-through">$59</span> 一次性解锁 · 限时首发价
        </p>
      </div>
    </section>
  );
}

function PainPoint() {
  return (
    <section className="border-t border-ink-700/60 bg-ink-900 py-24">
      <div className="container-prose max-w-3xl text-center">
        <h2 className="section-title">为什么做这个</h2>
        <div className="mt-10 space-y-5 text-left text-lg leading-relaxed text-slate-300">
          <p>
            <span className="text-slate-100">Apple Music</span> 能跟唱，但没 MV，不算 KTV。
          </p>
          <p>
            <span className="text-slate-100">国内 K 歌软件</span> 要订阅、要国内 IP、还不能定制。
          </p>
          <p>
            <span className="text-slate-100">自己拼一套？</span> 硬盘、播放器、字幕、调音…… 一个晚上就过去了。
          </p>
          <p className="border-l-2 border-glow pl-5 text-slate-100">
            寰宇KTV：装上、接歌源、插 HDMI，开唱。
          </p>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "1",
      title: "下载 App",
      body: "Mac 与 Windows 双平台，免账号注册，下完即用。",
    },
    {
      n: "2",
      title: "接歌源",
      body: "淘宝预装硬盘、自己的网盘 / NAS、或本地视频文件，任选其一。",
    },
    {
      n: "3",
      title: "HDMI 接电视，开麦",
      body: "电脑作主机，电视当大屏，手机扫码点歌。客厅瞬间变包厢。",
    },
  ];

  return (
    <section id="how" className="border-t border-ink-700/60 bg-ink-800/40 py-24">
      <div className="container-prose">
        <div className="text-center">
          <h2 className="section-title">三步开唱</h2>
          <p className="section-sub">不超过 5 分钟</p>
        </div>
        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          {steps.map((s) => (
            <div
              key={s.n}
              className="rounded-xl border border-ink-700 bg-ink-900/60 p-7 transition hover:border-glow/40"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-glow/40 font-display text-lg font-semibold text-glow">
                {s.n}
              </div>
              <h3 className="mt-5 text-xl font-semibold text-slate-50">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SongSource() {
  return (
    <section id="source" className="border-t border-ink-700/60 bg-ink-900 py-24">
      <div className="container-prose">
        <div className="text-center">
          <h2 className="section-title">歌从哪来？</h2>
          <p className="section-sub">
            我们不提供任何歌曲文件。你有三个选择，任意组合：
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          <SourceCard
            badge="🛒"
            title="淘宝预装硬盘"
            body="联系店主定制曲库，邮寄到家，即插即用。适合不想折腾的人。"
            cta={{ label: "联系店主", href: TAOBAO_URL }}
            highlight
          />
          <SourceCard
            badge="☁️"
            title="自己的云盘 / NAS"
            body="百度网盘、Emby、Jellyfin、SMB 共享盘都能接入。曲库随你扩展。"
          />
          <SourceCard
            badge="📀"
            title="自己收集"
            body="任意 MP4 / MKV + LRC / ASS 字幕，本地拖入即用，完全离线。"
          />
        </div>

        <p className="mx-auto mt-12 max-w-2xl text-center text-xs text-slate-500">
          寰宇KTV 是一个本地播放工具，不分发受版权保护的影音内容。
          用户自行准备并合法使用所播放的素材。
        </p>
      </div>
    </section>
  );
}

function SourceCard({
  badge,
  title,
  body,
  cta,
  highlight,
}: {
  badge: string;
  title: string;
  body: string;
  cta?: { label: string; href: string };
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-7 transition ${
        highlight
          ? "border-glow/40 bg-ink-800/80 shadow-lg shadow-glow/5"
          : "border-ink-700 bg-ink-800/40 hover:border-ink-600"
      }`}
    >
      <div className="text-3xl">{badge}</div>
      <h3 className="mt-4 text-lg font-semibold text-slate-50">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
      {cta ? (
        <a
          href={cta.href}
          className="mt-4 inline-block text-sm font-medium text-glow hover:text-glow-soft"
        >
          {cta.label} →
        </a>
      ) : null}
    </div>
  );
}

function Comparison() {
  const rows = [
    { label: "真 MV 跟唱", apple: false, cn: true, hy: true },
    { label: "不需要国内 IP", apple: true, cn: false, hy: true },
    { label: "买断不订阅", apple: false, cn: false, hy: true },
    { label: "曲库可自定义扩展", apple: false, cn: false, hy: true },
    { label: "原声 / 伴奏一键切换", apple: false, cn: true, hy: true },
    { label: "手机扫码点歌", apple: false, cn: true, hy: true },
  ];

  return (
    <section className="border-t border-ink-700/60 bg-ink-800/40 py-24">
      <div className="container-prose">
        <div className="text-center">
          <h2 className="section-title">和现有方案比</h2>
        </div>
        <div className="mx-auto mt-12 max-w-3xl overflow-hidden rounded-xl border border-ink-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink-800/80 text-slate-300">
                <th className="px-5 py-4 text-left font-medium">功能</th>
                <th className="px-3 py-4 text-center font-medium">Apple Music</th>
                <th className="px-3 py-4 text-center font-medium">国内 K 歌</th>
                <th className="px-3 py-4 text-center font-medium text-glow">寰宇KTV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700/60">
              {rows.map((r) => (
                <tr key={r.label} className="bg-ink-900/40">
                  <td className="px-5 py-3 text-slate-200">{r.label}</td>
                  <td className="px-3 py-3 text-center">{r.apple ? <Check /> : <Cross />}</td>
                  <td className="px-3 py-3 text-center">{r.cn ? <Check /> : <Cross />}</td>
                  <td className="px-3 py-3 text-center">{r.hy ? <Check accent /> : <Cross />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Founder() {
  return (
    <section className="border-t border-ink-700/60 bg-ink-900 py-24">
      <div className="container-prose grid gap-12 md:grid-cols-2 md:items-center">
        <div>
          <h2 className="section-title">我是谁</h2>
          <div className="mt-6 space-y-4 text-lg leading-relaxed text-slate-300">
            <p>
              嗨，我是 <span className="text-slate-100">Huanchen</span>。
            </p>
            <p>
              在海外想唱歌，发现没有一款工具能在客厅好好用——
              要么没 MV，要么要国内 IP，要么得订阅一堆。
            </p>
            <p>
              所以我自己做了一个。先给自己用，用顺手了，决定也卖给同样想在家唱歌的你。
            </p>
            <p className="text-slate-400">
              有问题随时找我：
              <a className="text-glow hover:text-glow-soft" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>
            </p>
          </div>
        </div>
        <div className="aspect-video overflow-hidden rounded-xl border border-ink-600 bg-ink-800">
          {/* TODO: 替换为创始人正面唱歌视频（60 秒） */}
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink-700 via-ink-800 to-ink-900">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-glow/40 bg-ink-900/60">
                <svg className="h-6 w-6 text-glow" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <p className="text-xs text-slate-400">听我用寰宇KTV 唱一首</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="border-t border-ink-700/60 bg-ink-800/40 py-24">
      <div className="container-prose">
        <div className="text-center">
          <h2 className="section-title">定价</h2>
          <p className="section-sub">一次买断，终身使用</p>
        </div>

        <div className="mx-auto mt-12 max-w-md rounded-2xl border border-glow/40 bg-ink-900/80 p-8 shadow-2xl shadow-glow/10">
          <div className="text-center">
            <span className="chip border-glow/40 text-glow">限时首发价</span>
            <div className="mt-5 flex items-baseline justify-center gap-3">
              <span className="font-display text-5xl font-bold text-slate-50">$39</span>
              <span className="text-xl text-slate-500 line-through">$59</span>
            </div>
            <p className="mt-1 text-sm text-slate-400">一次性付费 · 不续费</p>
          </div>

          <ul className="mt-8 space-y-3 text-sm text-slate-300">
            <li className="flex gap-3">
              <Check accent />
              <span>Mac + Windows 双平台 license</span>
            </li>
            <li className="flex gap-3">
              <Check accent />
              <span>终身免费更新</span>
            </li>
            <li className="flex gap-3">
              <Check accent />
              <span>7 天免费试用，无需信用卡</span>
            </li>
            <li className="flex gap-3">
              <Check accent />
              <span>30 天无理由退款</span>
            </li>
            <li className="flex gap-3">
              <Check accent />
              <span>邮件 + Crisp 在线支持</span>
            </li>
          </ul>

          <div className="mt-8 flex flex-col gap-3">
            <a href={STRIPE_BUY_URL} className="btn-primary w-full">
              立即购买 $39
            </a>
            <a href={DOWNLOAD_MAC} className="btn-ghost w-full">
              先免费试用
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const items = [
    {
      q: "我没有歌库怎么办？",
      a: "可以联系淘宝店主定制预装硬盘，邮寄到家即插即用；也可以接你自己的网盘 / NAS；或者用任意 MP4 + LRC 字幕本地播放。",
    },
    {
      q: "一定要电视吗？显示器行不行？",
      a: "任何 HDMI 输出设备都可以，包括显示器、投影仪。电视的好处是音响通常更适合多人场景。",
    },
    {
      q: "支持哪些麦克风？",
      a: "USB 麦、3.5mm 麦、蓝牙麦、专业声卡都支持。系统能识别的输入设备都能用。",
    },
    {
      q: "字幕能调延迟吗？",
      a: "可以。app 内置字幕偏移调节，蓝牙音响延迟也能在播放器里实时校正。",
    },
    {
      q: "一台 license 能装几台？",
      a: "同一用户名下可以激活 3 台设备（够一台主机 + 一台备用 + 一台朋友家临时用）。",
    },
    {
      q: "支持哪些语种？",
      a: "MV 来源由你自己决定，任何语种都能播。app 界面目前是中文，英文版在路上。",
    },
    {
      q: "退款怎么走？",
      a: "30 天内任何原因发邮件给我（hello@huanyuktv.com），全额退款，不问理由。",
    },
  ];

  return (
    <section className="border-t border-ink-700/60 bg-ink-900 py-24">
      <div className="container-prose max-w-3xl">
        <div className="text-center">
          <h2 className="section-title">常见问题</h2>
        </div>
        <div className="mt-12 divide-y divide-ink-700/60 overflow-hidden rounded-xl border border-ink-700">
          {items.map((item) => (
            <details key={item.q} className="group bg-ink-800/40 open:bg-ink-800/70">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-base font-medium text-slate-100 transition hover:text-glow">
                <span>{item.q}</span>
                <span className="text-glow transition group-open:rotate-45">+</span>
              </summary>
              <div className="px-6 pb-6 text-sm leading-relaxed text-slate-400">{item.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-ink-700/60 bg-ink-900 py-12">
      <div className="container-prose flex flex-col items-center gap-4 text-center text-sm text-slate-500 sm:flex-row sm:justify-between sm:text-left">
        <div>
          <div className="font-display text-base text-slate-300">
            寰宇<span className="text-glow">KTV</span>
          </div>
          <div className="mt-1 text-xs">© {new Date().getFullYear()} 寰宇KTV. All rights reserved.</div>
        </div>
        <div className="flex gap-5 text-xs">
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-glow">
            联系
          </a>
          <a href="/privacy" className="hover:text-glow">
            隐私
          </a>
          <a href="/refund" className="hover:text-glow">
            退款
          </a>
          <a href="/terms" className="hover:text-glow">
            条款
          </a>
        </div>
      </div>
    </footer>
  );
}

function Check({ accent }: { accent?: boolean }) {
  return (
    <svg
      className={`mx-auto h-5 w-5 ${accent ? "text-glow" : "text-emerald-400"}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function Cross() {
  return (
    <svg
      className="mx-auto h-4 w-4 text-slate-600"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
