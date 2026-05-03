"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => signOut({ callbackUrl: "/auth/sign-in" })}
      aria-label="Sign out"
    >
      <LogOut className="size-4" aria-hidden="true" />
      <span>Sign out</span>
    </Button>
  );
}
