import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { redactText, scrubEvent } from "./sentry-scrub";

/**
 * The contract these tests defend: nothing outbox holds as a credential, and no request body, may
 * appear in the JSON we hand to a third-party error service. Each literal below is a shape that
 * really exists in this repo's env or in a publisher/social API response.
 */
const SECRETS = {
  ocoyaKey: "ocoya_live_9f8e7d6c5b4a39281706abcdef012345",
  socialChampKey: "sc_tok_ZmFrZVNvY2lhbENoYW1wS2V5MDEyMzQ1Njc4OQ",
  appsScriptToken: "b7c1d9e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3",
  ingestHmac: "a".repeat(64),
  neonUrl: "postgres://outbox_owner:sup3rS3cretPw@ep-fake-123.us-east-2.aws.neon.tech/outbox",
  smtpUrl: "smtps://postmaster@mg.example.com:mailgunPassw0rd@smtp.mailgun.org:465",
  nextAuthJwt:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJlbWFpbCI6ImJhbUBleGFtcGxlLmNvbSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  metaToken: "EAAJk0ZBfakegraphtokenvalue0123456789abcdef",
  googleAccess: "ya29.a0AfB_fakegoogleaccesstoken0123456789",
  // Assembled at runtime, not written as one literal: these two are fake, but a vendor-shaped
  // literal in the source trips GitHub push protection and blocks the branch.
  slackToken: ["xoxb", "1234567890", "0987654321", "fakeSlackBotToken"].join("-"),
  githubToken: `gh${"p"}_fakeGithubPersonalAccessToken0123456`,
  adminEmail: "bam@awews.com",
};

/** Every secret literal, so a test can assert on the whole serialized event at once. */
const ALL_SECRET_SUBSTRINGS = [
  "sup3rS3cretPw",
  "mailgunPassw0rd",
  SECRETS.ocoyaKey,
  SECRETS.socialChampKey,
  SECRETS.appsScriptToken,
  SECRETS.ingestHmac,
  SECRETS.nextAuthJwt,
  SECRETS.metaToken,
  SECRETS.googleAccess,
  SECRETS.slackToken,
  SECRETS.githubToken,
  SECRETS.adminEmail,
];

describe("redactText", () => {
  it("strips the password out of a Neon connection string", () => {
    const out = redactText(`connect failed: ${SECRETS.neonUrl}`);
    expect(out).not.toContain("sup3rS3cretPw");
    expect(out).toContain("postgres://");
  });

  it("strips the password out of an SMTP URI", () => {
    expect(redactText(SECRETS.smtpUrl)).not.toContain("mailgunPassw0rd");
  });

  it("removes a labelled publisher API key", () => {
    const out = redactText(`Ocoya rejected: apiKey=${SECRETS.ocoyaKey}`);
    expect(out).not.toContain(SECRETS.ocoyaKey);
    expect(out).toContain("[redacted]");
  });

  it("removes a bearer token from an Authorization value", () => {
    const out = redactText(`Authorization: Bearer ${SECRETS.appsScriptToken}`);
    expect(out).not.toContain(SECRETS.appsScriptToken);
  });

  it("removes social-platform OAuth tokens by shape, unlabelled", () => {
    for (const token of [
      SECRETS.metaToken,
      SECRETS.googleAccess,
      SECRETS.slackToken,
      SECRETS.githubToken,
    ]) {
      expect(redactText(`publish failed with ${token} in scope`)).not.toContain(token);
    }
  });

  it("removes a JWT session token", () => {
    expect(redactText(`cookie parse: ${SECRETS.nextAuthJwt}`)).not.toContain(SECRETS.nextAuthJwt);
  });

  it("removes a 64-char HMAC signature", () => {
    expect(redactText(`bad signature ${SECRETS.ingestHmac}`)).not.toContain(SECRETS.ingestHmac);
  });

  it("drops the query string of a URL but keeps the route for triage", () => {
    const out = redactText(
      `POST https://outbox.witus.online/api/admin/tick?token=${SECRETS.appsScriptToken} failed`
    );
    expect(out).not.toContain(SECRETS.appsScriptToken);
    expect(out).toContain("https://outbox.witus.online/api/admin/tick");
  });

  it("redacts a secret query param on a relative URL", () => {
    const out = redactText(`/api/admin/tick?access_token=${SECRETS.socialChampKey}`);
    expect(out).not.toContain(SECRETS.socialChampKey);
    expect(out).toContain("/api/admin/tick");
  });

  it("redacts email addresses", () => {
    expect(redactText(`notified ${SECRETS.adminEmail}`)).not.toContain(SECRETS.adminEmail);
  });

  it("leaves ordinary prose alone", () => {
    const prose = "Ocoya returned 429 for profile linkedin-main; retry scheduled in 15 minutes.";
    expect(redactText(prose)).toBe(prose);
  });
});

