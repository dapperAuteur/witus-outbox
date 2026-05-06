# Trigger recipe — bam-landing-page: portfolio events (5 triggers)

> Pair this file with [INTEGRATE.md](../INTEGRATE.md) for gate logic, sender setup, and smoke checklist.

---

## What this triggers on

Five events from BAM's portfolio site (brandanthonymcdonald.com):

| # | Event | `external_ref` | Default platforms | Notes |
|---|---|---|---|---|
| B1 | Blog post published | `bam-blog-{postSlug}` | linkedin, twitter, bluesky | Cover image attached if present |
| B2 | Project / case study added | `bam-project-{projectSlug}` | linkedin, twitter, bluesky | Tech-leaning audiences; LinkedIn primary |
| B3 | Speaking engagement / event added | `bam-speaking-{eventId}` | linkedin, twitter, bluesky | Add the event date so the post stays current |
| B4 | Resume / CV updated | `bam-resume-{ymd}` | linkedin only | Once-per-day max via date in ref; LinkedIn-only because it's professional-network specific |
| B5 | Press mention / external link added | `bam-press-{mentionId}` | linkedin, twitter, bluesky | Repost-friendly; tag the source publication if known |

Slug: `bam-landing-page`. Single-author site, so all triggers are naturally BAM-only via `PRODUCT_OWNER_USER_ID`.

> NOTE on the "hire-me inquiry" trigger: BAM asked for it explicitly, but it's NOT included in the table above and is NOT recommended. The privacy posture is poor — anonymizing inquiries down to "got an opportunity today" loses all the specificity that makes social posts useful, while non-anonymized captions leak inquirer info. If you want demand-signal posts, fire on **outcomes** (speaking engagement booked, project shipped, press mention) instead of inputs (hire-me form submission). The 5 triggers above produce more useful content with cleaner privacy.

---

## Pre-reqs (operator side)

- `bam-landing-page` slug provisioned in outbox's `INGEST_SOURCES` ✓
- Three env vars: `OUTBOX_INGEST_URL`, `OUTBOX_SOURCE_SLUG=bam-landing-page`, `OUTBOX_INGEST_SECRET`
- `OUTBOX_TRIGGER_ENABLED` (default unset = off) and `PRODUCT_OWNER_USER_ID` (BAM's user id in bam-landing-page's auth/CMS)

---

## Trigger code

### Step 0 — install the layered-gate helper

Per [INTEGRATE.md](../INTEGRATE.md) Step 2 — `lib/outbox-trigger.ts` template (kill-switch + BAM-only gate + `fireOutboxDrafts`).

### B1. Blog post published

Where: in the blog-publish flow, after the post's status flips to `published`. For a static-site/MDX setup, this is the deploy or build hook; for a DB-backed CMS, the server action that flips visibility.

```ts
import { fireOutboxDrafts } from "@/lib/outbox-trigger";

export async function publishBlogPost(post: {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  url: string;            // public URL on brandanthonymcdonald.com
  coverImageUrl?: string;
}) {
  await persistPublished(post);

  fireOutboxDrafts({
    triggerUserId: getCurrentUser().id,
    externalRefBase: `bam-blog-${post.slug}`,
    caption: [
      `New post: "${post.title}"`,
      "",
      post.excerpt,
      "",
      post.url,
    ].join("\n"),
    mediaUrls: post.coverImageUrl ? [post.coverImageUrl] : [],
    platforms: ["linkedin", "twitter", "bluesky"],
  });
}
```

`external_ref = bam-blog-{slug}` is stable across re-publishes. Editing a post after publish doesn't create new drafts; outbox returns the existing row id.

### B2. Project / case study added

Where: when a new project or case study lands on the portfolio (visibility=`published`).

```ts
fireOutboxDrafts({
  triggerUserId: getCurrentUser().id,
  externalRefBase: `bam-project-${project.slug}`,
  caption: [
    `New project: "${project.title}"`,
    project.tagline,
    "",
    `Stack: ${project.techStack.join(", ")}`,
    project.url,
  ].filter(Boolean).join("\n"),
  mediaUrls: project.heroImageUrl ? [project.heroImageUrl] : [],
  platforms: ["linkedin", "twitter", "bluesky"],
});
```

