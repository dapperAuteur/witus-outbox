/**
 * Reference sender for the WitUS Outbox signed-webhook contract.
 *
 * Copy this file into your publisher product (or import from this repo) and
 * call `sendToOutbox(...)` after your user-facing response is rendered.
 * Dependency-free apart from Node's built-in `crypto` module and the runtime
 * `fetch`.
 *
 * Three rules for callers:
 *   1. Sign the exact bytes you send. Don't re-serialize JSON between hashing
 *      and POSTing; whitespace, key order, and number formatting matter.
 *   2. Don't block the user-facing response on this. Fire-and-forget after
 *      your "thank you" page renders (for example, via Next.js `after()`).
 *   3. Log at most `source`, `platform`, `external_ref`, and the HTTP status.
 *      Never log the caption, media URLs, the secret, or the signature.
 */
import { createHmac } from "node:crypto";

export type OutboxPlatform =
  | "twitter"
  | "instagram"
  | "facebook"
  | "linkedin"
  | "youtube"
  | "bluesky"
  | "tiktok"
  | "pinterest";

export interface OutboxSubmission {
  /** Stable idempotency key from the publisher; (source, external_ref) is unique. */
  external_ref: string;
  platform: OutboxPlatform;
  caption: string;
  /** Public https URLs, ≤5MB each. Empty array allowed. */
  media_urls: string[];
  links?: string[];
  /** ISO-8601 UTC. Receiver requires ≥ now + 5 minutes. */
  scheduled_at: string;
}

export interface SendArgs {
  /** Full URL of the receiver, e.g. `https://outbox.your-domain.example/api/ingest`. */
  outboxUrl: string;
  /** Lowercase kebab slug; must match an entry in the receiver's `INGEST_SOURCES`. */
  sourceSlug: string;
  /** Same `hmac_secret` the receiver has configured for this slug. ≥32 chars. */
  hmacSecret: string;
  submission: OutboxSubmission;
}

export interface SendResult {
  ok: boolean;
  status: number;
  /** UUID assigned by the receiver on success. */
  id?: string;
  /**
   * Receiver-side row status echoed in the response body. `"queued"` means
   * the row was freshly created. Any other value (`"submitted"`, `"error"`,
   * `"posted"`, `"cancelled"`, `"scheduled"`) means an existing row was
   * matched on `(source, external_ref)` — the POST was idempotent. Callers
   * can use this to distinguish freshly-created vs duplicate from one HTTP
   * round trip.
   */
  recordStatus?: string;
  /** Raw response body when `ok` is false; useful for logs. */
  detail?: string;
}

export async function sendToOutbox(args: SendArgs): Promise<SendResult> {
  const rawBody = JSON.stringify(args.submission);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", args.hmacSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const res = await fetch(args.outboxUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Witus-Source": args.sourceSlug,
      "X-Witus-Timestamp": timestamp,
      "X-Witus-Signature": `sha256=${signature}`,
    },
    body: rawBody,
  });

  const text = await res.text();
  let body: { ok?: boolean; id?: string; status?: string } = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* leave empty */
  }

  if (res.ok && body.ok && body.id) {
    return {
      ok: true,
      status: res.status,
      id: body.id,
      recordStatus: body.status,
    };
  }
  return { ok: false, status: res.status, detail: text };
}
