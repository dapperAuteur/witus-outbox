import { witusSilentSsoEndpoint } from "@/lib/env";
import { SignInForm } from "@/components/SignInForm";

// Server component so the silent "Continue as <name>" probe endpoint is resolved from server env
// and handed down; a client component must never read WITUS_OIDC_* itself. The form below is
// still the same client component it always was.
//
// force-dynamic so the gate reflects the env of the RUNNING deployment rather than whatever was
// set when the page was prerendered at build time.
export const dynamic = "force-dynamic";

export default function SignInPage() {
  return <SignInForm silentCheckUrl={witusSilentSsoEndpoint()} />;
}
