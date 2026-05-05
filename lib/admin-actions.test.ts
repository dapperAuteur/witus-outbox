import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  findFirstScheduled,
  setSpy,
  insertValuesSpy,
  publisherMock,
  resolveMock,
  alertSpy,
} = vi.hoisted(() => ({
  findFirstScheduled: vi.fn(),
  setSpy: vi.fn(),
  insertValuesSpy: vi.fn(),
  publisherMock: {
    backend: "ocoya",
    isLive: true,
    createPost: vi.fn(),
    deletePost: vi.fn(),
    getPost: vi.fn(),
    updateScheduledAt: vi.fn(),
    listProfiles: vi.fn(),
    syncAllProfiles: vi.fn(),
    getPostsByStatus: vi.fn(),
  },
  resolveMock: vi.fn(),
  alertSpy: vi.fn(),
}));

// Drizzle's update/insert is a thenable chain:
//   await db.update(table).set({...}).where(...)
//   await db.insert(table).values({...})
// We capture the .set() and .values() args via spies; the `.where()` and
// terminal awaits resolve to undefined.
function makeDb() {
  const updateBuilder = {
    set: (args: unknown) => {
      setSpy(args);
      return {
        where: () => Promise.resolve(),
      };
    },
  };
  const insertBuilder = {
    values: (args: unknown) => {
      insertValuesSpy(args);
      return Promise.resolve();
    },
  };
  return {
    query: { scheduledPosts: { findFirst: findFirstScheduled } },
    update: () => updateBuilder,
    insert: () => insertBuilder,
  };
}

vi.mock("@/db", () => ({ getDb: () => makeDb() }));
vi.mock("@/db/schema", () => ({
  scheduledPosts: { id: "id", source: "source", status: "status" },
  publishAttempts: { scheduledPostId: "scheduled_post_id" },
}));
vi.mock("@/lib/publishers", () => ({ getPublisher: () => publisherMock }));
vi.mock("@/lib/profile-resolver", () => ({ resolveProfileIds: resolveMock }));
vi.mock("@/lib/alerts", () => ({ sendOutboxAlert: alertSpy }));

import {
  cancelPost,
  reconcileNowPost,
  reschedulePost,
  retryPost,
} from "./admin-actions";

const baseRow = {
  id: "11111111-1111-1111-1111-111111111111",
  source: "centenarianos",
  draftId: "ep-12",
  platform: "twitter",
  caption: "hello",
  mediaUrls: ["https://cdn.example.com/img.png"],
  links: [],
  scheduledAt: new Date("2026-06-01T12:00:00Z"),
  status: "queued" as const,
  publisherBackend: "ocoya",
  publisherWorkspaceId: "ws-1",
  publisherProfileIdsOverride: null as unknown,
  publisherPostId: null as string | null,
  publisherErrorDetail: null,
  submittedAt: null,
  lastPolledAt: null,
  postedAt: null,
  createdAt: new Date("2026-05-04T00:00:00Z"),
  updatedAt: new Date("2026-05-04T00:00:00Z"),
};

beforeEach(() => {
  resolveMock.mockResolvedValue({ ids: ["P-1"], source: "default" });
  publisherMock.isLive = true;
  publisherMock.backend = "ocoya";
});

afterEach(() => {
  findFirstScheduled.mockReset();
  setSpy.mockReset();
  insertValuesSpy.mockReset();
  publisherMock.createPost.mockReset();
  publisherMock.deletePost.mockReset();
  publisherMock.getPost.mockReset();
  publisherMock.updateScheduledAt.mockReset();
  resolveMock.mockReset();
  alertSpy.mockReset();
});

