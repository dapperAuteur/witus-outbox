# Trigger recipe — centenarian-os: 22 lifestyle/business triggers

> Pair this file with [INTEGRATE.md](../INTEGRATE.md) for gate logic, sender setup, and smoke checklist.

---

## What this triggers on

22 user-actions across centenarian-os fire outbox drafts. Categories:

| Category | Triggers | Notes |
|---|---|---|
| Tasks/goals/milestones | created + completed for each (6) | Standard event captions |
| Daily/weekly cadence | focus session, daily brief, weekly review, retrospective (4) | One-per-day max for daily ones |
| Nutrition | ingredients, recipes, meal prep (3) | Consider batch-aggregation if too noisy |
| Fitness | workout creation, exercise creation (2) | |
| Business | invoice created/closed (2) | **Event-only captions, no $ or names/companies** |
| Content | blog post, media (2) | |
| Academy | course created, module completed (2) | |
| Live | going live (1) | **Fires as queued, not draft** — time-sensitive |

**Pain tracking is intentionally NOT a trigger** — health data is too sensitive even with anonymization. Confirmed by BAM 2026-05-05.

Slug: `centenarianos`. One slug, 22 trigger functions sharing the same `fireOutboxDrafts` helper from [INTEGRATE.md](../INTEGRATE.md) Step 2.

---

## Pre-reqs (operator side; see `plans/user-tasks/12-centenarian-os-ingest-source.md`)

- `centenarianos` slug provisioned in outbox's `INGEST_SOURCES`.
- Three env vars + `OUTBOX_TRIGGER_ENABLED` + `PRODUCT_OWNER_USER_ID`.

---

## Trigger code

### Step 0 — install the layered-gate helper

Copy [INTEGRATE.md](../INTEGRATE.md) Step 2's `fireOutboxDrafts` template into `centenarian-os/lib/outbox-trigger.ts`. All 22 triggers below call it.

### Step 1 — group triggers by category

Don't write 22 separate functions. Group by category, share caption-building logic per category. Example:

```ts
// centenarian-os/lib/outbox-trigger.ts (extends INTEGRATE.md template):
import { fireOutboxDrafts } from "./outbox-trigger-base";

export function fireTaskTrigger(args: {
  triggerUserId: string;
  task: { id: string; title: string };
  event: "created" | "completed";
}) {
  fireOutboxDrafts({
    triggerUserId: args.triggerUserId,
    externalRefBase: `cn-task-${args.event}-${args.task.id}`,
    caption: args.event === "created"
      ? `Just queued: ${args.task.title}`
      : `Done: ${args.task.title} ✓`,
  });
}

export function fireGoalTrigger(args: { /* … */ }) { /* … */ }
export function fireMilestoneTrigger(args: { /* … */ }) { /* … */ }
// … etc.
```

Group functions = less duplication; each call site stays a one-liner.

### Step 2 — call sites by category

#### Tasks / goals / milestones (6 triggers)

Standard pattern: fire on both `created` and `completed`. `external_ref` includes the event keyword to keep the two idempotent independently.

```ts
// In task-creation flow:
fireTaskTrigger({ triggerUserId: user.id, task, event: "created" });
// In task-completion flow:
fireTaskTrigger({ triggerUserId: user.id, task, event: "completed" });
```

Same shape for goals + milestones. 6 trigger call sites total.

#### Daily/weekly cadence (4 triggers)

- **Focus session completed:** `external_ref = cn-focus-${sessionId}`. Caption includes duration + topic.
- **Daily brief completed:** `external_ref = cn-daily-brief-${YYYY-MM-DD}`. **One per day max** — the date in the ref makes idempotency automatic.
- **Weekly review:** `external_ref = cn-weekly-${ISO_WEEK}`. One per week max.
- **Retrospective:** `external_ref = cn-retro-${retroId}`.

#### Nutrition (3 triggers)

- **Ingredient added:** low-signal individually. Consider batching: only fire weekly digest "Added 12 ingredients this week" rather than per-ingredient.
- **Recipe added:** higher signal — fire per-recipe.
- **Meal prep logged:** one per day max via date-keyed `external_ref`.

#### Fitness (2 triggers)

