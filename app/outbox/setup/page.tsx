import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { ArrowLeft } from "lucide-react";
import { getAuthOptions } from "@/lib/auth";
import { DefaultProfilesPanel } from "@/components/DefaultProfilesPanel";
import { OcoyaWorkspaceFetcher } from "@/components/OcoyaWorkspaceFetcher";
import { RadaarExportButton } from "@/components/RadaarExportButton";
import { SignOutButton } from "@/components/SignOutButton";
import { SocialChampExportButton } from "@/components/SocialChampExportButton";
import { SyncProfilesButton } from "@/components/SyncProfilesButton";

export const dynamic = "force-dynamic";

export default async function OutboxSetup() {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.email) {
    redirect("/auth/sign-in?callbackUrl=/outbox/setup");
  }

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
        <h1 className="text-2xl font-semibold tracking-tight">Setup</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          One-off bootstrap utilities. Use these to capture vendor IDs that
          can&rsquo;t be auto-injected by an integration.
        </p>
      </div>

      <OcoyaWorkspaceFetcher />

      <SyncProfilesButton />

      <DefaultProfilesPanel />

      <RadaarExportButton />

      <SocialChampExportButton />
    </main>
  );
}
