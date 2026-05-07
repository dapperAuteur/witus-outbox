# Trigger recipe — flashlearn-ai: 9 learning-event triggers

> Pair this file with [INTEGRATE.md](../INTEGRATE.md) for gate logic, sender setup, and smoke checklist. This file covers WHAT triggers and HOW for flashlearn-ai specifically.

---

## What this triggers on

flashlearn-ai is the most trigger-rich product in the ecosystem. Nine distinct user-actions fire outbox drafts:

| # | Event | `external_ref` shape | Default platforms |
|---|---|---|---|
| 4a | Study session completed | `study-session-{sessionId}` | twitter, bluesky, linkedin |
| 4b1 | Recall-schedule **milestone** (card crosses long-term threshold) | `recall-milestone-{cardId}-{newIntervalDays}` | twitter, bluesky |
| 4b2 | Recall-schedule **daily digest** (one fire per user per day, summarizing recall sets practiced that day) | `recall-digest-{userIdHash}-{YYYY-MM-DD}` | twitter, bluesky |
| 4c | Public challenge created | `challenge-created-{challengeId}` | twitter, bluesky, linkedin |
| 4d | BAM's challenge accepted + completed by another user — single trigger, **conditional caption** based on outcome (win vs attempt) | `challenge-completed-{challengeId}-{anonAcceptorHash}` | twitter, bluesky |
| 4e | Public flashcard set created | `public-set-{setId}` | twitter, bluesky, linkedin |
| 4f | New user signup (free + paid tiers) | per [`signups.md`](./signups.md) — delegates to the cross-cutting recipe | per [`signups.md`](./signups.md) |
| 4g | New study group created | `study-group-{groupId}` | twitter, bluesky, linkedin |
| 4h | New classroom group created | `classroom-group-{groupId}` | twitter, bluesky, linkedin |

Slug: `flashlearnai` (no hyphen, no `-ai` suffix — must match `INGEST_SOURCES["flashlearnai"].slug` exactly). One slug for all triggers. Fan-out at the platform level inside the trigger function.

---

## Pre-reqs (operator side; see `plans/user-tasks/11-flashlearn-ingest-source.md`)

- `flashlearnai` slug provisioned in outbox's `INGEST_SOURCES`, with `workspace_name` matching the Ocoya workspace whose profiles the posts should target. ✓ (`workspace_name: "main"` → B4C LLC profiles per BAM 2026-05-05.)
- Three env vars in flashlearn-ai's project: `OUTBOX_INGEST_URL`, `OUTBOX_SOURCE_SLUG=flashlearnai`, `OUTBOX_INGEST_SECRET`.
- `OUTBOX_TRIGGER_ENABLED` (default unset = off) and `PRODUCT_OWNER_USER_ID` (BAM's user id in flashlearn's DB).

---

## Trigger code

### Step 0 — install the layered-gate helper

Create `flashlearn-ai/lib/outbox-trigger.ts` per [INTEGRATE.md](../INTEGRATE.md) Step 2 — the `fireOutboxDrafts` template plus `hashUserId` and `anonymizedHandle` helpers. All triggers below call it.

### 4a. Study session completed

Where: in flashlearn's session-finalize flow, after `session.completedAt` is persisted.

```ts
import { fireOutboxDrafts } from "@/lib/outbox-trigger";

fireOutboxDrafts({
  triggerUserId: session.userId,
  externalRefBase: `study-session-${session.id}`,
  caption: `Just drilled ${session.cardCount} cards on "${deck.title}" — ${session.accuracyPct}% recall after ${session.durationMin} minutes.`,
});
```

Don't fire mid-session — only on completion (`status="completed"`, not `paused`). Re-runs of session-finalize are idempotent: `session.id` is stable.

### 4b1. Recall-schedule milestone

Where: in the spaced-repetition advance logic, after computing the new interval. Fires only on **first crossover** to >30 days (long-term memory). One fire per card per crossover.

```ts
if (newIntervalDays > 30 && previousIntervalDays <= 30) {
  fireOutboxDrafts({
    triggerUserId: card.userId,
    externalRefBase: `recall-milestone-${card.id}-${newIntervalDays}`,
    caption: `Just locked in "${card.front}" → long-term memory (${newIntervalDays} days). One more card down.`,
    platforms: ["twitter", "bluesky"],
  });
}
```

