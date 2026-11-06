import Link from "next/link";

// Error pages keep the app shell (witus docs/shared-ui-ux-dx.md): this renders inside the root
// layout, so the header (with Sign in) and the footer stay on the 404 page.
export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-base opacity-80">That page does not exist or has moved.</p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
      >
        Back to home
      </Link>
    </main>
  );
}
