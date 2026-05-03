import "server-only";
import { randomUUID } from "node:crypto";
import { getEnv } from "./env";

// Mobile Text Alerts API v3. See:
// https://developers.mobile-text-alerts.com/api-reference/send
const MTA_ENDPOINT = "https://api.mobile-text-alerts.com/v3/send";

export interface SmsArgs {
  text: string;
  recipients?: string[];
  /**
   * Optional idempotency token. If a previous request with the same
   * X-Request-Id was already accepted, MTA returns 409 instead of sending
   * a duplicate. We auto-generate one when absent.
   */
  requestId?: string;
}

export interface SmsResult {
  ok: boolean;
  /** MTA's `data.messageId` on success; an error code or short reason on failure. */
  detail?: string;
}

export async function sendSms(args: SmsArgs): Promise<SmsResult> {
  const env = getEnv();
  const apiKey = env.MOBILE_TEXT_ALERTS_API_KEY;
  const envRecipients = parseRecipients(env.MOBILE_TEXT_ALERTS_RECIPIENTS);
  const recipients = args.recipients ?? envRecipients;

  if (!apiKey || recipients.length === 0) {
    if (process.env.VERCEL_ENV === "production") {
      console.error(
        "[sms] refusing to send: MOBILE_TEXT_ALERTS_API_KEY or recipients missing in production"
      );
      return {
        ok: false,
        detail: "mta creds missing in production",
      };
    }
    console.warn(
      "[sms] MOBILE_TEXT_ALERTS_API_KEY or recipients missing. Dev-log fallback."
    );
    console.log("[sms:dev]", { text: args.text, recipientCount: recipients.length });
    return { ok: true, detail: "dev-log" };
  }

  const requestId = args.requestId ?? randomUUID().replace(/-/g, "");

  try {
    const res = await fetch(MTA_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
      },
      body: JSON.stringify({
        message: args.text,
        subscribers: recipients,
      }),
      cache: "no-store",
    });
    // 409 means MTA already accepted a request with this X-Request-Id.
    // Treat as success — the prior request did the send; no duplicate.
    if (res.status === 409) {
      return { ok: true, detail: "duplicate-suppressed" };
    }
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as {
        type?: string;
        message?: string;
      };
      const reason = errBody.type ?? `mta-${res.status}`;
      return { ok: false, detail: reason };
    }
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      data?: { messageId?: string };
    };
    return { ok: true, detail: body.data?.messageId };
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    return { ok: false, detail: `mta-fetch-${code}` };
  }
}

function parseRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && /^\+\d{7,15}$/.test(v));
  } catch {
    return [];
  }
}