Tune the threshold over time. `>30 && <=30` is a starting point; if too aggressive (too many drafts), bump to >60 or higher.

### 4b2. Recall-schedule daily digest

Where: a daily cron / scheduled job (Vercel cron, Apps Script, or a server-side cron of your choice). At end-of-day per user, summarize recall-scheduled sets they practiced.

```ts
import { hashUserId } from "@/lib/outbox-trigger";

// Cron runs once/day per active user. setsPracticed comes from your DB.
const ymd = new Date().toISOString().slice(0, 10);

if (setsPracticedToday.length === 0) return;     // skip silent days

fireOutboxDrafts({
  triggerUserId: user.id,
  externalRefBase: `recall-digest-${hashUserId(user.id)}-${ymd}`,
  caption: setsPracticedToday.length === 1
    ? `Today: drilled "${setsPracticedToday[0].title}" from my recall schedule. Consistency over intensity.`
    : `Today: ${setsPracticedToday.length} recall sets revisited. ${setsPracticedToday.slice(0, 3).map((s) => `"${s.title}"`).join(", ")}${setsPracticedToday.length > 3 ? ", and more" : ""}.`,
  platforms: ["twitter", "bluesky"],
});
```

Date-keyed `external_ref` makes the digest idempotent — a re-run of the cron same day returns the same row id.

**Volume tuning:** if every user fires every day, the queue gets noisy fast. Two options:
- Suppress until the user has 5+ days of streak (rewards consistency).
- Batch into a weekly digest instead of daily.

Start with daily, tune from there.

### 4c. Public challenge created

Where: challenge-creation flow, after the challenge row is persisted.

```ts
fireOutboxDrafts({
  triggerUserId: challenge.creatorId,
  externalRefBase: `challenge-created-${challenge.id}`,
  caption: `New challenge: "${challenge.title}". Beat my ${challenge.creatorScore}%. ${challengeUrl}`,
});
```

`challenge.creatorScore` may not exist at creation time (no plays yet). Adapt the caption template to what's actually populated.

### 4d. Challenge accepted + completed (by another user)

Where: when ANY user completes a challenge BAM created. Gate by `challenge.creatorId === BAM`, NOT by acceptor. Caption is **conditional on outcome** — win vs attempt — to land the right tone:

```ts
import { anonymizedHandle, hashUserId } from "@/lib/outbox-trigger";

if (challenge.creatorId === process.env.PRODUCT_OWNER_USER_ID) {
  const handle = anonymizedHandle(acceptingUser);
  const acceptorWon = result.scorePct >= challenge.creatorScore;

  const caption = acceptorWon
    ? `${handle} beat my "${challenge.title}" challenge with ${result.scorePct}% — congrats. Try beating me: ${challengeUrl}`
    : `${handle} took on my "${challenge.title}" challenge — scored ${result.scorePct}%. Crown's still mine. Try yours: ${challengeUrl}`;

  fireOutboxDrafts({
    triggerUserId: challenge.creatorId,
    externalRefBase: `challenge-completed-${challenge.id}-${hashUserId(acceptingUser.id)}`,
    caption,
    platforms: ["twitter", "bluesky"],
  });
}
```

**PII guard:** `anonymizedHandle` uses chosen handle if set, else initials + 4-char hash. Never the acceptor's email or full name.

### 4e. Public flashcard set created

Where: when a set's `visibility` flips to `public`, OR when a new set is created with `visibility: "public"`.

```ts
fireOutboxDrafts({
  triggerUserId: set.creatorId,
  externalRefBase: `public-set-${set.id}`,
  caption: `New public deck: "${set.title}" — ${set.cardCount} cards on ${set.subject}. Free to study or remix. ${setUrl}`,
});
```

Use a state-transition check (`was private, now public`) to avoid firing on every save of an already-public set.

### 4f. New user signup (delegate to signups.md)

flashlearn signups follow the cross-cutting [`signups.md`](./signups.md) recipe. Two flavors:

- **Free signup** → 2 platforms (twitter, bluesky)
- **Paid signup** (lifetime / annual) → 3 platforms (twitter, bluesky, linkedin) with welcome-tier copy

Copy the `fireSignupTrigger` function from `signups.md` Step 1 into `lib/outbox-trigger.ts` (or a sibling file). Call it from your NextAuth `events.createUser` callback (most likely location):

```ts
import { fireSignupTrigger } from "@/lib/outbox-trigger";

