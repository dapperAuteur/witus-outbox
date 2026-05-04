# apps-script/

Source-of-truth for the Google Apps Script that polls outbox's reconciler endpoint every 15 minutes. The script itself is **deployed manually** in BAM's Google Workspace; this directory is the canonical reference so it doesn't drift from the outbox endpoint contract.

| File | Purpose |
|---|---|
| [`tick.gs`](./tick.gs) | One function (`tick()`) that POSTs to `/api/admin/tick` with a Bearer token. Paste into the Apps Script editor when first deploying or rotating. |

## Why Apps Script instead of Vercel cron

Vercel Hobby caps cron jobs at 2 daily-only schedules. Outbox needs a 5–15 minute poll cadence (publisher status changes are timely; nightly is too slow when an "Ocoya errored at publish" alert needs to land within the operator's response window). BAM's Google Workspace tier includes unlimited time-triggered Apps Script executions — same pattern witus-inbox uses for its Gmail → Sheet archive.

The script is publisher-agnostic by design. It only knows two things:

| Script Property | Value |
|---|---|
| `OUTBOX_TICK_URL` | `https://outbox.witus.online/api/admin/tick` |
| `APPS_SCRIPT_TOKEN` | The Bearer token (must equal Vercel Production env's `APPS_SCRIPT_TOKEN`) |

The Ocoya / RADAAR / SocialChamp API keys never live in Apps Script. Outbox holds them; Apps Script just rings the bell.

## Deploying for the first time

1. Open <https://script.google.com/> while signed in to BAM's Workspace account.
2. **New project** → name it **`witus-outbox-reconciler`**.
3. Replace the default `Code.gs` content with the contents of [`tick.gs`](./tick.gs).
4. **Project Settings** (gear icon) → **Script properties** → **Add script property**:
   - `OUTBOX_TICK_URL` → `https://outbox.witus.online/api/admin/tick`
   - `APPS_SCRIPT_TOKEN` → the value from your password manager (must equal Vercel Production `APPS_SCRIPT_TOKEN`).
5. **Triggers** (clock icon, left sidebar) → **Add Trigger**:
   - Function: `tick`
   - Event source: **Time-driven**
   - Type of time-based trigger: **Minutes timer → Every 15 minutes**
   - Failure notification: **Notify me daily**
6. The first execution prompts for OAuth consent (`UrlFetchApp` external request scope). Click through with BAM's Google account.
7. Wait 15 minutes. **Executions** tab in the Apps Script editor should show a `tick` row with `Completed`. Outbox's Vercel logs should show `[admin/tick] backend=ocoya …`.

## Rotating `APPS_SCRIPT_TOKEN`

The token is shared between Apps Script (sender) and outbox `/api/admin/tick` (receiver). Rotation:

1. Generate a new value: `openssl rand -hex 32`.
2. Update **both** in lockstep:
   - Vercel Production env → `APPS_SCRIPT_TOKEN` (and Preview, and your `.env.local` if you run the CLI).
   - Apps Script → Script Properties → `APPS_SCRIPT_TOKEN`.
3. Trigger interval gives you ~5–15 min of grace where reconcile attempts will 401. That's acceptable; document the rotation start time in your password manager so the gap is auditable.

## Updating the script

Edits to `tick.gs` in this repo are NOT auto-deployed. After merging a change here:

1. Open the Apps Script editor for `witus-outbox-reconciler`.
2. Replace `Code.gs` with the new contents.
3. Save (`⌘S` / `Ctrl+S`).
4. The next time-driven trigger picks up the new code automatically.

If the change adds a new Script Property or scope, do step 4 of "Deploying for the first time" first.

## Smoke testing manually

In the Apps Script editor, with the function dropdown set to `tick`, click **Run**. The execution log should show:

```
outbox-tick status=200 body={"ok":true,"backend":"ocoya","profilesRefreshed":false,"workspaces":[…],"retriedQueued":0}
```

If `status=401`, the bearer token mismatch needs fixing (check both ends).
If `status=500`, check Vercel's logs for the structured error — usually a schema migration that wasn't applied to the production Neon branch.

## Why not commit the deployed script id

Apps Script doesn't have a clean "deploy from a repo" flow for time-triggered scripts (Web Apps yes, time triggers no). The source lives here as the authoritative copy; deployment is manual. If Google ever exposes a CLI for this (clasp does for Web Apps), we'll switch.
