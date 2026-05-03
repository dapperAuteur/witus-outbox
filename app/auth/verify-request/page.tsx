export default function VerifyRequestPage() {
  return (
    <main
      id="main"
      className="flex flex-1 items-center justify-center px-4 py-10"
    >
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Check your email
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          A single-use sign-in link is on its way. Open it on the same device
          to finish signing in.
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-500">
          The link expires in a few minutes. If it doesn&rsquo;t arrive, check
          spam, then{" "}
          <a
            href="/auth/sign-in"
            className="rounded underline underline-offset-4 hover:text-violet-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
          >
            request a new one
          </a>
          .
        </p>
      </div>
    </main>
  );
}