- **Workout created:** `external_ref = cn-workout-created-${workoutId}`.
- **Exercise created:** `external_ref = cn-exercise-created-${exerciseId}`.

#### Business — invoices (2 triggers, EXTRA CARE)

**RULE: caption is event-only. NEVER amounts, names, or company names.** BAM 2026-05-05.

```ts
// Invoice CREATED:
fireOutboxDrafts({
  triggerUserId: user.id,
  externalRefBase: `cn-invoice-created-${invoice.id}`,
  caption: "An invoice just left the outbox. ✉️",
  platforms: ["linkedin"],     // business voice only
});

// Invoice CLOSED:
fireOutboxDrafts({
  triggerUserId: user.id,
  externalRefBase: `cn-invoice-closed-${invoice.id}`,
  caption: "Another contract closed. 🤝",
  platforms: ["linkedin"],
});
```

**Recommend** an explicit per-invoice operator flag (`is_shareable_invoice` boolean on the `invoices` table, default false). Trigger fires only when flag is true. Mirrors the `is_shareable_example` exercise pattern.

#### Content (2 triggers)

- **Blog post created:** `external_ref = cn-blog-${postId}`. Caption = title + url.
- **Media created** (e.g. video upload): `external_ref = cn-media-${mediaId}`. Caption + url. Consider including the media URL in `media_urls` so the post has the artifact attached.

#### Academy (2 triggers)

- **Course created:** `external_ref = cn-course-created-${courseId}`. High signal.
- **Course module completed:** `external_ref = cn-course-module-${courseId}-${moduleId}`. May be noisy if a single user completes many modules in a session. Consider rate-limiting or daily-digest aggregation.

#### Live (1 trigger, EXCEPTIONAL SHAPE)

**Going live** is the only trigger that DOESN'T land as a draft. It's time-sensitive — must go out during the stream, not waiting for operator review.

```ts
fireOutboxDrafts({
  triggerUserId: stream.userId,
  externalRefBase: `cn-live-${stream.id}`,
  caption: `🔴 Live now: ${stream.title}. ${stream.url}`,
  platforms: ["twitter", "bluesky"],   // fast-moving platforms
  asDraft: false,                      // ← bypass operator review
  scheduledAt: new Date(Date.now() + 5 * 60_000),    // ≥5 min in future
});
```

If the stream ends before the post fires (publisher latency), accept the small chance of a posted-after-stream-ended message. The alternative (block the live announcement on operator review) defeats the purpose.

---

## Volume guard

22 triggers × multi-user could produce dozens of drafts/day per user. Plan for:

- **BAM-only smoke first.** During smoke, only BAM's actions fire — natural rate-limit.
- **After per-user opt-in** ([`per-user-opt-in.md`](https://raw.githubusercontent.com/dapperAuteur/witus-outbox/main/plans/future/per-user-opt-in.md)), default OFF. Users opt in explicitly.
- **Aggregate the noisy ones.** Tasks created (any user creates 5–20/day), focus sessions, ingredients added — these benefit from a daily-digest pattern (one trigger per day per user, summarizing the day's events).

---

## Smoke each category separately

1. Local: wire tasks/goals/milestones (6). Smoke. Polish caption templates.
2. Add daily/weekly cadence (4). Smoke. Confirm date-keyed `external_ref` produces one-per-day correctly (re-finalize a brief twice — same row id back).
3. Add nutrition + fitness + content + academy (9). Smoke each.
4. Add invoices (2) — verify caption has zero financial detail before flipping `OUTBOX_TRIGGER_ENABLED=true` in Production.
5. Add live (1). Test by starting a fake stream in dev. Confirm draft is bypassed and the row goes straight to queued.

---

## Reference

- [INTEGRATE.md](../INTEGRATE.md) — base helper + smoke template.
- [sender.ts](../sender.ts) — copy verbatim.
- `plans/user-tasks/12-centenarian-os-ingest-source.md` (BAM-private) — operator provisioning checklist.
- [`ecosystem-outbox-scenarios.md`](https://raw.githubusercontent.com/dapperAuteur/witus-outbox/main/plans/future/ecosystem-outbox-scenarios.md) §2a–2w — full trigger catalog with privacy rationale.