Tech stack list is optional — include it if the project page has it; LinkedIn audiences engage with concrete tech detail.

### B3. Speaking engagement / event added

Where: when BAM adds a confirmed speaking gig to the portfolio's events/speaking page.

```ts
fireOutboxDrafts({
  triggerUserId: getCurrentUser().id,
  externalRefBase: `bam-speaking-${engagement.id}`,
  caption: [
    `Speaking at ${engagement.eventName} on ${formatDate(engagement.date)}.`,
    `Topic: "${engagement.talkTitle}"`,
    engagement.location,
    engagement.url,
  ].filter(Boolean).join("\n"),
  platforms: ["linkedin", "twitter", "bluesky"],
});
```

For events with a registration link, include `engagement.url` pointing at the event registration page so followers can sign up.

If the engagement gets cancelled or rescheduled, slice 33's edit UI on `/outbox/[id]` lets you fix the draft caption before scheduling. Or use Copy to clone a fresh "rescheduled to ..." draft.

### B4. Resume / CV updated

Where: when BAM uploads a new version of the resume PDF or updates the resume page.

```ts
import { ymd } from "@/lib/date-utils";    // or inline: new Date().toISOString().slice(0, 10)

fireOutboxDrafts({
  triggerUserId: getCurrentUser().id,
  externalRefBase: `bam-resume-${ymd(new Date())}`,    // YYYY-MM-DD; one fire/day max
  caption: `Updated my resume: <bam-landing-page resume URL>. Recent work + new credentials added.`,
  platforms: ["linkedin"],     // LinkedIn-only — resume updates are professional-network specific
});
```

Date-keyed `external_ref` ensures multiple updates in the same day collapse to one draft (idempotent). LinkedIn-only because resume updates feel out-of-place on Twitter/Bluesky. Tweak per-platform copy per your comfort.

### B5. Press mention / external link added

Where: when BAM adds an external press mention to the portfolio's "in the press" list.

```ts
fireOutboxDrafts({
  triggerUserId: getCurrentUser().id,
  externalRefBase: `bam-press-${mention.id}`,
  caption: [
    mention.publication
      ? `Featured in ${mention.publication}: "${mention.title}"`
      : `New mention: "${mention.title}"`,
    mention.url,
  ].join("\n"),
  platforms: ["linkedin", "twitter", "bluesky"],
});
```

If `mention.publication` is known, include it in the caption — names like "Forbes" or "TechCrunch" act as social proof. If unknown, the generic "new mention" framing still works.

---

## Smoke each trigger separately

Don't ship all 5 at once. One commit per trigger; smoke each before moving to the next.

1. **B1 (blog).** Local: publish a post → 3 drafts at `/outbox?source=bam-landing-page&status=draft`. Polish + schedule.
2. **B2 (project).** Local: add a project → 3 drafts.
3. **B3 (speaking).** Local: add an engagement → 3 drafts.
4. **B4 (resume).** Local: update resume → 1 draft (linkedin only). Update twice the same day → still 1 draft (idempotent).
5. **B5 (press).** Local: add a mention → 3 drafts.

Production smoke: pick one real recent event of each kind, run end-to-end at low-traffic time.

---

## Per-platform caption refinement (optional)

If you want different framing per network (LinkedIn long-form vs Twitter one-liner), build per-platform captions and fan out manually:

```ts
const platforms = ["linkedin", "twitter", "bluesky"] as const;
const captions = {
  linkedin: longFormCaption(post),    // up to 3000 chars
  twitter: oneLinerCaption(post),     // ≤280
  bluesky: oneLinerCaption(post),     // ≤300
};
for (const platform of platforms) {
  fireOutboxDrafts({
    triggerUserId: getCurrentUser().id,
    externalRefBase: `bam-blog-${post.slug}`,
    caption: captions[platform],
    mediaUrls: post.coverImageUrl ? [post.coverImageUrl] : [],
    platforms: [platform],
  });
}
```

Optional. Default single-caption is fine for v1.

---

## Reference

- [INTEGRATE.md](../INTEGRATE.md) — gate logic + sender + smoke template + branch/merge rule.
- [sender.ts](../sender.ts) — copy verbatim into `bam-landing-page/lib/sender-outbox.ts`.