describe("retryPost", () => {
  it("returns not_found when row is missing", async () => {
    findFirstScheduled.mockResolvedValue(undefined);
    const r = await retryPost(baseRow.id);
    expect(r).toEqual({ ok: false, error: "not_found" });
    expect(publisherMock.createPost).not.toHaveBeenCalled();
  });

  it("refuses to retry posted rows", async () => {
    findFirstScheduled.mockResolvedValue({ ...baseRow, status: "posted" });
    const r = await retryPost(baseRow.id);
    expect(r).toEqual({ ok: false, error: "cannot_retry_posted" });
    expect(publisherMock.createPost).not.toHaveBeenCalled();
  });

  it("refuses to retry cancelled rows", async () => {
    findFirstScheduled.mockResolvedValue({ ...baseRow, status: "cancelled" });
    const r = await retryPost(baseRow.id);
    expect(r).toEqual({ ok: false, error: "cannot_retry_cancelled" });
  });

  it("refuses to retry already-submitted rows (publisherPostId set)", async () => {
    findFirstScheduled.mockResolvedValue({
      ...baseRow,
      status: "submitted",
      publisherPostId: "OCOYA-123",
    });
    const r = await retryPost(baseRow.id);
    expect(r).toEqual({ ok: false, error: "already_submitted" });
  });

  it("flips to error + alerts when no profile resolves and adapter is live", async () => {
    findFirstScheduled.mockResolvedValue(baseRow);
    resolveMock.mockResolvedValue({ ids: [], source: "none" });
    const r = await retryPost(baseRow.id);
    expect(r).toEqual({ ok: false, error: "no_social_profile", status: "error" });
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        publisherErrorDetail: { code: "no_social_profile", http_status: null },
      })
    );
    expect(alertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", errorCode: "no_social_profile" })
    );
    expect(publisherMock.createPost).not.toHaveBeenCalled();
  });

  it("does not flip to error when adapter is not live (dev-log path)", async () => {
    findFirstScheduled.mockResolvedValue(baseRow);
    resolveMock.mockResolvedValue({ ids: [], source: "none" });
    publisherMock.isLive = false;
    publisherMock.createPost.mockResolvedValue({
      ok: true,
      externalId: "DEV-LOG",
    });
    const r = await retryPost(baseRow.id);
    expect(r.ok).toBe(true);
    expect(r.status).toBe("submitted");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("flips to submitted on a successful createPost", async () => {
    findFirstScheduled.mockResolvedValue(baseRow);
    publisherMock.createPost.mockResolvedValue({
      ok: true,
      externalId: "OCOYA-NEW-1",
    });
    const r = await retryPost(baseRow.id);
    expect(r).toEqual({
      ok: true,
      status: "submitted",
      publisherPostId: "OCOYA-NEW-1",
    });
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "submitted",
        publisherPostId: "OCOYA-NEW-1",
        publisherErrorDetail: null,
      })
    );
  });

  it("flips to error + alerts on a 4xx createPost (permanent)", async () => {
    findFirstScheduled.mockResolvedValue(baseRow);
    publisherMock.createPost.mockResolvedValue({
      ok: false,
      status: 400,
      detail: "invalid_caption",
    });
    const r = await retryPost(baseRow.id);
    expect(r).toEqual({
      ok: false,
      error: "invalid_caption",
      status: "error",
    });
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        publisherErrorDetail: { code: "invalid_caption", http_status: 400 },
      })
    );
    expect(alertSpy).toHaveBeenCalled();
  });

  it("treats 429 as transient (does NOT flip to error)", async () => {
    findFirstScheduled.mockResolvedValue(baseRow);
    publisherMock.createPost.mockResolvedValue({
      ok: false,
      status: 429,
      detail: "rate_limited",
    });
    const r = await retryPost(baseRow.id);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("transient_429");
    expect(r.status).toBe("queued"); // unchanged
    // No status update written
    expect(setSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" })
    );
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("treats 503 as transient (does NOT flip to error)", async () => {
    findFirstScheduled.mockResolvedValue(baseRow);
    publisherMock.createPost.mockResolvedValue({
      ok: false,
      status: 503,
      detail: "upstream_unavailable",
    });
    const r = await retryPost(baseRow.id);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("transient_503");
    expect(setSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" })
    );
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("filters non-string entries out of mediaUrls before submit", async () => {
    findFirstScheduled.mockResolvedValue({
      ...baseRow,
      mediaUrls: ["ok-1", null, 42, "ok-2", undefined],
    });
    publisherMock.createPost.mockResolvedValue({
      ok: true,
      externalId: "X",
    });
    await retryPost(baseRow.id);
    expect(publisherMock.createPost).toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrls: ["ok-1", "ok-2"] })
    );
  });
});

describe("cancelPost", () => {
  it("is a no-op on already-cancelled rows", async () => {
    findFirstScheduled.mockResolvedValue({ ...baseRow, status: "cancelled" });
    const r = await cancelPost(baseRow.id);
    expect(r).toEqual({ ok: true, status: "cancelled" });
    expect(publisherMock.deletePost).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("refuses to cancel posted rows", async () => {
    findFirstScheduled.mockResolvedValue({ ...baseRow, status: "posted" });
    const r = await cancelPost(baseRow.id);
    expect(r).toEqual({ ok: false, error: "cannot_cancel_posted" });
    expect(publisherMock.deletePost).not.toHaveBeenCalled();
  });

  it("calls publisher.deletePost when row has a publisherPostId", async () => {
    findFirstScheduled.mockResolvedValue({
      ...baseRow,
      status: "submitted",
      publisherPostId: "OCOYA-ABC",
    });
    publisherMock.deletePost.mockResolvedValue(undefined);
    const r = await cancelPost(baseRow.id);
    expect(publisherMock.deletePost).toHaveBeenCalledWith("OCOYA-ABC");
    expect(r).toEqual({ ok: true, status: "cancelled" });
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" })
    );
  });

  it("skips publisher.deletePost when row has no publisherPostId", async () => {
    findFirstScheduled.mockResolvedValue(baseRow);
    const r = await cancelPost(baseRow.id);
    expect(publisherMock.deletePost).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, status: "cancelled" });
  });
});

