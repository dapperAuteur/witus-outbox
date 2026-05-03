import "server-only";
import { getEnv } from "./env";

export interface SendArgs {
  to: string;
  from: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
  replyTo?: string;
  inReplyTo?: string;
}

export interface SendResult {
  ok: boolean;
  detail?: string;
}

/**
 * Thin Mailgun wrapper, ported from witus.online. POSTs to api.mailgun.net.
 * Dev-mode contract: if MAILGUN_API_KEY or MAILGUN_DOMAIN is missing, logs
 * the payload and returns ok: true with detail="dev-log".
 */
export async function sendMail(args: SendArgs): Promise<SendResult> {
  const env = getEnv();
  const apiKey = env.MAILGUN_API_KEY;
  const domain = env.MAILGUN_DOMAIN;

  if (!apiKey || !domain) {
    if (process.env.VERCEL_ENV === "production") {
      console.error(
        "[mailgun] refusing to send: MAILGUN_API_KEY or MAILGUN_DOMAIN unset in production"
      );
      return {
        ok: false,
        detail: "mailgun creds missing in production",
      };
    }
    console.warn(
      "[mailgun] MAILGUN_API_KEY or MAILGUN_DOMAIN missing. Logging payload instead of sending (dev mode)."
    );
    console.log("[mailgun:dev]", {
      to: args.to,
      from: args.from,
      subject: args.subject,
      replyTo: args.replyTo,
      inReplyTo: args.inReplyTo,
      headers: args.headers,
      text: args.text,
    });
    return { ok: true, detail: "dev-log" };
  }

  const body = new URLSearchParams();
  body.set("from", args.from);
  body.set("to", args.to);
  body.set("subject", args.subject);
  body.set("text", args.text);
  if (args.replyTo) body.set("h:Reply-To", args.replyTo);
  if (args.inReplyTo) body.set("h:In-Reply-To", args.inReplyTo);
  if (args.headers) {
    for (const [key, value] of Object.entries(args.headers)) {
      body.set(`h:${key}`, value);
    }
  }

  const auth = Buffer.from(`api:${apiKey}`).toString("base64");
  try {
    const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, detail: `Mailgun ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { id?: string; message?: string };
    return { ok: true, detail: data.id ?? data.message };
  } catch (err) {
    return { ok: false, detail: `Mailgun fetch failed: ${String(err)}` };
  }
}
