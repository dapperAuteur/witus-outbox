# Trigger recipe — wanderlearn: destinations / module completion / tours

> Pair this file with [INTEGRATE.md](../INTEGRATE.md) for gate logic, sender setup, and smoke checklist.

---

## What this triggers on

Three events from wanderlearn:

| # | Event | `external_ref` | Default platforms | Notes |
|---|---|---|---|---|
| W1 | New destination added | `wl-destination-{destinationId}` | twitter, bluesky, instagram | Destinations are highly visual; instagram included |
| W2 | Class module completed (by BAM or any user) | `wl-module-{courseId}-{moduleId}-{userIdHash}` | twitter, bluesky | Aggregate or per-event TBD; see Volume guard below |
| W3 | New tour created | `wl-tour-{tourId}` | linkedin, twitter, bluesky | Tours are bookable products; LinkedIn included for B2B reach |

Slug: `wanderlearn`. One slug, three trigger functions sharing the same `fireOutboxDrafts` helper.

---

## Pre-reqs (operator side)

- `wanderlearn` slug provisioned in outbox's `INGEST_SOURCES` ✓
- Env vars: `OUTBOX_INGEST_URL`, `OUTBOX_SOURCE_SLUG=wanderlearn`, `OUTBOX_INGEST_SECRET`, `OUTBOX_TRIGGER_ENABLED` (off by default), `PRODUCT_OWNER_USER_ID`

---

## Trigger code

### Step 0 — install the layered-gate helper

Per [INTEGRATE.md](../INTEGRATE.md) Step 2.

### W1. New destination added

Where: in the destination-creation flow, after persist.

```ts
fireOutboxDrafts({
  triggerUserId: destination.creatorId,
  externalRefBase: `wl-destination-${destination.id}`,
  caption: `New destination: ${destination.name}, ${destination.country}. ${destination.tagline}`,
  mediaUrls: destination.heroImageUrl ? [destination.heroImageUrl] : [],
  platforms: ["twitter", "bluesky", "instagram"],
});
```

If destinations are operator-curated (only BAM creates), the BAM-only gate naturally limits firing. If users can submit destinations (e.g. community contributions), gate by `is_published` flag — fire only when BAM approves and publishes.

### W2. Class module completed

Where: in the spaced-repetition / course-completion flow, after a module's status flips to `completed`.

```ts
import { hashUserId, anonymizedHandle } from "@/lib/outbox-trigger";

fireOutboxDrafts({
  triggerUserId: completion.userId,
  externalRefBase: `wl-module-${course.id}-${module.id}-${hashUserId(completion.userId)}`,
  caption: completion.userId === BAM_USER_ID
    ? `Just completed "${module.title}" in the ${course.title} course.`
    : `${anonymizedHandle(completion.user)} just completed "${module.title}" — making progress in ${course.title}.`,
  platforms: ["twitter", "bluesky"],
});
```

PII guard: when ANY user completes a module (not just BAM), use `anonymizedHandle` — never the user's full name or email.

**Volume guard:** module completions can be very frequent (a single user might finish 10 modules in a session). Two strategies, pick one:

1. **Per-event firing (default above)** — every completion fires drafts. Easy to set up; can produce 10+ drafts in an afternoon.
2. **Per-course-completion only** — fire only when ALL modules in a course are done. `external_ref = wl-course-completed-${courseId}-${userIdHash}`. Higher-signal posts; lower volume.

Recommend (2) once you have data on the cadence. Start with (1) for visibility into how often it fires.

### W3. New tour created

Where: in the tour-creation flow, after persist.

```ts
fireOutboxDrafts({
  triggerUserId: tour.creatorId,
  externalRefBase: `wl-tour-${tour.id}`,
  caption: `New tour: ${tour.title}. ${tour.duration} · ${tour.region}. Booking opens ${tour.bookingOpenDate}. ${tour.url}`,
  mediaUrls: tour.heroImageUrl ? [tour.heroImageUrl] : [],
  platforms: ["linkedin", "twitter", "bluesky"],
});
```

If tour pricing or capacity changes after announcement, the `external_ref = wl-tour-{tourId}` is stable — outbox returns the existing row id; no duplicate. Operator edits the draft caption to reflect the change OR uses the slice-33 detail-page edit.

---

## Smoke each trigger separately

1. Local: wire W1 only. Add a destination as BAM. Confirm 3 drafts at `/outbox?source=wanderlearn&status=draft`.
2. Add W2. Complete a module. Confirm drafts. Smoke as a non-BAM test user too — confirm anonymization works.
3. Add W3. Create a tour. Confirm drafts.
4. Production: roll out one trigger at a time, with at least 24 hrs between each, so you can spot regression.

---

## Reference

- [INTEGRATE.md](../INTEGRATE.md) — gate logic + sender + smoke template.
- [sender.ts](../sender.ts) — copy verbatim into `wanderlearn/lib/sender-outbox.ts`.
- [`flashlearn-ai.md`](./flashlearn-ai.md) — sibling pattern; 4d (challenge completed by another user) is the closest analog to W2 for the anonymization shape.
