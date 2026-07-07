## What this repo is

**witus-outbox** is the publishing-side counterpart to **witus-inbox**. Inbox *receives* signed JSON webhooks from ecosystem products and stores normalized submissions; outbox *receives* signed "publish this" webhooks (and CSV imports) and forwards them to **Ocoya** for social media distribution.

Same shape as inbox: Next.js 16 App Router, Drizzle ORM + Neon Postgres, NextAuth (single-admin email magic link), HMAC-signed `/api/ingest`. Different direction: outbound to Ocoya rather than triage of inbound submissions.

Domain: `outbox.witus.online`. One Ocoya workspace, one API key, one rate-limit budget — owned by this service so individual products never see the credential.

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

---

<!-- BEGIN:witus-shared-rules v1 -->
<!-- MANAGED BLOCK — do not edit by hand. Source: gemini/witus/docs/shared-rules.md.
     Update the source, then run `node scripts/sync-claude-rules.mjs` in the witus repo. -->

## ⚠️ Ecosystem identity (shared note — don't confuse repos)

Full ecosystem identity + the canonical product index live in `gemini/witus/CLAUDE.md` and
`gemini/witus/lib/products.ts`. Each repo states *which* product it is in its own hand-owned line
above this managed block; don't infer another app's URLs, routes, IDs, env names, or DB schema —
confirm against that app's own code.

The site **brandanthonymcdonald.com** (BAM's personal portfolio) lives in `claude/bam-landing-page/`
— **NOT** `projects/bam-portfolio/` (the retired legacy static site). Target `bam-landing-page`.

## Operator-task rule — capture user actions in `./plans/user-tasks/`

When Claude proposes work that needs BAM to do something outside the editor (account signup, API
key, DNS change, vendor dashboard, env-var rotation, secret generation, PR review/merge, etc.),
Claude MUST create a `./plans/user-tasks/NN-slug.md` file in this repo. **No exceptions for "small"
steps.** Required sections: **Scope tag** · **What + why** (with explicit *what this blocks* detail
and any hard deadline) · **Steps** · **What Claude will use** · **How to mark done** · **Related**.
Keep `./plans/user-tasks/00-descriptions.md` updated with columns `# | Title | Scope | Blocks |
Status` — the `Blocks` column is the one BAM scans. Ecosystem-wide tasks (Keap, IRL events, retros,
cross-product decisions) live in the canonical witus queue at `gemini/witus/plans/user-tasks/`;
repo-local tasks live here. Read the witus queue at session start before dependent work. Full rule:
`gemini/witus/CLAUDE.md` §"Operator-task rule".

## Branch hygiene — BAM merges, between sessions by default

**Half 1.** Branch → commit → push → stop. Claude does not run `git checkout main && git merge`.
Never `--force` to shared branches. Before every commit run `git branch --show-current`; if it is
`main`/`master`, branch first (`feat/ fix/ chore/ docs/`). After push, hand back the branch name +
summary and stop.

**Half 2.** BAM merges pushed branches via the GitHub UI between sessions. Mid-session, after a
push, BAM may merge in a separate window and the local checkout silently fast-forwards to `main` —
so re-check `git branch --show-current` before **every** commit, not just at branch creation, or you
risk landing follow-up commits directly on `main`.

**Half 3.** Keep branches small (one concern each). When a session produces multiple branches,
consolidate them into one `bundle/<slug>-YYYY-MM-DD` via `git merge --no-ff` (preserves per-concern
history — no squash), resolve conflicts during bundling, run `tsc + lint + build` against the
bundle, push, and file ONE `./plans/user-tasks/NN-merge-bundle-<slug>.md`. BAM does one merge, not N.

**Commit often.** Commit at every working checkpoint — a passing build, a finished sub-step, a green
test — not just at the end. A usage-limit cutoff, a dropped connection, or a crashed session must
never lose more than the last few minutes of work. Small frequent commits on the feature branch keep
the branch un-merged (Half 1 still holds) and give BAM clean per-step history to drill into.

A checked-in `.githooks/pre-commit` guard refuses commits made directly on `main`/`master`. Activate
once per clone: `git config core.hooksPath .githooks`. Full rule: `gemini/witus/CLAUDE.md`
§"Branch-hygiene rule".

## Docs-sync rule — a change isn't done until its docs are current

When a change adds, alters, or removes a user-visible feature/route/scope, update the affected docs
**in the same branch**: README (feature list, env examples, scripts), in-app help/tutorial content,
`ROADMAP.md` **and** any public roadmap page, API/OpenAPI docs, and STYLE_GUIDE/CONTRIBUTING when a
convention changed. State which docs you touched in the handoff. Never leave an aspirational ✅ on a
roadmap — downgrade it with a one-line reason. If a doc update is genuinely out of scope, file it as
a `./plans/` task rather than skipping silently. A Stop hook in `.claude/settings.json` gates on
this: if the session diff changed feature/route files but touched no docs, it blocks once and asks
you to update-or-defer. Schema-only migrations, refactors, perf, and dev-tooling changes don't
trigger it.

## Plans convention

All implementation plans live in `./plans/` as `NN-description-of-plan.md` (two-digit prefix,
kebab-case, next available number, don't skip). Sub-queues: `./plans/user-tasks/NN-slug.md`
(operator tasks), `./plans/bugs/`, `./plans/future/`. (`plans/` is typically gitignored.)

## Citation rule

Anything publishable, teachable, or partner-facing (curriculum, teaching-oriented help articles,
white papers, grant/sponsor/partner writing) uses APA 7 in-line citations with a `## References`
section. Code docs, internal notes, and `plans/user-tasks/*` are out of scope. Full rule:
`gemini/witus/CLAUDE.md` §"Citation rule".

## Authoritative-values rule — never assert guessed external values

When a value is owned by an external system (DNS/registrar, a host like Vercel, a third-party API,
or another ecosystem app's URLs/routes/IDs/env/schema), read it from the authoritative source; don't
hardcode a guessed default and present it as correct. If you must ship a fallback, label it as a
fallback in both UI copy and a code comment. Verify by behavior (does the flow work?), not by
exact-match against a guess. When unsure, flag or ask — never assert. Full rule:
`gemini/witus/CLAUDE.md` §"Authoritative-values rule".

## Coding conventions

UI/UX/DX conventions (a11y, component patterns, TypeScript, microcopy, git-commit vocabulary, the
default Neon+Drizzle+pnpm+Vitest stack) are consolidated in `gemini/witus/docs/shared-ui-ux-dx.md`.
Read it before writing UI or API code. Two repos are grandfathered on Supabase+Jest and documented
there as exceptions.

<!-- END:witus-shared-rules v1 -->
