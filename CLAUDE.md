## ⚠️ Ecosystem repo identity (don't confuse these)

The site **brandanthonymcdonald.com** (BAM's personal portfolio) lives in `/Users/bam/Code_NOiCloud/ai-builds/claude/bam-landing-page/`, **NOT** `bam-portfolio`. A stray directory at `/Users/bam/Code_NOiCloud/projects/bam-portfolio/` exists from a prior misplaced `Write` call (parent dirs auto-created); it is not a real repo. When asked to work on the brandanthonymcdonald.com codebase, target `bam-landing-page`.

This mistake has been made more than once. If you're about to write a file under `projects/bam-portfolio/` or refer to it as the BAM portfolio repo, stop and re-read this note.

---

## What this repo is

**witus-outbox** is the publishing-side counterpart to **witus-inbox**. Inbox *receives* signed JSON webhooks from ecosystem products and stores normalized submissions; outbox *receives* signed "publish this" webhooks (and CSV imports) and forwards them to **Ocoya** for social media distribution.

Same shape as inbox: Next.js 16 App Router, Drizzle ORM + Neon Postgres, NextAuth (single-admin email magic link), HMAC-signed `/api/ingest`. Different direction: outbound to Ocoya rather than triage of inbound submissions.

Domain: `outbox.witus.online`. One Ocoya workspace, one API key, one rate-limit budget — owned by this service so individual products never see the credential.

---

## Operator-task rule: capture user actions in `./plans/user-tasks/`

When Claude proposes work that needs BAM to do something outside the editor (account signup, API key, DNS change, vendor dashboard, env-var rotation, secret generation, PR review/merge, etc.), Claude MUST create a `./plans/user-tasks/NN-slug.md` file in this repo. **No exceptions for "small" steps.**

Required sections per task file: **Scope tag** · **What + why** (with explicit *what this blocks* detail and any hard deadline) · **Steps** · **What Claude will use** · **How to mark done** · **Related**.

Update `./plans/user-tasks/00-descriptions.md` index with columns `# | Title | Scope | Blocks | Status`. The `Blocks` column is non-negotiable; that's the column BAM scans to triage the queue.

Full rule with rationale: `/Users/bam/Code_NOiCloud/ai-builds/gemini/witus/CLAUDE.md` §"Operator-task rule".

**Ecosystem-wide tasks** (Keap, IRL events, weekly retros, consultant reconciliation, cross-product decisions) live in the canonical witus queue at `gemini/witus/plans/user-tasks/`. **Repo-local tasks** (Outbox deploy, env vars, vendor outreach for outbox.witus.online, Ocoya account work) live here. Read the witus queue at session start before starting dependent work.

---

## Branch hygiene — BAM merges, between sessions by default

**Half 1.** End-of-branch contract: branch → commit → push → stop. Claude does not run `git checkout main && git merge`. Never `--force` to shared branches. After push, hand back the branch name + summary and stop.

**Half 2.** BAM merges committed-and-pushed branches via the GitHub UI before the next session starts, unless explicitly told otherwise. This means at session start the local checkout is typically fresh-from-main. **Mid-session, after a push, BAM may merge in a separate window and the local checkout silently fast-forwards to `main`.** Re-check `git branch --show-current` before EVERY commit, not just at branch creation, or you risk landing follow-up commits directly on `main` and bypassing the merge gate.

Full rule with rationale: `/Users/bam/Code_NOiCloud/ai-builds/gemini/witus/CLAUDE.md` §"Branch-hygiene rule".

---

## Cron-free design — Apps Script polls, outbox alerts

Vercel Hobby tier limits cron jobs (≤2, daily-only). Rather than fight it, this repo follows the same pattern witus-inbox already uses for its Sheet archive: time-driven Google Apps Script in BAM's free Workspace.

- **Eager submit on ingest** via `next/server` `after()` — most rows go straight from `queued`→`submitted` with no scheduled job involvement.
- **Google Apps Script on BAM's Workspace** runs every 5–15 min (free, unlimited). It is **publisher-agnostic**: its only job is to POST `Authorization: Bearer ${APPS_SCRIPT_TOKEN}` to outbox `/api/admin/tick`. Outbox internally dispatches to the active publisher adapter (`PUBLISHER_BACKEND` env, default `ocoya`), pages status changes, refreshes the social-profile cache when stale, and fires alerts on transitions to `error`. The publisher API key never leaves outbox.
- **Alerts come from three sources** depending on who first sees the failure:
  1. **Publisher** (e.g. witus.online) fires its own "I just submitted" SMS/email per the existing handoff pattern — outbox doesn't duplicate this.
  2. **Outbox** fires "Ocoya rejected on submit" SMS+email when ingest's `after()` callback gets a 4xx from Ocoya. `lib/sms.ts` + `lib/mailgun.ts` are verbatim copies of inbox's files.
  3. **Outbox via reconcile** fires "Ocoya errored at publish time" SMS+email when `/api/admin/reconcile` flips a row to `error`.
- **Triage UI** exposes per-row Retry / Reschedule / Cancel / Reconcile-now buttons for manual recovery between Apps Script ticks.

**No `vercel.json` cron config in this repo.** Apps Script is the source of truth for periodic work.

---

## Modularity — publisher backends are swappable

Ocoya is v1's backend. Don't hard-code "ocoya" anywhere outside `lib/publishers/ocoya.ts`. Every other module talks to a `PublisherAdapter` interface (`lib/publishers/types.ts`); `lib/publishers/index.ts` selects the active backend by reading `PUBLISHER_BACKEND` env.

DB columns are `publisher_backend`, `publisher_post_id`, `publisher_profile_id`, `publisher_error_detail` — never `ocoya_*`. In-flight rows record their `publisher_backend` so a swap can happen mid-flight without losing reconciliation paths for posts already submitted to the previous backend.

When BAM connects/removes a social account in the publisher's dashboard, no code change is needed — the daily `social_profile` refresh inside `/api/admin/tick` reads the current list from the active adapter.

Procedure to swap publishers (documented in `plans/01-witus-outbox-bootstrap.md` §Modularity):
1. Add `lib/publishers/<new-backend>.ts` implementing `PublisherAdapter`.
2. Set the new backend's API credentials in env (`<NEW_BACKEND>_API_KEY`, etc.).
3. Flip `PUBLISHER_BACKEND` env in Vercel.
4. Run `social_profile` sync against the new backend (the next Apps Script tick will do it automatically).
5. Old in-flight posts continue resolving via their stored `publisher_backend`; new posts use the new one.

---

## Sibling repos and the cross-product publishing pattern

**witus-inbox** is the reference HMAC-receiver implementation. Outbox copies these files **verbatim**:

- `lib/hmac.ts` — `verifySignature({ secret, timestamp, rawBody, signature })`, SHA256 over `${timestamp}.${rawBody}`, 5-minute skew window.
- `lib/ingest-sources.ts` — env-var registry parsing `INGEST_SOURCES` JSON. **Outbox-only fields piggy-back on the same JSON via sidecar parsers** (`lib/ingest-workspaces.ts` for `workspace_name`, `lib/ingest-publisher-backends.ts` for `publisher_backend`) using Zod `.passthrough()` — `lib/ingest-sources.ts` itself stays byte-for-byte. Inbox's strict schema strips unknown keys silently, so extra fields ride along harmlessly. **Do NOT add outbox-only fields to the verbatim file directly**; add another sidecar.
- `lib/sms.ts`, `lib/mailgun.ts` — same dev-log + production-guard pattern.
- `examples/sender.ts` — canonical sender other ecosystem products copy into their `lib/`.

When updating these in inbox, mirror to outbox in the same PR (or document the divergence here). Do not let the HMAC contract diverge between inbox and outbox.

---

## Ecosystem awareness (required reading)

Outbox lives inside the WitUS ecosystem and must stay aware of its place in it. Read these in `./plans/ecosystem/` before writing code that touches data, users, or cross-app navigation:

- [`./plans/ecosystem/README.md`](./plans/ecosystem/README.md) — Platform index, Redundancy Test, shared-infrastructure list, cross-app integration map.
- [`./plans/ecosystem/witus-outbox.md`](./plans/ecosystem/witus-outbox.md) — this product's one-job definition; what Outbox owns and explicitly does not own.
- [`./plans/ecosystem/witus-inbox.md`](./plans/ecosystem/witus-inbox.md) — sibling reference; behavior parity expected on the HMAC + alert layer.
- [`./plans/00-descriptions.md`](./plans/00-descriptions.md) — non-negotiables, coding style, git workflow, verification checklist.

Full read-order at [`./AGENTS.md`](./AGENTS.md).

@AGENTS.md
