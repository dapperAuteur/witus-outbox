# Trigger recipe — cross-cutting: signups (free + paid + class enrollment)

> Pair this file with [INTEGRATE.md](../INTEGRATE.md) for gate logic, sender setup, and smoke checklist.
>
> **Cross-cutting — applies to multiple publisher products.** Drop this trigger into every product that has a signup flow OR a class enrollment flow.

---

## What this triggers on

Three sub-patterns:

| Pattern | Trigger | `external_ref` shape | Default platforms |
|---|---|---|---|
| 6a | Free user signup | `{slug}-signup-free-{userIdHash}` | twitter, bluesky |
| 6b | Paid user signup (lifetime / annual) | `{slug}-signup-paid-{userIdHash}-{tier}` | twitter, bluesky, linkedin |
| 6c | Class enrollment (ECS, FDAC, future classes) | `{slug}-class-{classCode}-enrollment-{seatsTaken}` | twitter, bluesky, linkedin |

Slugs are per-product (whichever product owns the user/class data). Each product registers its own slug in outbox's `INGEST_SOURCES`.

---

## Per-product applicability

| Product | 6a / 6b applicable? | 6c applicable? |
|---|---|---|
| witus.online | yes (members can sign up free or paid) | yes (BAM teaches ECS, FDAC, …) |
| flashlearn-ai | yes | maybe (if classes ship) |
| centenarian-os | yes | yes |
| contractor-os | yes (B2B paid signups) | maybe |
| fly-witus | no (single-user) | no |

For products where 6a/6b applies: same trigger function shape, only the slug + product-specific naming changes.

---

## Pre-reqs (operator side; see `plans/user-tasks/13-ecosystem-signup-trigger.md`)

