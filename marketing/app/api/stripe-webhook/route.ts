import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createHmac, randomBytes } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key, { apiVersion: "2025-02-24.acacia" });
}

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    return NextResponse.json({ error: "missing signature or secret" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    return NextResponse.json(
      { error: `signature verification failed: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const email = session.customer_details?.email ?? session.customer_email;

    if (!email) {
      console.error("[stripe-webhook] no email on session", session.id);
      return NextResponse.json({ received: true });
    }

    const key = signLicenseKey({
      email,
      purchasedAt: Date.now(),
      sessionId: session.id,
    });

    await sendLicenseEmail({ to: email, licenseKey: key });
  }

  return NextResponse.json({ received: true });
}

// ── License key (HMAC-signed, offline-verifiable) ────────
//
// Format:  base64url(payloadJSON).base64url(hmacSha256)
//
// The app ships with the same LICENSE_SIGNING_SECRET baked in (or a public
// key if we later move to asymmetric). It verifies the signature locally
// without phoning home. Each install reads the key once on activation.
function signLicenseKey(payload: {
  email: string;
  purchasedAt: number;
  sessionId: string;
}): string {
  const secret = process.env.LICENSE_SIGNING_SECRET;
  if (!secret) throw new Error("LICENSE_SIGNING_SECRET not set");

  const body = {
    ...payload,
    nonce: randomBytes(8).toString("hex"),
    v: 1,
  };
  const payloadB64 = b64url(JSON.stringify(body));
  const sig = createHmac("sha256", secret).update(payloadB64).digest();
  return `${payloadB64}.${b64url(sig)}`;
}

function b64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Resend (transactional email) ─────────────────────────
async function sendLicenseEmail({ to, licenseKey }: { to: string; licenseKey: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? "寰宇KTV <noreply@huanyuktv.com>";
  if (!apiKey) {
    console.error("[stripe-webhook] RESEND_API_KEY not set; skipping email");
    return;
  }

  const html = renderLicenseEmail({ licenseKey });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: "你的寰宇KTV 激活码 🎤",
      html,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[stripe-webhook] resend failed", res.status, text);
  }
}

function renderLicenseEmail({ licenseKey }: { licenseKey: string }) {
  return `<!doctype html>
<html lang="zh-CN">
<body style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;background:#0a0a0c;color:#e8e8ee;padding:32px;">
  <div style="max-width:520px;margin:0 auto;background:#121216;border:1px solid #2a2a33;border-radius:12px;padding:32px;">
    <h1 style="margin:0 0 16px;font-size:22px;color:#f5b342;">感谢购买寰宇KTV</h1>
    <p style="margin:0 0 24px;line-height:1.7;color:#cfd0d6;">这是你的激活码，把它粘贴到 app 的"激活"窗口即可解锁永久使用。</p>
    <pre style="background:#0a0a0c;border:1px solid #2a2a33;border-radius:8px;padding:14px;font-size:12px;color:#f7c66d;word-break:break-all;white-space:pre-wrap;">${licenseKey}</pre>
    <p style="margin:24px 0 0;font-size:13px;color:#8b8c95;line-height:1.7;">
      · 同一邮箱可激活 3 台设备<br/>
      · 终身免费更新<br/>
      · 30 天无理由退款：直接回信即可
    </p>
    <p style="margin:24px 0 0;font-size:13px;color:#8b8c95;">有任何问题，直接回信。<br/>— Huanchen</p>
  </div>
</body>
</html>`;
}
