"use client";

import Link from "next/link";

// Route error boundary. Error pages keep the app shell (witus docs/shared-ui-ux-dx.md): this
// renders inside the root layout, so the header (with Sign in) and the footer stay. No error text
// is shown; the digest is an opaque id the server logs carry.
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Something went wrong</h1>
      <p role="alert" className="text-base opacity-80">
        This page hit an unexpected error. Try again, or head back home.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center rounded-md border border-current px-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          Back to home
        </Link>
      </div>
      {error.digest ? <p className="text-xs opacity-70">Reference: {error.digest}</p> : null}
    </main>
  );
}
