# Integrating outbox into a publisher product

This is the **action playbook** for wiring a sibling product (witus.online, flashlearn-ai, centenarian-os, fly-witus, contractor-os, future apps) to fire signed publish-requests at WitUS Outbox. Hand this file to Claude Code in the publisher's working directory; it's self-contained.

> **Claude Code: how to fetch this doc.** If you're reading from a sibling repo and don't have the file locally, fetch it from this stable URL: `https://raw.githubusercontent.com/dapperAuteur/witus-outbox/main/examples/INTEGRATE.md`. The companion contract spec is at `https://raw.githubusercontent.com/dapperAuteur/witus-outbox/main/examples/README.md`, the canonical sender at `https://raw.githubusercontent.com/dapperAuteur/witus-outbox/main/examples/sender.ts`, and the per-product trigger recipes are under `https://raw.githubusercontent.com/dapperAuteur/witus-outbox/main/examples/triggers/<app>.md`.

---

## What you're building

Your publisher product needs to POST signed JSON to outbox's `/api/ingest` after a user-facing event (episode published, exercise completed, signup, etc.). Outbox stores the row, optionally fires the publisher backend (Ocoya / SocialChamp), and exposes a triage UI for review.

The integration is **fire-and-forget on your side**. You do not block the user response; you do not retry; you do not poll outbox for status. Outbox owns reconciliation.

---

## Pre-reqs from the operator (BAM)

Before you write code, confirm with BAM that the operator-side provisioning is done:

1. **Slug provisioned** in outbox's `INGEST_SOURCES` env (3 envs: local / Preview / Production). Each entry has a unique HMAC secret. The slug is one-word lowercase-kebab — e.g. `witus-online`, `flashlearn`, `centenarianos`, `flywitus`, `contractor-os`.
2. **Three env vars exist in your repo's Vercel project** (3 envs):
   - `OUTBOX_INGEST_URL` — `https://outbox.witus.online/api/ingest` (Production), Preview URL (Preview), `http://localhost:3000/api/ingest` (local).
   - `OUTBOX_SOURCE_SLUG` — must match the operator's `INGEST_SOURCES[slug].slug` exactly. Case-sensitive.
   - `OUTBOX_INGEST_SECRET` — the 64-char hex HMAC secret matching `INGEST_SOURCES[slug].hmac_secret`. **Required**: without it your signed POSTs all 401.
3. **Optional** but **strongly recommended**: `OUTBOX_TRIGGER_ENABLED` env var (default unset = off). Master kill-switch for this app's outbox triggers. Lets BAM mute everything from your app via Vercel env edit if a campaign goes viral or a bug ships.

If any of these are missing, **stop and ask BAM** before writing trigger code.

---

## Step 1 — copy the canonical sender

The sender library is `examples/sender.ts` in the outbox repo. Copy it byte-for-byte into your repo:

```sh
# From the publisher repo's working directory:
cp /path/to/witus-outbox/examples/sender.ts ./lib/sender-outbox.ts
```

If you can't use the local path, fetch from `https://raw.githubusercontent.com/dapperAuteur/witus-outbox/main/examples/sender.ts` and write to `./lib/sender-outbox.ts`.

**Do not modify the file.** AGENTS.md "do not let diverge" rule. The contract is shared between every publisher; forking the sender breaks the receiver's HMAC verification.

---

## Step 2 — write the trigger helper

Create `./lib/outbox-trigger.ts` (or whatever path matches your project conventions). This is the layered-gate wrapper that every trigger calls. Don't duplicate the gate logic per-trigger — bugs in one would silently diverge from the others.

