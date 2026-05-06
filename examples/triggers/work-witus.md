# Trigger recipe — work-witus: new jobs / invoices

> Pair this file with [INTEGRATE.md](../INTEGRATE.md) for gate logic, sender setup, and smoke checklist.

---

## What this triggers on

Two events, mirroring centenarian-os's business pattern:

| # | Event | `external_ref` | Default platforms | Notes |
|---|---|---|---|---|
| WW1 | New job posted | `ww-job-{jobId}` | linkedin, twitter, bluesky | LinkedIn primary (recruiting flavor) |
| WW2 | Invoice created/closed | `ww-invoice-{event}-{invoiceId}` | linkedin only | **Event-only captions, NEVER amounts/names/companies** |

Slug: `work-witus`. Same invoice privacy rules as `centenarian-os.md` — financial detail does not leave the publisher product.

---

## Pre-reqs (operator side)

Standard from [INTEGRATE.md](../INTEGRATE.md). Slug already provisioned in `INGEST_SOURCES` ✓.

---

## Trigger code

### Step 0 — install the layered-gate helper

Per [INTEGRATE.md](../INTEGRATE.md) Step 2.

### WW1. New job posted

Where: in the job-creation/publish flow, after the row's status becomes `published` (don't fire on drafts).

```ts
fireOutboxDrafts({
  triggerUserId: job.creatorId,
  externalRefBase: `ww-job-${job.id}`,
  caption: buildJobCaption(job),
  platforms: ["linkedin", "twitter", "bluesky"],
});

function buildJobCaption(job: {
  title: string;
  company?: string;            // OK to include — job posts ARE publicly about a company
  location: string;
  type: string;                // "Full-time" / "Contract" / etc.
  url: string;
}): string {
  // Jobs are EXPLICITLY share-worthy — caption can include company + location.
  // This is different from invoice triggers (which aren't).
  const companyLine = job.company ? ` at ${job.company}` : "";
  return `Hiring${companyLine}: ${job.title} (${job.type}, ${job.location}). ${job.url}`;
}
```

Re-publish edits (caption tweaks, URL update) re-fire with the same `external_ref` → outbox returns the existing draft id; no duplicate. Use slice-33 Copy if you want a fresh draft (e.g. to repost an old job listing later in the year).

### WW2. Invoice created / closed

**RULE: caption is event-only. NEVER amounts, client names, or company names.** Same rule as centenarian-os 2q/2r.

```ts
// Invoice CREATED:
fireOutboxDrafts({
  triggerUserId: user.id,
  externalRefBase: `ww-invoice-created-${invoice.id}`,
  caption: "Another invoice out the door. ✉️",
  platforms: ["linkedin"],
});

// Invoice CLOSED:
fireOutboxDrafts({
  triggerUserId: user.id,
  externalRefBase: `ww-invoice-closed-${invoice.id}`,
  caption: "Another contract closed. 🤝",
  platforms: ["linkedin"],
});
```

**Strongly recommend** an explicit per-invoice operator flag (`is_shareable_invoice` boolean on the `invoices` table, default `false`). Trigger fires only when flag is true. Mirrors `is_shareable_example` exercise pattern from centenarian-os.

### Optional refinement: aggregate per-week digest

If individual job postings or invoice events feel noisy in the draft queue, switch to a weekly digest pattern:

```ts
// Fire once per week with a summary, instead of per-event.
const externalRef = `ww-weekly-digest-${isoWeek}`;
const caption = `This week at work-witus: ${newJobsCount} new roles, ${closedInvoicesCount} contracts closed.`;
// Cron / scheduled job triggers this once per week per user.
```

Don't ship aggregation until you have data on whether per-event firing is too much.

---

## Smoke

1. WW1 (jobs) — local: post a job. Confirm 3 drafts at `/outbox?source=work-witus&status=draft`.
2. WW2 (invoices) — local: create an invoice with `is_shareable_invoice=true`. Confirm 1 draft (linkedin only) with the event-only caption. **Verify** the caption contains zero financial detail before flipping `OUTBOX_TRIGGER_ENABLED=true` in Production.
3. WW2 negative test: create an invoice with `is_shareable_invoice=false`. Confirm NO draft fires.
4. Production smoke: one real job, one real invoice (with the share flag set), at low-traffic time.

---

## Reference

- [INTEGRATE.md](../INTEGRATE.md) — gate logic + sender + smoke template.
- [`centenarian-os.md`](./centenarian-os.md) — sibling business pattern; the invoice rules are documented in detail there.
