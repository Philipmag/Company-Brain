import { redirect } from "next/navigation";
import { getAuthUserId, getSession } from "@/lib/auth";
import { AdminClient } from "@/components/admin/AdminClient";

export default async function AdminPage() {
  const authUserId = await getAuthUserId();
  if (!authUserId) redirect("/login");
  const session = await getSession();
  if (!session) redirect("/onboarding/create-org");
  if (session.user.role === "member") redirect("/chat");

  return <AdminClient orgName={session.org.name} role={session.user.role} />;
}