```ts
import { after } from "next/server";
import { createHash } from "node:crypto";
import { sendToOutbox, type OutboxPlatform } from "./sender-outbox";

const OWNER_USER_ID = process.env.PRODUCT_OWNER_USER_ID; // BAM's user id in your DB

/**
 * Fire one outbox draft per platform. Caller decides:
 *   - what triggered (caption + external_ref + platforms)
 *   - whether the trigger should fire at all (passes triggerUserId)
 *
 * Three layered gates run BEFORE any network call:
 *   1. Master kill-switch (OUTBOX_TRIGGER_ENABLED env) — BAM can mute the
 *      whole app instantly without a code deploy.
 *   2. BAM-only smoke gate — only triggers from BAM's account fire while
 *      we're proving the integration. Removed (replaced by per-user
 *      opt-in) after BAM confirms smoke.
 *   3. Per-user opt-in (later) — see plans/future/per-user-opt-in.md.
 *
 * `as_draft: true` always — operator reviews + schedules from /outbox/[id]
 * before anything goes live. Override only for time-sensitive triggers
 * like "going live" where the post must fire immediately.
 */
export function fireOutboxDrafts(args: {
  triggerUserId: string;
  externalRefBase: string;
  caption: string;
  mediaUrls?: string[];
  platforms?: readonly OutboxPlatform[];
  scheduledAt?: Date;
  asDraft?: boolean;
}) {
  // Gate 1: kill-switch.
  if (process.env.OUTBOX_TRIGGER_ENABLED !== "true") return;
  // Gate 2: BAM-only during smoke. Remove after smoke completes.
  if (args.triggerUserId !== OWNER_USER_ID) return;
  // (Later) Gate 3: per-user opt-in.

  const platforms = args.platforms ?? (["twitter", "bluesky", "linkedin"] as const);
  const placeholderTime =
    args.scheduledAt ??
    new Date(Date.now() + 7 * 24 * 60 * 60_000); // now + 7d
  const asDraft = args.asDraft ?? true;

  after(async () => {
    for (const platform of platforms) {
      const result = await sendToOutbox({
        outboxUrl: process.env.OUTBOX_INGEST_URL!,
        sourceSlug: process.env.OUTBOX_SOURCE_SLUG!,
        hmacSecret: process.env.OUTBOX_INGEST_SECRET!,
        submission: {
          external_ref: `${args.externalRefBase}-${platform}`,
          platform,
          caption: args.caption,
          media_urls: args.mediaUrls ?? [],
          scheduled_at: placeholderTime.toISOString(),
          as_draft: asDraft,
        },
      });
      if (!result.ok) {
        // Log only metadata. NEVER caption / media URLs / secret / signature.
        console.error("[outbox-trigger] failed", {
          source: process.env.OUTBOX_SOURCE_SLUG,
          platform,
          external_ref_base: args.externalRefBase,
          http_status: result.status,
        });
      }
    }
  });
}

/** Stable user-id hash for external_ref. SHA-256 truncated to 8 chars. */
export function hashUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 8);
}

/**
 * Anonymized handle for captions when posting about another user's event.
 * NEVER full email or full name. Use the user's chosen handle if any;
 * otherwise initials + 4-char hash. Charter §3 PII rule.
 */
export function anonymizedHandle(user: {
  handle?: string | null;
  email: string;
}): string {
  if (user.handle) return `@${user.handle}`;
  const local = user.email.split("@")[0] ?? "user";
  const initials = local
    .split(/[._-]/)
    .map((s) => s.charAt(0).toUpperCase())
    .filter((c) => c.length > 0)
    .join("") || "U";
  const hash = createHash("sha256")
    .update(user.email)
    .digest("hex")
    .slice(0, 4);
  return `${initials}-${hash}`;
}
```

---

## Step 3 — wire each trigger

For each user-action that should fire outbox drafts, call `fireOutboxDrafts`. Ground rules:

- **`external_ref` must be stable across re-fires of the same logical event.** Outbox is idempotent on `(source, external_ref)`, so a re-publish of the same episode (or an at-least-once delivery from your retry layer) returns the existing row id; no duplicates. Bad shapes: `event-${Date.now()}` (unstable). Good shapes: `episode-${episode.id}-${platform}`, `study-session-${session.id}-${platform}`.
- **Trigger AFTER the database write succeeds** in your own product. If the DB write fails, the trigger should not fire — otherwise outbox sees an event for a state your product doesn't have.
- **Never include in the caption**: full user emails, full names, financial amounts, addresses, phone numbers, raw user ids. Use `anonymizedHandle()` and `hashUserId()` if you need cross-event correlation.

Examples of the trigger call shape — adapt to your product's events:

