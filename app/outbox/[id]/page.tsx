import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { publishAttempts, scheduledPosts, socialProfiles } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { PostActions } from "@/components/PostActions";
import { StatusBadge, type ScheduledPostStatus } from "@/components/StatusBadge";
import { SignOutButton } from "@/components/SignOutButton";
import { getAuthOptions } from "@/lib/auth";
import { formatScheduledTime } from "@/lib/format";
import { platformLabel } from "@/lib/platforms";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export default async function OutboxDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.email) {
    redirect("/auth/sign-in");
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    notFound();
  }

  const db = getDb();

  const post = await db.query.scheduledPosts.findFirst({
    where: eq(scheduledPosts.id, id),
  });

  if (!post) {
    notFound();
  }

  const attempts = await db
    .select({
      id: publishAttempts.id,
      attemptedAt: publishAttempts.attemptedAt,
      ok: publishAttempts.ok,
      httpStatus: publishAttempts.httpStatus,
      detail: publishAttempts.detail,
      externalId: publishAttempts.externalId,
    })
    .from(publishAttempts)
    .where(eq(publishAttempts.scheduledPostId, id))
    .orderBy(desc(publishAttempts.attemptedAt))
    .limit(20);

  // Show what profile WOULD be picked at submit time, so the operator can
  // sanity-check before clicking Retry. Same lookup logic as ingest.
  const profileWhere = post.publisherWorkspaceId
    ? and(
        eq(socialProfiles.publisherBackend, post.publisherBackend),
        eq(socialProfiles.network, post.platform),
        eq(socialProfiles.workspaceId, post.publisherWorkspaceId)
      )
    : and(
        eq(socialProfiles.publisherBackend, post.publisherBackend),
        eq(socialProfiles.network, post.platform)
      );
  const resolvedProfile = await db.query.socialProfiles.findFirst({
    where: profileWhere,
    orderBy: [desc(socialProfiles.lastSyncedAt)],
    columns: {
      publisherProfileId: true,
      displayName: true,
      lastSyncedAt: true,
    },
  });

  const mediaUrls = asStringArray(post.mediaUrls);
  const links = asStringArray(post.links);
  const status = post.status as ScheduledPostStatus;
  const errorDetail = post.publisherErrorDetail as Record<string, unknown> | null;

  return (
    <main
      id="main"
      className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10 space-y-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/outbox"
          className="inline-flex items-center gap-1 rounded-md min-h-11 px-2 -ml-2 text-sm text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-slate-400 dark:hover:text-slate-50"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          <span>Back to triage</span>
        </Link>
        <SignOutButton />
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          <Badge tone="slate">{platformLabel(post.platform)}</Badge>
          <Badge tone="muted">{post.source}</Badge>
        </div>
        <dl className="grid grid-cols-1 gap-y-3 sm:grid-cols-2 sm:gap-x-6 text-sm">
          <DetailItem
            label="Scheduled for"
            value={
              <time dateTime={post.scheduledAt.toISOString()}>
                {formatScheduledTime(post.scheduledAt)}
              </time>
            }
          />
          <DetailItem
            label="Publisher"
            value={
              <span className="font-mono text-xs">{post.publisherBackend}</span>
            }
          />
          {post.submittedAt ? (
            <DetailItem
              label="Submitted"
              value={
                <time dateTime={post.submittedAt.toISOString()}>
                  {formatScheduledTime(post.submittedAt)}
                </time>
              }
            />
          ) : null}
          {post.postedAt ? (
            <DetailItem
              label="Posted"
              value={
                <time dateTime={post.postedAt.toISOString()}>
                  {formatScheduledTime(post.postedAt)}
                </time>
              }
            />
          ) : null}
          {post.publisherPostId ? (
            <DetailItem
              label="Publisher post id"
              value={
                <span className="font-mono text-xs break-all">
                  {post.publisherPostId}
                </span>
              }
            />
          ) : null}
          <DetailItem
            label="Draft id"
            value={
              <span className="font-mono text-xs break-all">{post.draftId}</span>
            }
          />
          <DetailItem
            label="Resolved profile"
            value={
              resolvedProfile ? (
                <span className="text-xs">
                  {resolvedProfile.displayName ?? "(unnamed)"}
                  <span className="block font-mono text-[11px] text-slate-500 dark:text-slate-400 break-all">
                    {resolvedProfile.publisherProfileId}
                  </span>
                </span>
              ) : (
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  none — sync profiles or connect this network in the
                  workspace
                </span>
              )
            }
          />
        </dl>
      </section>

      <section
        aria-labelledby="actions-heading"
        className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 space-y-3"
      >
        <h2 id="actions-heading" className="text-base font-medium">
          Actions
        </h2>
        <PostActions
          postId={post.id}
          status={status}
          hasPublisherPostId={Boolean(post.publisherPostId)}
          scheduledAtIso={post.scheduledAt.toISOString()}
        />
      </section>

      <section
        aria-labelledby="caption-heading"
        className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 space-y-3"
      >
        <h2 id="caption-heading" className="text-base font-medium">
          Caption
        </h2>
        <p className="whitespace-pre-wrap break-words text-sm text-slate-900 dark:text-slate-50">
          {post.caption}
        </p>
      </section>

      {mediaUrls.length > 0 ? (
        <section
          aria-labelledby="media-heading"
          className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 space-y-3"
        >
          <h2 id="media-heading" className="text-base font-medium">
            Media ({mediaUrls.length})
          </h2>
          <ul className="space-y-2">
            {mediaUrls.map((url) => (
              <li key={url} className="text-sm">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-start gap-1 break-all text-violet-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-violet-400"
                >
                  <ExternalLink
                    className="size-4 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>{url}</span>
                  <span className="sr-only"> (opens in new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {links.length > 0 ? (
        <section
          aria-labelledby="links-heading"
          className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 space-y-3"
        >
          <h2 id="links-heading" className="text-base font-medium">
            Links ({links.length})
          </h2>
          <ul className="space-y-2">
            {links.map((url) => (
              <li key={url} className="text-sm">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-start gap-1 break-all text-violet-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-violet-400"
                >
                  <ExternalLink
                    className="size-4 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>{url}</span>
                  <span className="sr-only"> (opens in new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {errorDetail ? (
        <section
          aria-labelledby="error-heading"
          className="rounded-lg border border-red-200 bg-red-50 p-5 sm:p-6 dark:border-red-800 dark:bg-red-900/40 space-y-3"
        >
          <h2
            id="error-heading"
            className="text-base font-medium text-red-900 dark:text-red-100"
          >
            Error detail
          </h2>
          <pre className="overflow-x-auto rounded bg-white/60 dark:bg-black/40 p-3 text-xs text-red-900 dark:text-red-100">
            {JSON.stringify(errorDetail, null, 2)}
          </pre>
        </section>
      ) : null}

      <section
        aria-labelledby="attempts-heading"
        className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 space-y-3"
      >
        <h2 id="attempts-heading" className="text-base font-medium">
          Publish attempts ({attempts.length})
        </h2>
        {attempts.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No attempts logged yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {attempts.map((a) => (
              <li
                key={a.id}
                className="py-3 first:pt-0 last:pb-0 text-sm space-y-1"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={a.ok ? "emerald" : "red"}>
                    {a.ok ? "Success" : "Failure"}
                  </Badge>
                  {a.httpStatus !== null ? (
                    <Badge tone="muted">HTTP {a.httpStatus}</Badge>
                  ) : null}
                  <time
                    dateTime={a.attemptedAt.toISOString()}
                    className="ml-auto text-xs text-slate-500 dark:text-slate-400"
                  >
                    {formatScheduledTime(a.attemptedAt)}
                  </time>
                </div>
                {a.detail ? (
                  <p className="break-words text-xs text-slate-600 dark:text-slate-400">
                    {a.detail}
                  </p>
                ) : null}
                {a.externalId ? (
                  <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 break-all">
                    {a.externalId}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

    </main>
  );
}

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd className="text-slate-900 dark:text-slate-50">{value}</dd>
    </div>
  );
}