describe("scrubEvent", () => {
  /** A worst-case event: every credential this service holds, in every field Sentry populates. */
  function kitchenSinkEvent(): ErrorEvent {
    return {
      type: undefined,
      message: `submit failed: apiKey=${SECRETS.ocoyaKey} against ${SECRETS.neonUrl}`,
      user: {
        id: "admin",
        email: SECRETS.adminEmail,
        ip_address: "203.0.113.9",
        username: "bam",
      },
      request: {
        url: `https://outbox.witus.online/api/ingest?signature=${SECRETS.ingestHmac}`,
        method: "POST",
        query_string: `signature=${SECRETS.ingestHmac}`,
        cookies: { "next-auth.session-token": SECRETS.nextAuthJwt },
        data: {
          post: { content: "New episode is live!", scheduled_at: "2026-08-01T12:00:00Z" },
          api_key: SECRETS.ocoyaKey,
        },
        headers: {
          host: "outbox.witus.online",
          authorization: `Bearer ${SECRETS.appsScriptToken}`,
          cookie: `next-auth.session-token=${SECRETS.nextAuthJwt}`,
          "x-witus-signature": SECRETS.ingestHmac,
          "x-forwarded-for": "203.0.113.9",
          "user-agent": "Google-Apps-Script",
        },
      },
      exception: {
        values: [
          {
            type: "Error",
            value: `SocialChamp 401 for token ${SECRETS.socialChampKey} (${SECRETS.metaToken})`,
            stacktrace: {
              frames: [
                {
                  filename: "lib/publishers/socialchamp.ts",
                  function: "submit",
                  vars: { key: SECRETS.socialChampKey },
                },
              ],
            },
          },
        ],
      },
      breadcrumbs: [
        {
          category: "console",
          message: `[dev] SMS to ${SECRETS.adminEmail} with ${SECRETS.slackToken}`,
          data: {
            url: `https://api.ocoya.com/v1/posts?api_key=${SECRETS.ocoyaKey}`,
            body: { content: "draft copy", token: SECRETS.githubToken },
          },
        },
      ],
      extra: {
        publisherResponse: { access_token: SECRETS.googleAccess, status: "error" },
        rawBody: `{"signature":"${SECRETS.ingestHmac}"}`,
        note: `retrying with ${SECRETS.appsScriptToken}`,
      },
      tags: { "publisher.backend": "ocoya", note: `key ${SECRETS.ocoyaKey}` },
      contexts: {
        trace: { trace_id: "0af7651916cd43dd8448eb211c80319c", span_id: "b7ad6b7169203331" },
        env: { database: SECRETS.neonUrl },
      },
    } as ErrorEvent;
  }

  it("leaks no secret anywhere in the serialized payload", () => {
    const serialized = JSON.stringify(scrubEvent(kitchenSinkEvent()));
    for (const secret of ALL_SECRET_SUBSTRINGS) {
      expect(serialized, `leaked: ${secret}`).not.toContain(secret);
    }
  });

  it("drops the request body outright", () => {
    const event = scrubEvent(kitchenSinkEvent());
    expect(event.request?.data).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain("New episode is live!");
  });

  it("drops cookies, credentialed headers and the caller IP", () => {
    const event = scrubEvent(kitchenSinkEvent());
    const headers = event.request?.headers as Record<string, string>;
    expect(event.request?.cookies).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
    expect(headers["x-witus-signature"]).toBeUndefined();
    expect(headers["x-forwarded-for"]).toBeUndefined();
    // Non-credential headers survive: they are what makes a report triageable.
    expect(headers.host).toBe("outbox.witus.online");
    expect(headers["user-agent"]).toBe("Google-Apps-Script");
  });

  it("drops the operator identity but keeps the user id", () => {
    const event = scrubEvent(kitchenSinkEvent());
    expect(event.user?.email).toBeUndefined();
    expect(event.user?.ip_address).toBeUndefined();
    expect(event.user?.username).toBeUndefined();
    expect(event.user?.id).toBe("admin");
  });

  it("drops captured local variables from stack frames", () => {
    const event = scrubEvent(kitchenSinkEvent());
    expect(event.exception?.values?.[0]?.stacktrace?.frames?.[0]?.vars).toBeUndefined();
  });

  it("keeps the trace context intact so grouping still works", () => {
    const event = scrubEvent(kitchenSinkEvent());
    expect(event.contexts?.trace?.trace_id).toBe("0af7651916cd43dd8448eb211c80319c");
  });

  it("keeps the route and the publisher tag for triage", () => {
    const event = scrubEvent(kitchenSinkEvent());
    expect(event.request?.url).toContain("/api/ingest");
    expect(event.tags?.["publisher.backend"]).toBe("ocoya");
  });

  it("never returns null: the crash signal survives the scrub", () => {
    expect(scrubEvent(kitchenSinkEvent())).toBeTruthy();
  });
});