```ts
// Episode published (witus.online):
fireOutboxDrafts({
  triggerUserId: session.user.id,
  externalRefBase: `episode-${episode.id}`,
  caption: `New episode: "${episode.title}". ${episode.disctopiaUrl}`,
  mediaUrls: [episode.artworkUrl],
  platforms: ["linkedin", "twitter", "bluesky"],
});

// Study session completed (flashlearn-ai):
fireOutboxDrafts({
  triggerUserId: session.userId,
  externalRefBase: `study-session-${session.id}`,
  caption: `Just drilled ${session.cardCount} cards on "${deck.title}" — ${session.accuracyPct}% recall.`,
});

// Class enrollment (any product with classes):
fireOutboxDrafts({
  triggerUserId: enrolledBy.id,
  externalRefBase: `class-${class.code}-enrollment-${enrolledCount}`,
  caption: `${class.name} class is filling up — ${enrolledCount}/${class.capacity} seats taken.`,
});

// Going live (override default — time-sensitive):
fireOutboxDrafts({
  triggerUserId: stream.userId,
  externalRefBase: `live-${stream.id}`,
  caption: `🔴 Live now: ${stream.title}. ${stream.url}`,
  asDraft: false,                                  // ← bypass operator review
  scheduledAt: new Date(Date.now() + 5 * 60_000),  // ≥ 5 min in the future
});
```

---

## Step 4 — smoke test

For each trigger, in this order:

1. **Local.** Set `OUTBOX_TRIGGER_ENABLED=true` in `.env.local`. Run the action as BAM's user. Confirm:
   - One row per platform appears at `http://localhost:3000/outbox?source=<your-slug>&status=draft`.
   - Caption matches what your template produces; no PII (email, full name) leaked.
   - `media_urls` resolves to public, https, ≤5MB images.
2. **Local 401 negative test.** Temporarily set a wrong `OUTBOX_INGEST_SECRET`. Re-fire the trigger. Confirm your sender returns `result.ok === false` and your console logs only metadata (slug, status), no caption.
3. **Local idempotency test.** Re-fire the same logical event. Outbox returns the existing row id; no duplicates appear in the triage UI.
4. **Preview.** Deploy your branch with `OUTBOX_TRIGGER_ENABLED=true` only in Preview env. Outbox's Preview env should have `OCOYA_API_KEY` UNSET so promotion can't accidentally publish a real Ocoya post — verify with BAM if uncertain.
5. **Production.** Flip `OUTBOX_TRIGGER_ENABLED=true` in Production. Run one real action at a low-traffic time. Watch outbox. If anything looks wrong, flip it back to false instantly.

---

## Step 5 — open up to other users (later, after smoke completes)

Once each trigger has produced at least one successfully-published post in Production, remove the BAM-only gate from `fireOutboxDrafts`:

```ts
// REMOVE this line:
if (args.triggerUserId !== OWNER_USER_ID) return;

// REPLACE WITH per-user opt-in (per plans/future/per-user-opt-in.md):
const user = await db.query.users.findFirst({ where: eq(users.id, args.triggerUserId) });
if (!user?.shareToOutboxOptIn) return;
```

Add the `share_to_outbox_opt_in` boolean to your `users` table (default false) and a toggle on the user profile page. Default-off means existing users don't auto-trigger; only users who explicitly opt in do.

---

## The three rules you must not break

1. **Sign exactly `${unix_timestamp}.${request_body_bytes}`.** Don't re-serialize JSON between hashing and POSTing. Whitespace, key order, and number formatting are all part of the signature. The `sender.ts` library handles this correctly; don't fork it.
2. **Don't block the user response.** Outbox uses Next 16's `after()` itself; your side should also be fire-and-forget so the user isn't waiting on outbox latency.
3. **Log only `source`, `platform`, `external_ref`, `http_status`.** Never the caption, media URLs, the secret, or the signature. Charter §3 PII rule applies on every log line in the trigger path.

---

## Common errors + fixes

