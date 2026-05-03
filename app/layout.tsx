import type { ReactNode } from "react";

export const metadata = {
  title: "WitUS Outbox",
  description:
    "Single-operator outbound publishing service for the WitUS ecosystem.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