For each product:
- That product's slug in outbox's `INGEST_SOURCES`.
- Three env vars + `OUTBOX_TRIGGER_ENABLED` + `PRODUCT_OWNER_USER_ID`.
- **Strongly recommended before this ships:** the env-var kill-switch from [`admin-kill-switch.md`](https://raw.githubusercontent.com/dapperAuteur/witus-outbox/main/plans/future/admin-kill-switch.md). Free signups can spike under campaigns.

---

## Trigger code

### Step 0 — install the layered-gate helper

Per [INTEGRATE.md](../INTEGRATE.md) Step 2.

### Step 1 — write the signup trigger

```ts
import { after } from "next/server";
import { sendToOutbox } from "@/lib/sender-outbox";
import { anonymizedHandle, hashUserId } from "@/lib/outbox-trigger";

export async function fireSignupTrigger(args: {
  newUser: { id: string; handle?: string | null; email: string };
  tier: "free" | "annual" | "lifetime";
}) {
  // Layered gates.
  if (process.env.OUTBOX_TRIGGER_ENABLED !== "true") return;
  // Note: signup trigger is unique — it fires when a NEW user is created.
  // The "BAM-only" gate from other triggers doesn't apply here. Two options:
  //   A. Skip the BAM-only gate entirely; every signup fires a draft (safe
  //      because drafts don't auto-publish — BAM reviews each).
  //   B. Gate by "is the OPERATOR-USER (BAM) signing up someone manually?"
  //      Useful only if you have an admin-impersonation signup flow.
  // Default: pattern A — every signup fires a draft.

  const isPaid = args.tier !== "free";
  const platforms = isPaid
    ? (["twitter", "bluesky", "linkedin"] as const)
    : (["twitter", "bluesky"] as const);
  const productName = "<your product name — hardcode per app>";
  const handle = anonymizedHandle(args.newUser);

  const caption = isPaid
    ? `Welcome to ${productName}, ${handle}. ${args.tier} members get [perks].`
    : `${handle} just joined ${productName}.`;

  after(async () => {
    for (const platform of platforms) {
      const result = await sendToOutbox({
        outboxUrl: process.env.OUTBOX_INGEST_URL!,
        sourceSlug: process.env.OUTBOX_SOURCE_SLUG!,
        hmacSecret: process.env.OUTBOX_INGEST_SECRET!,
        submission: {
          external_ref: `${process.env.OUTBOX_SOURCE_SLUG}-signup-${args.tier}-${hashUserId(args.newUser.id)}-${platform}`,
          platform,
          caption,
          media_urls: [],
          scheduled_at: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
          as_draft: true,
        },
      });
      if (!result.ok) {
        console.error("[signup-trigger] failed", {
          slug: process.env.OUTBOX_SOURCE_SLUG,
          platform,
          tier: args.tier,
          http_status: result.status,
        });
      }
    }
  });
}
```

### Step 2 — write the class-enrollment trigger (where applicable)

```ts
export async function fireClassEnrollmentTrigger(args: {
  className: string;          // human-readable: "Energetic Centenarian Strategies"
  classCode: string;          // short: "ECS" or "FDAC"
  seatsTaken: number;
  seatsTotal: number;
}) {
  if (process.env.OUTBOX_TRIGGER_ENABLED !== "true") return;

  // No userId here — caption is about cohort growth, not the new student.
  // PII guard: never include the enrolled user's identifier in any form.

  const caption = `${args.className} class is filling up — ${args.seatsTaken}/${args.seatsTotal} seats taken.`;

  after(async () => {
    for (const platform of ["twitter", "bluesky", "linkedin"] as const) {
      await sendToOutbox({
        outboxUrl: process.env.OUTBOX_INGEST_URL!,
        sourceSlug: process.env.OUTBOX_SOURCE_SLUG!,
        hmacSecret: process.env.OUTBOX_INGEST_SECRET!,
        submission: {
          external_ref: `${process.env.OUTBOX_SOURCE_SLUG}-class-${args.classCode}-enrollment-${args.seatsTaken}-${platform}`,
          platform,
          caption,
          media_urls: [],
          scheduled_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),    // 1d, since class enrollment is more time-sensitive than signups
          as_draft: true,
        },
      });
    }
  });
}
```

**Milestone-only firing variant.** Per-enrollment posts can be noisy if a class fills 100 seats in 4 hrs. Suppress per-enrollment and fire only at percentage milestones (50%, 80%, 100%):

```ts
const pct = args.seatsTaken / args.seatsTotal;
const previousPct = (args.seatsTaken - 1) / args.seatsTotal;
const milestones = [0.5, 0.8, 1.0];
const crossedMilestone = milestones.find((m) => pct >= m && previousPct < m);
if (!crossedMilestone) return;
// ... fire trigger
```

### Step 3 — call sites

Find the signup-completion path in your product. Typical locations:

- **NextAuth `events.createUser` callback** (most common).
- **Custom signup server action** (if you don't use NextAuth).
- **Stripe webhook** (for paid signups via Stripe checkout).

```ts
// In your auth or signup code:
await persistUser(newUser);
await fireSignupTrigger({ newUser, tier: "free" });    // or "annual" / "lifetime"
```

For class enrollments — find the path that increments `class.seatsTaken`:

```ts
// In your class-enrollment server action:
const updatedClass = await persistEnrollment({ classId, userId });
await fireClassEnrollmentTrigger({
  className: updatedClass.name,
  classCode: updatedClass.code,
  seatsTaken: updatedClass.seatsTaken,
  seatsTotal: updatedClass.seatsTotal,
});
```

---

## Smoke

1. **Local — free signup.** Sign up a test user with tier=free. Confirm 2 drafts (twitter, bluesky) at `/outbox?source={slug}&status=draft` with anonymized handle in caption (no email, no full name).
2. **Local — paid signup.** tier=annual. Confirm 3 drafts (linkedin added) with welcome-tier caption.
3. **Local — class enrollment.** Trigger an enrollment. Confirm 3 drafts with class name + seat count.
4. **Volume guard.** Set `OUTBOX_TRIGGER_ENABLED=false` and verify NO drafts fire. Critical for the "campaign goes viral" panic-button case.
5. **Production smoke** (low-traffic time only): one real signup of each tier; one real class enrollment.

---

## Volume guard

Free signups can spike. Before flipping `OUTBOX_TRIGGER_ENABLED=true` in Production:

- Estimate steady-state signups per day. If >10/day → switch 6a (free signups) to a daily-digest pattern (one trigger fires at end-of-day with "{N} new {productName} members today").
- Class enrollments under campaign launch can fill 100 seats in 4 hrs. Use the milestone-only variant from Step 2.
- During campaigns: flip `OUTBOX_TRIGGER_ENABLED=false`. Re-enable after.

---

## Reference

- [INTEGRATE.md](../INTEGRATE.md) — gate logic + sender + smoke template.
- [sender.ts](../sender.ts) — copy verbatim.
- `plans/user-tasks/13-ecosystem-signup-trigger.md` (BAM-private) — operator provisioning checklist.
- [`ecosystem-outbox-scenarios.md`](https://raw.githubusercontent.com/dapperAuteur/witus-outbox/main/plans/future/ecosystem-outbox-scenarios.md) §6 — scenario catalog with privacy rationale.
