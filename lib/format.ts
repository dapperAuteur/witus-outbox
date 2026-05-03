/**
 * Format an absolute date for the operator UI. Returns a compact form like
 * "Mar 15, 2:00 PM" — readable at 360px without wrapping. Always uses the
 * server's locale (which is the operator's; this is single-admin) so output
 * is stable across reloads without client-side hydration concerns.
 */
export function formatScheduledTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * Truncate a caption for list previews. Tries to break at a word boundary
 * when possible. Charter §3 says "log only metadata" — this helper is for
 * UI rendering, not logging.
 */
export function truncateCaption(caption: string, max = 80): string {
  if (caption.length <= max) return caption;
  const sliced = caption.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace > max * 0.6) return `${sliced.slice(0, lastSpace)}…`;
  return `${sliced}…`;
}
