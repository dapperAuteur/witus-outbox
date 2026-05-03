import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SKEW_SECONDS = 5 * 60;

export interface VerifyArgs {
  secret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
}

/**
 * HMAC-SHA256 over `${timestamp}.${rawBody}`, hex-encoded.
 * Reject if the timestamp is missing, unparseable, or older than 5 minutes
 * (replay protection).
 */
export function verifySignature({
  secret,
  timestamp,
  rawBody,
  signature,
}: VerifyArgs): boolean {
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function signPayload(secret: string, rawBody: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return { timestamp, signature };
}
