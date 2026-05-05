# Trigger recipe — flashlearn-ai: 5 learning-event triggers

> Pair this file with [INTEGRATE.md](../INTEGRATE.md) for gate logic, sender setup, and smoke checklist. This file covers WHAT triggers and HOW for flashlearn-ai specifically.

---

## What this triggers on

flashlearn-ai is the most trigger-rich product in the ecosystem. Five distinct user-actions fire outbox drafts:

| # | Event | `external_ref` shape | Default platforms |
|---|---|---|---|
| 4a | Study session completed | `study-session-{sessionId}` | twitter, bluesky, linkedin |
| 4b | Recall-schedule milestone (card crosses long-term threshold) | `recall-milestone-{cardId}-{newIntervalDays}` | twitter, bluesky |
| 4c | Public challenge created | `challenge-created-{challengeId}` | twitter, bluesky, linkedin |
| 4d | BAM's challenge accepted + completed by another user | `challenge-completed-{challengeId}-{anonAcceptorHash}` | twitter, bluesky |
| 4e | Public flashcard set created | `public-set-{setId}` | twitter, bluesky, linkedin |

Slug: `flashlearn`. One slug for all 5 triggers. Fan-out at the platform level inside the trigger function.

---

## Pre-reqs (operator side; see `plans/user-tasks/11-flashlearn-ingest-source.md`)

- `flashlearn` slug provisioned in outbox's `INGEST_SOURCES`, with `workspace_name` matching the Ocoya workspace whose profiles the posts should target. (Most likely `B4C LLC`.)
- Three env vars in flashlearn-ai's project: `OUTBOX_INGEST_URL`, `OUTBOX_SOURCE_SLUG=flashlearn`, `OUTBOX_INGEST_SECRET`.
- `OUTBOX_TRIGGER_ENABLED` (default unset = off) and `PRODUCT_OWNER_USER_ID` (BAM's user id in flashlearn's DB).

---

## Trigger code (in `flashlearn-ai` repo)

### Step 0 — install the layered-gate helper

Create `flashlearn-ai/lib/outbox-trigger.ts` per [INTEGRATE.md](../INTEGRATE.md) Step 2 — the `fireOutboxDrafts` template plus `hashUserId` and `anonymizedHandle` helpers. Use that as the foundation for all 5 triggers below.

### Step 1 — wire each trigger

#### 4a. Study session completed

Where: in flashlearn's session-finalize flow, after `session.completedAt` is persisted.

```ts
import { fireOutboxDrafts } from "@/lib/outbox-trigger";

// After session.completedAt is persisted:
fireOutboxDrafts({
  triggerUserId: session.userId,
  externalRefBase: `study-session-${session.id}`,
  caption: `Just drilled ${session.cardCount} cards on "${deck.title}" — ${session.accuracyPct}% recall after ${session.durationMin} minutes.`,
});
```

Don't fire mid-session — only on completion (status=`completed`, not `paused`). Re-runs of session-finalize are idempotent: `session.id` is stable.

#### 4b. Recall-schedule milestone

Where: in the spaced-repetition advance logic, after computing the new interval.

```ts
// Only fire when crossing a meaningful threshold. Don't fire on every recall click — that's noise.
if (newIntervalDays > 30 && previousIntervalDays <= 30) {
  fireOutboxDrafts({
    triggerUserId: card.userId,
    externalRefBase: `recall-milestone-${card.id}-${newIntervalDays}`,
    caption: `Just locked in "${card.front}" → long-term memory (${newIntervalDays} days). One more card down.`,
    platforms: ["twitter", "bluesky"],     // narrower fan-out for higher-frequency events
  });
}
```

Tune the threshold (`> 30 && <= 30`) over time. Too aggressive → noisy drafts. Too conservative → operator never gets to celebrate progress.

#### 4c. Public challenge created

Where: in challenge-creation flow, after persist.

```ts
fireOutboxDrafts({
  triggerUserId: challenge.creatorId,
  externalRefBase: `challenge-created-${challenge.id}`,
  caption: `New challenge: "${challenge.title}". Beat my ${challenge.creatorScore}%. ${challengeUrl}`,
});
```

`challenge.creatorScore` may not exist at creation time (no plays yet). Adapt the caption template to what's actually populated.

#### 4d. Challenge accepted + completed (by another user)

Where: when ANY user completes a challenge BAM created. Gate by `challenge.creatorId === BAM`, NOT by acceptor.

```ts
import { anonymizedHandle, hashUserId } from "@/lib/outbox-trigger";

if (challenge.creatorId === process.env.PRODUCT_OWNER_USER_ID) {
  fireOutboxDrafts({
    triggerUserId: challenge.creatorId,         // pass BAM's id (creator), not acceptor's
    externalRefBase: `challenge-completed-${challenge.id}-${hashUserId(acceptingUser.id)}`,
    caption: `${anonymizedHandle(acceptingUser)} took on my "${challenge.title}" challenge — beat me with ${result.scorePct}%.`,
    platforms: ["twitter", "bluesky"],
  });
}
```

**PII guard:** never include the accepting user's email or full name. The `anonymizedHandle` helper from INTEGRATE.md uses chosen handle if set, else initials + 4-char hash.

#### 4e. Public flashcard set created

Where: when a set's `visibility` flips to `public`, OR when a new set is created with `visibility: "public"`.

```ts
fireOutboxDrafts({
  triggerUserId: set.creatorId,
  externalRefBase: `public-set-${set.id}`,
  caption: `New public deck: "${set.title}" — ${set.cardCount} cards on ${set.subject}. ${setUrl}`,
});
```

If the operator (BAM) sets `visibility: public` on an existing private set, the trigger should still fire. Use a state-transition check (was private, now public).

---

## Smoke each trigger separately

Don't ship all 5 at once. Local smoke per trigger:

1. Wire 4a only. Complete a session as BAM. Confirm 3 drafts at `/outbox?source=flashlearn&status=draft`.
2. Add 4b. Cross a recall milestone. Confirm new draft.
3. Add 4c, 4d, 4e in turn. Each in its own commit so any regression is bisectable.
4. For 4d specifically: smoke with two test users — one creates a challenge as BAM, the other accepts. Confirm the trigger fires only when BAM is creator.

---

## Volume guard

5 triggers × multi-user → can spike. After BAM-only smoke completes and you remove the `triggerUserId !== OWNER_USER_ID` gate (replace with per-user opt-in per [`per-user-opt-in.md`](https://raw.githubusercontent.com/dapperAuteur/witus-outbox/main/plans/future/per-user-opt-in.md)), watch the draft cadence. If it's too noisy:

- Aggregate 4a (study sessions) and 4b (recall milestones) into a daily digest fired once per user per day.
- Keep 4c, 4d, 4e per-event (lower frequency, higher signal).

---

## Reference

- [INTEGRATE.md](../INTEGRATE.md) — gate logic + sender + smoke template.
- [sender.ts](../sender.ts) — copy verbatim.
- `plans/user-tasks/11-flashlearn-ingest-source.md` (BAM-private) — operator provisioning checklist.
