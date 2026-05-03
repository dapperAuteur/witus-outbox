import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getAuthOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OutboxHome() {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.email) {
    redirect("/auth/sign-in?callbackUrl=/outbox");
  }

  return (
    <main
      id="main"
      className="flex flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12 mx-auto w-full max-w-2xl"
    >
      <header className="space-y-2 mb-8">
        <p className="text-xs uppercase tracking-wide text-violet-600 dark:text-violet-400">
          WitUS Outbox
        </p>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Signed in
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 break-words">
          {session.user.email}
        </p>
      </header>

      <section
        aria-labelledby="empty-state-heading"
        className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-3"
      >
        <h2
          id="empty-state-heading"
          className="text-base font-medium"
        >
          Triage UI coming next slice
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          The post list, status filters, and per-row actions (Retry / Reschedule / Cancel /
          Reconcile-now) land in the next branch. The HMAC-signed{" "}
          <code className="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5 text-xs">
            /api/ingest
          </code>{" "}
          endpoint is already accepting publish requests.
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Active publisher backend:{" "}
          <code className="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5 text-xs">
            ocoya
          </code>
          .
        </p>
      </section>
    </main>
  );
}
