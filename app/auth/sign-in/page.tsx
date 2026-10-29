import { isWitusOidcConfigured, witusSilentSsoEndpoint } from "@/lib/env";
import { authErrorNotice, errorCodeFromSearchParams } from "@/lib/auth-error";
import { SignInForm } from "@/components/SignInForm";

// Server component so everything that depends on env is resolved here and handed down; a client
// component must never read WITUS_OIDC_* itself. The form below is still the same client component
// it always was.
//
// "Sign in with WitUS" is shown when isWitusOidcConfigured() is true at REQUEST time. It used to
// hang off a build-time NEXT_PUBLIC_WITUS_SSO flag, and with that flag unset the button never
// appeared even on a configured deployment (BAM, 2026-10-29: "outbox doesn't have a sign in with
// WitUS button"). With no OIDC client the `witus` provider is not registered in lib/auth.ts, so a
// button would only lead to an error; it stays dark instead.
//
// This page is also where failed sign-ins land (`pages.error` in lib/auth.ts), so it reads the
// `?error=` code and shows a notice (lib/auth-error.ts).
//
// force-dynamic so the gate reflects the env of the RUNNING deployment rather than whatever was
// set when the page was prerendered at build time.
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const notice = authErrorNotice(errorCodeFromSearchParams(await searchParams));
  return (
    <SignInForm
      witusEnabled={isWitusOidcConfigured()}
      silentCheckUrl={witusSilentSsoEndpoint()}
      notice={notice}
    />
  );
}
