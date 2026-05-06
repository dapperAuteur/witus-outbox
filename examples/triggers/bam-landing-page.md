# Trigger recipe — bam-landing-page: blog post publishing

> Pair this file with [INTEGRATE.md](../INTEGRATE.md) for gate logic, sender setup, and smoke checklist.

---

## What this triggers on

When a new blog post is published on bam-landing-page (BAM's portfolio at brandanthonymcdonald.com), fire 3 outbox drafts.

Slug: `bam-landing-page`. Single trigger. BAM-only — bam-landing-page is a single-author site, the gate naturally restricts to BAM via `PRODUCT_OWNER_USER_ID`.

| Event | `external_ref` | Default platforms |
|---|---|---|
| Blog post published | `bam-blog-{postSlug}-{platform}` | linkedin, twitter, bluesky |

`postSlug` is more stable than `postId` for this trigger because BAM may rename/move posts and the slug typically stays. If your CMS uses ids, use `postId` and live with re-fires on slug changes.

---

## Pre-reqs (operator side)

- `bam-landing-page` slug provisioned in outbox's `INGEST_SOURCES` ✓ (done)
- Three env vars in bam-landing-page's project: `OUTBOX_INGEST_URL`, `OUTBOX_SOURCE_SLUG=bam-landing-page`, `OUTBOX_INGEST_SECRET`
- `OUTBOX_TRIGGER_ENABLED` (default unset = off) and `PRODUCT_OWNER_USER_ID` (BAM's user id in bam-landing-page's auth/CMS)

---

## Trigger code

### Step 0 — install the layered-gate helper

Per [INTEGRATE.md](../INTEGRATE.md) Step 2 — `lib/outbox-trigger.ts` template (kill-switch + BAM-only gate + `fireOutboxDrafts`).

### Step 1 — wire the blog-publish trigger

Where: in the blog-publish flow, after the post's status flips to `published` (or whatever your CMS's publish-completion signal is). For a static-site/MDX setup, this is the deploy or build hook; for a DB-backed CMS, the server action that flips visibility.

```ts
import { fireOutboxDrafts } from "@/lib/outbox-trigger";

export async function publishBlogPost(post: {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  url: string;            // public URL on brandanthonymcdonald.com
  coverImageUrl?: string; // optional
}) {
  // 1. Persist the published state (your existing logic).
  await persistPublished(post);

  // 2. Fire outbox drafts (gates inside fireOutboxDrafts: kill-switch + BAM-only).
  fireOutboxDrafts({
    triggerUserId: getCurrentUser().id,           // adapt to your auth pattern
    externalRefBase: `bam-blog-${post.slug}`,
    caption: buildCaption(post),
    mediaUrls: post.coverImageUrl ? [post.coverImageUrl] : [],
    platforms: ["linkedin", "twitter", "bluesky"],
  });
}

function buildCaption(post: { title: string; excerpt: string; url: string }): string {
  // Adapt freely; bam-landing-page authors content.
  return [
    `New post: "${post.title}"`,
    "",
    post.excerpt,
    "",
    post.url,
  ].join("\n");
}
```

`external_ref = bam-blog-{slug}-{platform}` is stable across re-publishes (editing a post after publish doesn't create new drafts; outbox returns the existing row id).

### Step 2 — caption per platform (optional refinement)

If you want different framing per network (LinkedIn long-form vs Twitter one-liner), build per-platform captions and pass them via custom logic. The default helper sends the same caption to all selected platforms; for differentiation, fan out manually:

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
    platforms: [platform],            // one platform per call
  });
}
```

This is optional. Default single-caption is fine for v1.

---

## Smoke

1. **Local.** Publish a draft post on local bam-landing-page. Confirm 3 drafts at `/outbox?source=bam-landing-page&status=draft` with cover image attached.
2. **Idempotency.** Edit + re-publish the same post. Confirm same row ids returned (no duplicate drafts).
3. **Production.** Pick a real blog post; smoke at low-traffic time.

---

## Reference

- [INTEGRATE.md](../INTEGRATE.md) — gate logic + sender + smoke template.
- [sender.ts](../sender.ts) — copy verbatim into `bam-landing-page/lib/sender-outbox.ts`.
