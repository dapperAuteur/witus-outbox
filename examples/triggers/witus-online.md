# Trigger recipe — witus.online: podcast publishing

> Pair this file with [INTEGRATE.md](../INTEGRATE.md) for the gate logic, sender setup, and smoke checklist. This file covers WHAT triggers and HOW for witus.online specifically.

---

## What this trigger fires on

Episode publish in witus.online — for **two distinct podcasts**:

| Show | Disctopia URL | Outbox slug | Workspace (in `INGEST_SOURCES[slug].workspace_name`) |
|---|---|---|---|
| Brand Anthony McDonald — World's Fastest Centenarian | <https://play.disctopia.com/podcasts/bam_worlds_fastest_centenarian> | `witus-online-podcast` | `B4C LLC` (BAM's personal social profiles) |
| African American Museum of Southern Arizona | <https://play.disctopia.com/Podcasts/african-american-museum-of-southern-arizona-podcast> | `aamsaz-podcast` | `AAMSAZ` (museum profiles only) |

Two slugs, two HMAC secrets, two `INGEST_SOURCES` entries. The slug → workspace mapping (slice 28) is what routes each show's drafts to the right set of social profiles. WFC episodes post from BAM's personal accounts; AAMSAZ episodes post from museum accounts.

**Same publisher app fires both** — the trigger function takes a `show` parameter that resolves to slug + secret. No need for two separate publisher products.

---

## Pre-reqs (operator side; see `plans/user-tasks/10-witus-online-podcast-trigger.md`)

Before this recipe is wired:

- Both slugs provisioned in outbox's `INGEST_SOURCES` (3 envs each — local, Preview, Production).
- Two HMAC secrets generated (one per slug). Both 64-char hex from `openssl rand -hex 32`.
- Witus.online has env vars per show — see step 1 below.

---

## Trigger code (in `witus.online` repo)

### Step 0 — install the layered-gate helper

If not already present, copy [INTEGRATE.md](../INTEGRATE.md) Step 2's `lib/outbox-trigger.ts` template into `witus.online/lib/outbox-trigger.ts`. That file owns the kill-switch, BAM-only gate, and `fireOutboxDrafts` shape. Don't duplicate gate logic per-trigger.

### Step 1 — env vars in witus.online

Three URL-related vars + two secret pairs (one per show):

```env
OUTBOX_INGEST_URL=https://outbox.witus.online/api/ingest    # (Preview / local URLs differ)
OUTBOX_TRIGGER_ENABLED=                                     # default unset = off; flip to "true" when smoking
PRODUCT_OWNER_USER_ID=<BAM's user id in witus.online's DB>

# Per-show slug + secret. Default secret env name remains OUTBOX_INGEST_SECRET
# for sender.ts compat; the trigger helper picks the right one per show.
OUTBOX_PODCAST_WFC_SLUG=witus-online-podcast
OUTBOX_PODCAST_WFC_SECRET=<the 64-char hex matching INGEST_SOURCES["witus-online-podcast"].hmac_secret>
OUTBOX_PODCAST_AAMSAZ_SLUG=aamsaz-podcast
OUTBOX_PODCAST_AAMSAZ_SECRET=<the 64-char hex matching INGEST_SOURCES["aamsaz-podcast"].hmac_secret>
```

### Step 2 — podcast-trigger function

Create `witus.online/lib/podcast-trigger.ts`:

