import Link from "next/link";
import { getServerSession } from "next-auth";
import { SignOutButton } from "@/components/SignOutButton";

// The app header, mounted in the root layout so every page has it: the sign-in page, the outbox, the
// 404 and the route error boundary (witus docs/shared-ui-ux-dx.md, "Sign-in control" and "Error
// pages keep the app shell"). Signed out it shows a link whose accessible name is exactly "Sign in";
// signed in it shows the Triage link and the local "Sign out" (never renamed). Until this file the
// app had no header at all, only a footer (BAM, 2026-11-09: "out/in-box needs header").
//
// Server component: the session is read here so no client component has to carry a provider. The
// auth module is imported lazily inside the try: building its options validates env and opens the
// database client, and this header is in the root layout, so a missing variable (or an unreachable
// database) must render the signed-out header, not take the whole shell down with the page or fail
// the build of the static error pages.
const linkClasses =
  "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-50";

export async function SiteHeader() {
  let signedIn = false;
  try {
    const { getAuthOptions } = await import("@/lib/auth");
    const session = await getServerSession(getAuthOptions());
    signedIn = Boolean(session?.user?.email);
  } catch {
    signedIn = false;
  }

  return (
    <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-1 sm:px-6">
        <Link
          href={signedIn ? "/outbox" : "/"}
          className="inline-flex min-h-11 items-center rounded-md font-extrabold tracking-tight text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-slate-50"
        >
          WitUS <span className="text-violet-600 dark:text-violet-400">Outbox</span>
        </Link>
        <nav aria-label="Account" className="flex items-center gap-1">
          {signedIn ? (
            <>
              <Link href="/outbox" className={linkClasses}>
                Triage
              </Link>
              <SignOutButton />
            </>
          ) : (
            <Link href="/auth/sign-in" className={linkClasses}>
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
