# Trigger recipe — fly-witus: flight log → operator-reviewed draft

> Pair this file with [INTEGRATE.md](../INTEGRATE.md) for gate logic, sender setup, and smoke checklist.

---

## What this triggers on

When a flight log is saved on FlyWitUS, fire one outbox draft. Operator (BAM) reviews + schedules manually.

Slug: `flywitus`. Single trigger, single platform default.

**Distinct from other ecosystem scenarios:** this is a personal-records → social-content workflow. Most flight logs are personal; only some get promoted. The draft mode is the gate — every flight log creates a draft, BAM picks which ones get scheduled.

**Initial gate:** BAM-only (the standard layered-gate from [INTEGRATE.md](../INTEGRATE.md)). Per BAM: "I'll open up to others later, after testing it and posting about it."

---

## Pre-reqs (operator side; see `plans/user-tasks/09-flywitus-ingest-source.md`)

- `flywitus` slug provisioned in outbox's `INGEST_SOURCES`.
- Three env vars + `OUTBOX_TRIGGER_ENABLED` + `PRODUCT_OWNER_USER_ID`.

---

## Trigger code (in `fly-witus` repo)

### Step 0 — install the layered-gate helper

Per [INTEGRATE.md](../INTEGRATE.md) Step 2 — `lib/outbox-trigger.ts` template.

### Step 1 — wire the trigger

Where: in the flight-log save flow, after the row is persisted in fly-witus's DB.

```ts
import { fireOutboxDrafts } from "@/lib/outbox-trigger";

export async function saveFlightLog(form: FlightLogForm) {
  const session = await getServerSession();
  if (!session?.user?.id) throw new Error("unauthenticated");

  // 1. Persist locally (existing logic).
  const flightLog = await persistFlightLog(form);

  // 2. Fire draft (gates inside fireOutboxDrafts: kill-switch + BAM-only).
  fireOutboxDrafts({
    triggerUserId: session.user.id,
    externalRefBase: `flight-log-${flightLog.id}`,
    caption: buildCaptionFromFlightLog(flightLog),
    mediaUrls: flightLog.photoUrls ?? [],
    platforms: ["linkedin"],     // start narrow; expand after smoke if desired
  });

  return flightLog;
}

function buildCaptionFromFlightLog(log: FlightLog): string {
  // Adapt this template freely — fly-witus owns caption authorship.
  // Keep it concise and edit-friendly; BAM polishes at promote time.
  return [
    `${log.aircraftType} · ${log.routeDescription}`,
    log.notesExcerpt ?? "",
    `${log.durationHours.toFixed(1)} hrs`,
  ].filter(Boolean).join("\n");
}
```

`external_ref = flight-log-{logId}` is stable. If BAM edits a flight log and re-saves, outbox returns the existing row id — no duplicate drafts.

---

## Smoke

1. **Local.** Save a flight log as BAM (with `OUTBOX_TRIGGER_ENABLED=true` in `.env.local`). Confirm one draft at `/outbox?source=flywitus&status=draft`. Edit caption to match desired tone, set real `scheduled_at`, click Schedule. Watch it flip queued → submitted → posted.
2. **Local idempotency.** Save the same flight log twice (re-save). Confirm only one draft exists.
3. **Local with non-BAM user.** Sign in as a test user, save a log. Confirm no draft fires (BAM-only gate).
4. **Production.** Pick a real flight log, run end-to-end at low-traffic time.

---

## When to open up to other users

Per BAM: "I'll open up to others later, after testing it and posting about it."

After 3+ successful end-to-end posts, remove the BAM-only gate from `fireOutboxDrafts` and replace with per-user opt-in (per [`per-user-opt-in.md`](https://raw.githubusercontent.com/dapperAuteur/witus-outbox/main/plans/future/per-user-opt-in.md)). Add a "share my flight logs as social drafts" toggle on the user profile, default off. Only opted-in users contribute to outbox.

---

## Reference

- [INTEGRATE.md](../INTEGRATE.md) — gate logic + sender + smoke template.
- [sender.ts](../sender.ts) — copy verbatim.
- `plans/user-tasks/09-flywitus-ingest-source.md` (BAM-private) — operator provisioning checklist.
