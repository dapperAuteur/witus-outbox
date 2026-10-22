import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // lib/analytics/posthog-provider.tsx is a byte-for-byte copy of witus-online's file
  // (INTEGRATE.md step 3: "Copy unchanged"), enforced by the ecosystem conformance
  // checker. Its setReady(true) in the init effect is intentional and runs once; the
  // canonical repo has no ESLint config, so this rule never fires there. Scoped to the
  // one file so the rule still guards everything we own.
  {
    files: ["lib/analytics/posthog-provider.tsx"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