```ts
import { after } from "next/server";
import { sendToOutbox, type OutboxPlatform } from "./sender-outbox";

type Show = "wfc" | "aamsaz";

const SHOW_CONFIG: Record<Show, { slug: string; secretEnvKey: string; productName: string }> = {
  wfc: {
    slug: process.env.OUTBOX_PODCAST_WFC_SLUG!,
    secretEnvKey: "OUTBOX_PODCAST_WFC_SECRET",
    productName: "World's Fastest Centenarian",
  },
  aamsaz: {
    slug: process.env.OUTBOX_PODCAST_AAMSAZ_SLUG!,
    secretEnvKey: "OUTBOX_PODCAST_AAMSAZ_SECRET",
    productName: "African American Museum of Southern Arizona Podcast",
  },
};

const PLATFORMS: readonly OutboxPlatform[] = ["linkedin", "twitter", "bluesky"];

export function firePodcastEpisodePublished(args: {
  show: Show;
  triggerUserId: string;
  episodeNumber: number;
  episodeId: string;
  title: string;
  showNotesExcerpt: string;
  artworkUrl: string;
  disctopiaUrl: string;
}) {
  // Layered gates (per INTEGRATE.md):
  if (process.env.OUTBOX_TRIGGER_ENABLED !== "true") return;
  if (args.triggerUserId !== process.env.PRODUCT_OWNER_USER_ID) return;

  const cfg = SHOW_CONFIG[args.show];
  const secret = process.env[cfg.secretEnvKey];
  if (!secret) {
    console.error("[podcast-trigger] missing secret for show", args.show);
    return;
  }

  // Per-platform caption shape. Outbox doesn't author content; this app does.
  const captions: Record<OutboxPlatform, string> = {
    linkedin: buildLongFormCaption(args),    // 3000 char-friendly
    twitter: buildOneLinerCaption(args),     // ≤280
    bluesky: buildOneLinerCaption(args),     // ≤300; mirrors twitter
  } as Record<OutboxPlatform, string>;

  // Fire 3 drafts per episode. external_ref is stable so a re-publish is
  // idempotent (returns the existing row id; no duplicates).
  after(async () => {
    for (const platform of PLATFORMS) {
      const result = await sendToOutbox({
        outboxUrl: process.env.OUTBOX_INGEST_URL!,
        sourceSlug: cfg.slug,
        hmacSecret: secret,
        submission: {
          external_ref: `episode-${args.episodeId}-${platform}`,
          platform,
          caption: captions[platform],
          media_urls: [args.artworkUrl],
          // Drafts use a placeholder; operator picks real time at promote.
          scheduled_at: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
          as_draft: true,
        },
      });
      if (!result.ok) {
        console.error("[podcast-trigger] failed", {
          show: args.show,
          slug: cfg.slug,
          platform,
          episode_id: args.episodeId,
          http_status: result.status,
        });
      }
    }
  });
}

function buildLongFormCaption(args: {
  show: Show;
  episodeNumber: number;
  title: string;
  showNotesExcerpt: string;
  disctopiaUrl: string;
}): string {
  // Adapt this template per show as needed.
  return [
    `New episode (${args.episodeNumber}): "${args.title}"`,
    "",
    args.showNotesExcerpt,
    "",
    `Listen: ${args.disctopiaUrl}`,
  ].join("\n");
}

function buildOneLinerCaption(args: {
  show: Show;
  title: string;
  disctopiaUrl: string;
}): string {
  return `New episode: "${args.title}". ${args.disctopiaUrl}`;
}
```

### Step 3 — call it from the publish flow

Wherever witus.online persists "this episode is now published" — likely a server action on the episode admin form — add the trigger call AFTER the local persist succeeds:

```ts
"use server";
import { firePodcastEpisodePublished } from "@/lib/podcast-trigger";

export async function publishWfcEpisode(form: {
  episodeNumber: number;
  title: string;
  showNotesExcerpt: string;
  artworkUrl: string;
  disctopiaUrl: string;
}) {
  const session = await getServerSession();
  if (!session?.user?.id) throw new Error("unauthenticated");

  const episode = await persistEpisode(form);

  firePodcastEpisodePublished({
    show: "wfc",
    triggerUserId: session.user.id,
    episodeNumber: episode.number,
    episodeId: episode.id,
    title: episode.title,
    showNotesExcerpt: episode.showNotesExcerpt,
    artworkUrl: episode.artworkUrl,
    disctopiaUrl: episode.disctopiaUrl,
  });

  return episode;
}

// Same shape for AAMSAZ; the only diff is `show: "aamsaz"`.
export async function publishAamsazEpisode(form: { /* … */ }) {
  // … same shape, show: "aamsaz" …
}
```

---

## Smoke per show

Smoke each show **separately**. Don't ship both at once.

1. Local: publish a WFC episode. Confirm 3 rows appear at `/outbox?source=witus-online-podcast&status=draft`. Polish per-platform captions; schedule each. Confirm the per-(workspace, network) defaults under `B4C LLC` resolve correctly.
2. Local: publish an AAMSAZ episode. Confirm 3 rows appear at `/outbox?source=aamsaz-podcast&status=draft`. Confirm profiles resolve from the `AAMSAZ` workspace (museum accounts), NOT from `B4C LLC`.
3. Preview, then Production — one real episode of each show.

---

## Common gotchas specific to this trigger

- **Wrong workspace's profiles attached.** If WFC drafts show museum profiles or vice versa: check that `INGEST_SOURCES[<slug>].workspace_name` exactly matches an `OCOYA_WORKSPACE_IDS` entry's `name`. Whitespace/casing matters. Slice 28's per-source backend routing.
- **One show silently posting from the other.** Verify the `show` parameter is correct at every call site. A copy-paste bug here means AAMSAZ episodes promote from BAM's personal accounts.
- **Disctopia URL changes after publish.** If you edit the URL post-publish in witus.online, re-fire the trigger — `external_ref` is stable so outbox returns the existing row id, but if your trigger runs only on first-publish, the URL won't update in the draft. Either re-run the trigger on edit OR update the row in /outbox/[id] using the slice-33 edit UI.

---

## Reference

- [INTEGRATE.md](../INTEGRATE.md) — gate logic + sender setup + smoke template.
- [sender.ts](../sender.ts) — copy verbatim into `witus.online/lib/sender-outbox.ts`.
- [README.md](../README.md) — full HMAC contract spec.
- `plans/user-tasks/10-witus-online-podcast-trigger.md` (BAM-private) — operator provisioning checklist.
- Slice 28 (per-source backend routing) — the mechanism that maps a slug to a workspace.
