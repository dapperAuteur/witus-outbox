"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const callbackUrl =
      new URLSearchParams(window.location.search).get("callbackUrl") ??
      "/outbox";
    const result = await signIn("email", {
      email,
      callbackUrl,
      redirect: false,
    });
    if (result?.error) {
      setPending(false);
      setError(
        "Could not start sign-in. Check the email address and try again."
      );
      return;
    }
    if (result?.url) {
      window.location.href = result.url;
      return;
    }
    window.location.href = "/auth/verify-request";
  }

  return (
    <main
      id="main"
      className="flex flex-1 items-center justify-center px-4 py-10"
    >
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-violet-600 dark:text-violet-400">
            WitUS Outbox
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Sign in
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Enter the admin email address. A single-use sign-in link will be
            emailed to you.
          </p>
        </header>

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="block text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
              aria-describedby={error ? "sign-in-error" : undefined}
              aria-invalid={error ? true : undefined}
            />
          </div>

          {error ? (
            <p
              id="sign-in-error"
              role="alert"
              className="text-sm text-red-600 dark:text-red-400"
            >
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            disabled={pending || email.length === 0}
            className="w-full"
          >
            {pending ? "Sending link…" : "Email me a sign-in link"}
          </Button>
        </form>
      </div>
    </main>
  );
}
