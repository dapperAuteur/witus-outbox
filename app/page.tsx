import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSession(getAuthOptions());
  if (session?.user?.email) {
    redirect("/outbox");
  }
  redirect("/auth/sign-in");
}
