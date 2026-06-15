import { redirect } from "next/navigation";
import { getAuthUserId, getSession } from "@/lib/auth";

export default async function Home() {
  const authUserId = await getAuthUserId();
  if (!authUserId) redirect("/login");

  const session = await getSession();
  if (!session) redirect("/onboarding/create-org");

  redirect("/chat");
}