describe("reschedulePost", () => {
  it("rejects times less than 5 min in the future", async () => {
    const r = await reschedulePost(
      baseRow.id,
      new Date(Date.now() + 3 * 60_000)
    );
    expect(r).toEqual({ ok: false, error: "must_be_5min_in_future" });
    expect(findFirstScheduled).not.toHaveBeenCalled();
  });

  it("refuses to reschedule cancelled rows", async () => {
    findFirstScheduled.mockResolvedValue({ ...baseRow, status: "cancelled" });
    const r = await reschedulePost(
      baseRow.id,
      new Date(Date.now() + 60 * 60_000)
    );
    expect(r).toEqual({ ok: false, error: "cannot_reschedule_cancelled" });
  });

  it("refuses to reschedule posted rows", async () => {
    findFirstScheduled.mockResolvedValue({ ...baseRow, status: "posted" });
    const r = await reschedulePost(
      baseRow.id,
      new Date(Date.now() + 60 * 60_000)
    );
    expect(r).toEqual({ ok: false, error: "cannot_reschedule_posted" });
  });

  it("calls publisher.updateScheduledAt when row was submitted", async () => {
    findFirstScheduled.mockResolvedValue({
      ...baseRow,
      status: "submitted",
      publisherPostId: "OCOYA-XYZ",
    });
    const newAt = new Date(Date.now() + 60 * 60_000);
    const r = await reschedulePost(baseRow.id, newAt);
    expect(publisherMock.updateScheduledAt).toHaveBeenCalledWith(
      "OCOYA-XYZ",
      newAt
    );
    expect(r.ok).toBe(true);
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: newAt })
    );
  });

  it("skips publisher.updateScheduledAt when row has no publisherPostId", async () => {
    findFirstScheduled.mockResolvedValue(baseRow);
    const newAt = new Date(Date.now() + 60 * 60_000);
    const r = await reschedulePost(baseRow.id, newAt);
    expect(publisherMock.updateScheduledAt).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });
});

describe("reconcileNowPost", () => {
  const submittedRow = {
    ...baseRow,
    status: "submitted" as const,
    publisherPostId: "OCOYA-7",
  };

  it("returns not_yet_submitted when publisherPostId is null", async () => {
    findFirstScheduled.mockResolvedValue(baseRow);
    const r = await reconcileNowPost(baseRow.id);
    expect(r).toEqual({ ok: false, error: "not_yet_submitted" });
    expect(publisherMock.getPost).not.toHaveBeenCalled();
  });

  it("returns publisher_returned_nothing when getPost yields null", async () => {
    findFirstScheduled.mockResolvedValue(submittedRow);
    publisherMock.getPost.mockResolvedValue(null);
    const r = await reconcileNowPost(baseRow.id);
    expect(r).toEqual({ ok: false, error: "publisher_returned_nothing" });
  });

  it("flips local row to posted when remote is posted", async () => {
    findFirstScheduled.mockResolvedValue(submittedRow);
    const postedAt = new Date("2026-06-01T12:01:00Z");
    publisherMock.getPost.mockResolvedValue({
      externalId: "OCOYA-7",
      status: "posted",
      errorDetail: null,
      postedAt,
    });
    const r = await reconcileNowPost(baseRow.id);
    expect(r.ok).toBe(true);
    expect(r.status).toBe("posted");
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "posted", postedAt })
    );
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("flips to error + fires alert on a fresh transition to error", async () => {
    findFirstScheduled.mockResolvedValue(submittedRow);
    publisherMock.getPost.mockResolvedValue({
      externalId: "OCOYA-7",
      status: "error",
      errorDetail: "media_rejected",
      postedAt: null,
    });
    const r = await reconcileNowPost(baseRow.id);
    expect(r.status).toBe("error");
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        publisherErrorDetail: { code: "media_rejected", http_status: null },
      })
    );
    expect(alertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "reconcile", status: "error" })
    );
  });

  it("does NOT re-fire alert when row was already error (avoids duplicate alerts)", async () => {
    findFirstScheduled.mockResolvedValue({
      ...submittedRow,
      status: "error",
    });
    publisherMock.getPost.mockResolvedValue({
      externalId: "OCOYA-7",
      status: "error",
      errorDetail: "still_failing",
      postedAt: null,
    });
    await reconcileNowPost(baseRow.id);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("flips to scheduled when remote is scheduled", async () => {
    findFirstScheduled.mockResolvedValue(submittedRow);
    publisherMock.getPost.mockResolvedValue({
      externalId: "OCOYA-7",
      status: "scheduled",
      errorDetail: null,
      postedAt: null,
    });
    const r = await reconcileNowPost(baseRow.id);
    expect(r.status).toBe("scheduled");
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "scheduled" })
    );
  });

  it("leaves status unchanged for unmapped publisher states (draft, pending_approval)", async () => {
    findFirstScheduled.mockResolvedValue(submittedRow);
    publisherMock.getPost.mockResolvedValue({
      externalId: "OCOYA-7",
      status: "draft",
      errorDetail: null,
      postedAt: null,
    });
    const r = await reconcileNowPost(baseRow.id);
    expect(r.status).toBe("submitted"); // original status
  });
});
