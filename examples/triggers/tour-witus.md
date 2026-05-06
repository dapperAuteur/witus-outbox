# Trigger recipe — tour-witus: signups / show dates / tour events

> Pair this file with [INTEGRATE.md](../INTEGRATE.md) for gate logic, sender setup, and smoke checklist.

---

## What this triggers on

Three event categories from tour-witus:

| # | Event | `external_ref` | Default platforms | Notes |
|---|---|---|---|---|
| T1 | Signup (free + paid) | (see [`signups.md`](./signups.md)) | per [`signups.md`](./signups.md) | Reuse the cross-cutting signups recipe; don't duplicate |
| T2 | Show date added | `tw-show-{showId}` | twitter, bluesky, instagram, linkedin | Each show is a discrete event; fire per show |
| T3 | Tour event happening (e.g. "showtime in 1 hour", "tickets selling out") | `tw-event-{eventId}` | twitter, bluesky | Time-sensitive — see Live override below |

Slug: `tour-witus`. The signups pattern (T1) is delegated to [`signups.md`](./signups.md) — implement it once and call it from the signup completion flow. T2 and T3 are tour-specific.

---

## Pre-reqs (operator side)

- `tour-witus` slug provisioned in outbox's `INGEST_SOURCES` ✓
- Env vars per the standard pattern from INTEGRATE.md.

---

## Trigger code

### Step 0 — install the layered-gate helper

Per [INTEGRATE.md](../INTEGRATE.md) Step 2.

### T1. Signup (free / paid)

Use the cross-cutting recipe at [`signups.md`](./signups.md). The trigger function `fireSignupTrigger` from that recipe applies as-is for tour-witus. Just call it from your signup-completion flow with the user's tier.

### T2. Show date added

Where: in the show-creation flow, after the row is persisted with a confirmed date.

```ts
fireOutboxDrafts({
  triggerUserId: show.creatorId,
  externalRefBase: `tw-show-${show.id}`,
  caption: `${show.title} — ${formatShowDate(show.startsAt)} at ${show.venueName}, ${show.venueCity}. ${show.ticketUrl}`,
  mediaUrls: show.posterImageUrl ? [show.posterImageUrl] : [],
  platforms: ["twitter", "bluesky", "instagram", "linkedin"],
});
```

Fire on **first add** only. Edits to date/venue/url should re-fire IF the operator wants to re-promote — but `external_ref = tw-show-{showId}` is stable so re-firing returns the existing draft id (not a new draft). To force a fresh promo for a re-scheduled show, the operator can use the slice-33 Copy button in `/outbox/[id]` to clone a new draft.

If a show has multiple dates (a residency, a tour run), fire one trigger per show-date row, not per top-level show.

### T3. Tour event happening (time-sensitive)

This category is for "showtime in 1 hour" / "doors open" / "tickets ≤10 left" type posts. They MUST go out near-immediately — drafts don't fit because operator review adds latency.

```ts
fireOutboxDrafts({
  triggerUserId: event.creatorId,
  externalRefBase: `tw-event-${event.id}`,
  caption: event.kind === "showtime_imminent"
    ? `🎤 ${event.showTitle} starts in 1 hour at ${event.venueName}. ${event.ticketUrl}`
    : event.kind === "tickets_low"
    ? `Tickets going fast for ${event.showTitle} on ${event.dateLabel}. ${event.ticketUrl}`
    : `${event.title}. ${event.url}`,
  platforms: ["twitter", "bluesky"],
  asDraft: false,                                       // ← bypass operator review (time-sensitive)
  scheduledAt: new Date(Date.now() + 5 * 60_000),       // ≥5 min in future
});
```

**WARNING:** `asDraft: false` means this fires straight through to the publisher. Smoke this trigger CAREFULLY — a bug in the caption template ships to live social accounts. Recommend: keep this trigger BAM-only **even after** other triggers are opened up to other users. Tour event broadcasts shouldn't be in the hands of non-operators.

`event.kind` discriminates. Define your event types up-front:
- `showtime_imminent` — N minutes/hours before showtime, fires from a scheduled job
- `tickets_low` — when tickets remaining drops below a threshold
- `tickets_sold_out` — when capacity reached
- `weather_alert` — show postponed/cancelled
- (other kinds — define as you go)

Different kinds may want different platforms or different timing. Customize the caption builder per kind.

---

## Smoke

1. **T1 (signup)** — follow [`signups.md`](./signups.md)'s smoke checklist.
2. **T2 (show date)** — local: add a show with a future date. Confirm 4 drafts (twitter, bluesky, instagram, linkedin) appear. Polish + schedule.
3. **T3 (tour event)** — local: trigger a `showtime_imminent` event manually (e.g. via a debug button). Confirm row goes straight to status=queued (not draft) and submits. **Do not test in production with `asDraft: false` until local smoke is rock-solid** — a bug here posts directly to your live accounts.
4. Production: roll out T1 first (lowest blast radius), T2 second, T3 last.

---

## Reference

- [INTEGRATE.md](../INTEGRATE.md) — gate logic + sender + smoke template.
- [`signups.md`](./signups.md) — T1 pattern (cross-cutting signups).
- [`centenarian-os.md`](./centenarian-os.md) — see "Live (1)" trigger for the `asDraft: false` precedent.
