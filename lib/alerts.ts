import "server-only";
import { getEnv } from "./env";
import { sendMail } from "./mailgun";
import { sendSms } from "./sms";

export interface OutboxAlertArgs {
  /** Origin of the failure: "ingest" or "reconcile". */
  origin: "ingest" | "reconcile";
  scheduledPostId: string;
  source: string;
  platform: string;
  /** Final status of the row at alert time. */
  status: "error" | "queued";
  /** Short error code or HTTP status. NEVER the full caption or media URLs. */
  errorCode: string;
  /** Optional publisher external ID, when one exists. */
  externalId?: string;
  /** ISO scheduled time, for operator context. */
  scheduledAt: string;
}

export interface OutboxAlertResult {
  sms: { ok: boolean; detail?: string };
  email: { ok: boolean; detail?: string };
}

/**
 * Fires SMS + email when outbox detects a publisher-side failure.
 *
 * Charter §3 data-handling rules apply: payload contains only metadata
 * (post id, source, platform, error code, scheduled time, optional external
 * id). Never include caption, media URLs, or submitter fields.
 *
 * Both channels follow the dev-log + production-guard pattern from
 * `lib/sms.ts` and `lib/mailgun.ts`. Missing creds → dev-log in
 * non-production; refuse-to-send in production.
 */
export async function sendOutboxAlert(
  args: OutboxAlertArgs
): Promise<OutboxAlertResult> {
  const env = getEnv();
  const subject = `[outbox] ${args.origin} ${args.status}: ${args.platform} ${args.errorCode}`;
  const text = [
    `[outbox] post ${args.scheduledPostId} ${args.status}`,
    `origin=${args.origin}`,
    `source=${args.source}`,
    `platform=${args.platform}`,
    `error=${args.errorCode}`,
    args.externalId ? `external_id=${args.externalId}` : null,
    `scheduled_at=${args.scheduledAt}`,
  ]
    .filter((s): s is string => s !== null)
    .join("\n");

  const smsResult = await sendSms({
    text: `${subject}\nid=${args.scheduledPostId}`,
  });
  if (!smsResult.ok) {
    console.error("[alerts] sms failed detail=%s", smsResult.detail);
  }

  let emailResult: OutboxAlertResult["email"] = { ok: true, detail: "skipped" };
  const recipient = env.ALERT_EMAIL ?? env.ADMIN_EMAIL;
  const from = env.EMAIL_FROM;
  if (from) {
    const sent = await sendMail({
      to: recipient,
      from,
      subject,
      text,
    });
    emailResult = { ok: sent.ok, detail: sent.detail };
    if (!sent.ok) {
      console.error("[alerts] email failed detail=%s", sent.detail);
    }
  } else {
    console.warn("[alerts] EMAIL_FROM unset; skipping email leg");
  }

  return { sms: smsResult, email: emailResult };
}
