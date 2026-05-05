import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ArrowLeft } from "lucide-react";
import { getAuthOptions } from "@/lib/auth";
import { Composer } from "@/components/Composer";
import { SignOutButton } from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

export default async function ComposePage() {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.email) {
    redirect("/auth/sign-in?callbackUrl=/outbox/compose");
  }

  // Default scheduled-at: 1 hour from now. Operator usually edits this;
  // it's just a non-empty starting value.
  const defaultScheduledAt = new Date(Date.now() + 60 * 60_000);

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

      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-violet-600 dark:text-violet-400">
          WitUS Outbox
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Compose</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Create a post directly inside outbox. One click → one row per
          selected platform. Save as <strong>draft</strong> for later
          scheduling, or <strong>submit now</strong> to fire the publisher
          pipeline immediately. Rows are tagged{" "}
          <code className="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5 text-xs">
            outbox-composer
          </code>{" "}
          — filter at <code className="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5 text-xs">/outbox?source=outbox-composer</code>.
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        <Composer defaultScheduledAtIso={defaultScheduledAt.toISOString()} />
      </section>
    </main>
  );
}
