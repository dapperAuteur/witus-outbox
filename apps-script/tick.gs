/**
 * witus-outbox-reconciler — Google Apps Script time trigger.
 *
 * Runs every 15 min in BAM's Google Workspace (free, unlimited execution
 * count for Workspace-tier time triggers). The Vercel Hobby plan caps cron
 * jobs to 2 daily-only schedules, which doesn't fit outbox's 5–15 min poll
 * cadence. Apps Script sidesteps the limit entirely.
 *
 * This script does NOT hold any publisher API keys. It only knows:
 *   - OUTBOX_TICK_URL — the outbox endpoint to POST to.
 *   - APPS_SCRIPT_TOKEN — the bearer token outbox validates.
 *
 * Outbox internally dispatches to whichever publisher backend is active
 * (PUBLISHER_BACKEND env). Swapping publishers requires zero changes here.
 *
 * Deploy: see ../apps-script/README.md.
 */

function tick() {
  var props = PropertiesService.getScriptProperties();
  var target = props.getProperty('OUTBOX_TICK_URL');
  var token = props.getProperty('APPS_SCRIPT_TOKEN');

  if (!target || !token) {
    throw new Error('Missing OUTBOX_TICK_URL or APPS_SCRIPT_TOKEN script property');
  }

  var res = UrlFetchApp.fetch(target, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({}),
    muteHttpExceptions: true,
  });

  var status = res.getResponseCode();
  var body = res.getContentText();
  // Truncate body in the log to keep Apps Script's execution log readable.
  // Outbox's own Vercel logs carry the full structured result.
  var preview = body.length > 600 ? body.slice(0, 600) + '…(truncated)' : body;
  Logger.log('outbox-tick status=' + status + ' body=' + preview);

  if (status >= 500) {
    // Re-throw so Apps Script's failure-notification setting fires an email.
    throw new Error('outbox-tick HTTP ' + status);
  }
}