| HTTP status from outbox | Likely cause | Fix |
|---|---|---|
| 401 | `X-Witus-Source` header missing, unknown slug, signature mismatch, timestamp >5min skew | Verify `OUTBOX_SOURCE_SLUG` matches outbox's `INGEST_SOURCES`; verify `OUTBOX_INGEST_SECRET` matches; verify your server clock isn't skewed |
| 400 | Payload schema invalid OR `scheduled_at` <5min in future (and `as_draft` not set) | Check Zod errors in outbox's logs; default `as_draft: true` for ingest paths where you don't have a confirmed schedule |
| 400 `unknown_profile_ids` | `social_profile_ids` payload field includes ids not in outbox's social_profile cache for that workspace | Either omit `social_profile_ids` entirely (let outbox pick defaults), or have BAM run sync at /outbox/setup |
| 500 | Outbox-side database error | Check outbox logs (BAM has access); your sender's `result.detail` will have the SQLSTATE code |

---

## What this doc does NOT cover

- **Per-platform character limits** (Twitter 280, Bluesky 300, etc.) — handle in your caption template before submit. Outbox surfaces warnings in the in-app composer but doesn't enforce vendor-side limits.
- **Retry queue** — fire-and-forget is the contract. Outbox's reconciler handles publisher-side retries.
- **Caption authoring UI** — that belongs in your product, not in the trigger code. The trigger receives a finished caption.
- **Scheduling logic** — `scheduled_at` is a placeholder for drafts; the operator picks the real time at promote. For non-draft triggers (going live), pick `now + 5min` minimum.

---

## Per-app trigger recipes (start here for the actual events)

This file is the meta-playbook (gates, sender, smoke). For the concrete WHAT-triggers-and-HOW per product, read the per-app recipe:

| Product | Recipe | Triggers |
|---|---|---|
| witus.online | [`triggers/witus-online.md`](./triggers/witus-online.md) | Podcast publishing — covers BOTH BAM's "World's Fastest Centenarian" and AAMSAZ's podcast (two slugs, two workspaces, one trigger function) |
| bam-landing-page | [`triggers/bam-landing-page.md`](./triggers/bam-landing-page.md) | Blog post published |
| flashlearn-ai | [`triggers/flashlearn-ai.md`](./triggers/flashlearn-ai.md) | 5 events: study session, recall milestone, challenge created, challenge completed, public set |
| centenarian-os | [`triggers/centenarian-os.md`](./triggers/centenarian-os.md) | 22 events across tasks/goals/milestones/cadence/nutrition/fitness/business/content/academy/live |
| wanderlearn | [`triggers/wanderlearn.md`](./triggers/wanderlearn.md) | New destination · class module completed · new tour created |
| tour-witus | [`triggers/tour-witus.md`](./triggers/tour-witus.md) | Signups (via signups.md) · show date added · time-sensitive tour event (queued, not draft) |
| work-witus | [`triggers/work-witus.md`](./triggers/work-witus.md) | New job posted · invoice created/closed (event-only captions) |
| fly-witus | [`triggers/fly-witus.md`](./triggers/fly-witus.md) | Flight-log save → operator-reviewed draft |
| ANY (cross-cutting) | [`triggers/signups.md`](./triggers/signups.md) | Signups (free + paid) · class enrollment (ECS, FDAC, …) · ebook download milestones (betterbud-ecs, fdac, future lead-magnets) |
| betterbud-ecs / fdac | [`triggers/signups.md`](./triggers/signups.md) | Use the cross-cutting recipe — class enrollment + ebook download patterns are already covered |

Pattern: read INTEGRATE.md (this file) for the gate + sender setup once per app, then the per-app recipe for the concrete trigger calls.

## Reference

- `examples/sender.ts` — the canonical sender. Copy verbatim.
- `examples/README.md` — the contract spec (what outbox accepts, what the response shapes are).
- `examples/triggers/<app>.md` — per-product trigger recipes (above table).
- `plans/user-tasks/{09–13}.md` (BAM-local, gitignored) — operator provisioning checklists.
- `plans/future/admin-kill-switch.md` — the env-var pattern this doc uses for gate 1.
- `plans/future/per-user-opt-in.md` — the gate-3 pattern for after-smoke phase.
- `plans/future/ecosystem-outbox-scenarios.md` — the catalog of trigger ideas across the ecosystem.