// In your NextAuth options:
events: {
  async createUser({ user }) {
    await fireSignupTrigger({
      newUser: { id: user.id, handle: user.handle ?? null, email: user.email },
      tier: user.subscriptionTier ?? "free",   // adapt to your schema
    });
  },
},
```

Don't duplicate the trigger code from signups.md — single source of truth.

### 4g. New study group created

Where: when a user creates a new study group (peer-to-peer learning circle).

```ts
fireOutboxDrafts({
  triggerUserId: group.creatorId,
  externalRefBase: `study-group-${group.id}`,
  caption: `New study group on flashlearn: "${group.name}" — focused on ${group.subject}. Open to learners.`,
  platforms: ["twitter", "bluesky", "linkedin"],
});
```

If groups can be private vs public, **only fire for public groups**. Add a check: `if (!group.isPublic) return;` before the trigger.

### 4h. New classroom group created

Where: when an instructor creates a new classroom group (teacher-led, more formal than a study group).

```ts
fireOutboxDrafts({
  triggerUserId: classroom.instructorId,
  externalRefBase: `classroom-group-${classroom.id}`,
  caption: `New classroom on flashlearn: "${classroom.name}" — ${classroom.gradeLevel ?? classroom.subject} instruction starting ${formatDate(classroom.startDate)}.`,
  platforms: ["twitter", "bluesky", "linkedin"],
});
```

Same public-vs-private check: only fire for openly-discoverable classrooms. Private/invite-only classrooms shouldn't be auto-broadcast.

---

## Smoke each trigger separately

Don't ship all 9 at once. Local smoke per trigger; one commit per trigger so any regression is bisectable:

1. **4a (study session).** Complete a session. Confirm 3 drafts at `/outbox?source=flashlearnai&status=draft`.
2. **4b1 (recall milestone).** Cross a card past 30 days. Confirm 2 drafts.
3. **4b2 (recall daily digest).** Manually trigger the cron in dev (or wait for scheduled run). Confirm 2 drafts with the day's set summary. Re-run same day → idempotent (no second draft).
4. **4c (challenge created).** Create a public challenge. Confirm 3 drafts.
5. **4d (challenge completed).** Smoke with two test users — BAM creates the challenge, test user accepts + completes:
   - **Win case:** acceptor scores ≥ BAM's score → win-flavor caption.
   - **Attempt case:** acceptor scores < BAM's score → attempt-flavor caption.
   - Confirm both: anonymized handle, no email/name in caption.
6. **4e (public set).** Create a public set. Confirm 3 drafts.
7. **4f (signup).** Create a test user with tier="free" → 2 drafts. Create another with tier="annual" → 3 drafts. Verify anonymization.
8. **4g (study group).** Create a public study group. Confirm 3 drafts. Create a private group → no draft fires.
9. **4h (classroom group).** Same as 4g but for classrooms.

---

## Volume guard

9 triggers × multi-user can produce a lot of drafts once you remove the BAM-only gate. Plan:

- **Stay BAM-only during smoke.** Only your actions fire — natural rate-limit.
- **After per-user opt-in** ([`per-user-opt-in.md`](https://raw.githubusercontent.com/dapperAuteur/witus-outbox/main/plans/future/per-user-opt-in.md) when ready), default OFF. Users opt in explicitly.
- **Aggregate noisy ones.** 4a (study sessions) and 4b1 (milestones) benefit from daily-digest aggregation if individual fires get overwhelming. The 4b2 daily digest is already an example of this pattern.
- **Public-only filter** for 4g and 4h prevents private-content broadcast.

---

## Reference

- [INTEGRATE.md](../INTEGRATE.md) — gate logic + sender + smoke template + branch/merge rule.
- [sender.ts](../sender.ts) — copy verbatim into `flashlearn-ai/lib/sender-outbox.ts`.
- [`signups.md`](./signups.md) — 4f delegates here.
- `plans/user-tasks/11-flashlearn-ingest-source.md` (BAM-private) — operator provisioning checklist.
