import { redirect } from "next/navigation";
import { getAuthUserId, getSession } from "@/lib/auth";
import { ChatClient } from "@/components/chat/ChatClient";

export default async function ChatPage() {
  const authUserId = await getAuthUserId();
  if (!authUserId) redirect("/login");
  const session = await getSession();
  if (!session) redirect("/onboarding/create-org");

  return (
    <ChatClient
      orgName={session.org.name}
      userRole={session.user.role}
      displayName={session.user.display_name ?? session.user.email}
    />
  );
}
