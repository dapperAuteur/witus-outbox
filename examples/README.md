# Examples

Reference code for callers wiring their publisher products to send signed publish-requests to a WitUS Outbox receiver.

| File | Purpose |
|---|---|
| [`sender.ts`](./sender.ts) | Dependency-free TypeScript sender library. Single exported function `sendToOutbox`. ~70 lines. Copy into your publisher product or import from this repo. |

## Quickest possible integration

```ts
import { sendToOutbox } from "./sender";

const result = await sendToOutbox({
  outboxUrl:   process.env.OUTBOX_INGEST_URL!,    // e.g. https://outbox.witus.online/api/ingest
  sourceSlug:  process.env.OUTBOX_SOURCE_SLUG!,   // your publisher slug, e.g. "centenarianos"
  hmacSecret:  process.env.OUTBOX_INGEST_SECRET!, // matches the receiver's hmac_secret for this slug
  submission: {
    external_ref: "ep-12-quote-card",       // your stable idempotency key
    platform: "linkedin",
    caption: "What if longevity isn't about adding years…",
    media_urls: ["https://cdn.example.com/ep-12-quote.png"],
    scheduled_at: "2026-05-12T14:00:00Z",   // ISO-8601 UTC, ≥ now + 5min
  },
});

if (!result.ok) {
  console.error("[outbox] failed", { status: result.status, source: process.env.OUTBOX_SOURCE_SLUG });
}
```

The function returns `{ ok, status, id?, detail? }`. On success, `id` is the `scheduled_post` UUID the receiver assigned. On duplicate `(source, external_ref)`, the receiver returns the existing row's id with its current status — safe to call multiple times.

## Use from a Next.js Server Action

```ts
"use server";
import { after } from "next/server";
import { sendToOutbox } from "@/examples/sender";

export async function schedulePostFromMyApp(form: { caption: string; mediaUrl: string; whenIso: string }) {
  // 1. Persist the draft locally + render the user-facing response immediately.
  const draftId = await persistLocally(form);
  const userResponse = renderConfirmation(draftId);

  // 2. Fire-and-forget the outbox call after the response is sent.
  after(async () => {
    await sendToOutbox({
      outboxUrl:   process.env.OUTBOX_INGEST_URL!,
      sourceSlug:  process.env.OUTBOX_SOURCE_SLUG!,
      hmacSecret:  process.env.OUTBOX_INGEST_SECRET!,
      submission: {
        external_ref: draftId,
        platform: "twitter",
        caption: form.caption,
        media_urls: [form.mediaUrl],
        scheduled_at: form.whenIso,
      },
    });
  });

  return userResponse;
}
```

## Three rules for callers

1. **Sign exactly `${unix_timestamp}.${request_body_bytes}`.** Don't re-serialize the JSON between hashing and POSTing — whitespace, key order, and number formatting are part of the signature.
2. **Don't block the user response.** Outbox runs `after()` to submit to the publisher backend; your side should also be fire-and-forget so the publisher isn't waiting on outbox latency.
3. **Log only `source`, `platform`, `external_ref`, `http_status`.** Never log captions, media URLs, the secret, or the signature.

## Picking specific profiles per post (optional)

Outbox's default behavior: it picks profiles for you using the receiver-side `default_publisher_profile` config, falling back to any-match. That works for most cases — set the defaults once in `/outbox/setup` and forget.

If your publisher has a UI where the user picks specific accounts per post (e.g. "post to LinkedIn-Personal not LinkedIn-Company"), include the chosen ids in the payload:

```ts
const result = await sendToOutbox({
  outboxUrl, sourceSlug, hmacSecret,
  submission: {
    external_ref: "ep-12-quote-card",
    platform: "linkedin",
    caption: "…",
    media_urls: [ /* … */ ],
    scheduled_at: "2026-05-12T14:00:00Z",
    social_profile_ids: ["60a1e22e356a770e6a115749"],   // ← payload override
  },
});
```

Resolution order on the receiver (top wins):

1. **payload `social_profile_ids`** — what your publisher chose.
2. **per-row override** — what the operator set later in outbox's detail-page UI.
3. **workspace default** — what's configured at `/outbox/setup`.
4. **any-match fallback** — most-recently-synced profile for the (backend, network, workspace).
5. **none** — row goes to `status=error` with `code=no_social_profile`.

Each id must exist in outbox's `social_profile` cache for the resolved `(publisher_backend, workspace)`. Invalid ids return `400 { error: "unknown_profile_ids", unknown: [...] }` from the receiver — fix the publisher-side selection and retry.

Discover available ids: sign in to outbox as admin → `/outbox/setup` → the **Default profiles** panel lists every cached profile with its id and display name. Workspace configuration in `OCOYA_WORKSPACE_IDS` decides which workspace your slug's posts target (per the slug's `workspace_name` in `INGEST_SOURCES`).

## What the receiver does

- Verifies the HMAC + 5-minute timestamp window. Rejects 401 on any mismatch.
- Validates the payload shape with Zod. Rejects 400 on schema failure.
- When `social_profile_ids` is present, validates each id against the local `social_profile` cache. Rejects 400 with `{error: "unknown_profile_ids", unknown: [...]}` if any are missing.
- Idempotent on `(source, external_ref)`: a duplicate returns the existing row's id with its current status; no second insert.
- Inserts the row as `status=queued` (storing `social_profile_ids` as the row's `publisher_profile_ids_override`), returns 200 with the row id.
- In `after()`: resolves profiles via the layered resolver (payload → row override → workspace default → fallback) and submits to the active publisher backend. On success the row flips to `submitted` with the publisher's external id; on permanent failure it flips to `error` and outbox fires SMS+email alerts.

## Onboarding a new publisher

The full step-by-step (slug naming, HMAC secret distribution across three environments, smoke test) lives in the receiver's user-task queue at `plans/user-tasks/04-ingest-sources-hmac-secrets.md` and the canonical inbox-side guide at [witus-inbox/examples/README.md](https://github.com/dapperAuteur/witus-inbox/blob/main/examples/README.md). The flow is identical apart from the URL + payload shape.

## What's NOT here

- Per-platform character limits / link unfurling rules. Handle in your publisher product before submitting.
- A retry queue. Fire-and-forget is the contract; the receiver's reconciler handles publisher-side retries.
- Authoring UI for captions or media. That belongs in your product, not outbox.
