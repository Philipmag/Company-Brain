"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Step = "drive" | "slack" | "team";

const STEPS: { id: Step; label: string }[] = [
  { id: "drive", label: "Connect Google Drive" },
  { id: "slack", label: "Connect Slack" },
  { id: "team", label: "Invite your team" },
];

function Stepper({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="mb-8 flex items-center justify-center gap-2">
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
              i <= idx ? "bg-brand text-brand-fg" : "bg-gray-200 text-gray-500"
            }`}
          >
            {i + 1}
          </div>
          <span className={`text-sm ${i === idx ? "font-medium" : "text-gray-500"}`}>
            {s.label}
          </span>
          {i < STEPS.length - 1 && <span className="mx-2 text-gray-300">→</span>}
        </div>
      ))}
    </div>
  );
}

interface Folder {
  id: string;
  name: string;
  defaultSelected: boolean;
  sensitive: boolean;
}

function OnboardingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const step = (params.get("step") as Step) ?? "drive";
  const connectionId = params.get("connectionId");

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Welcome to Company Brain</h1>
      <p className="mb-6 text-gray-500">Let&apos;s connect your knowledge sources.</p>
      <Stepper current={step} />
      {step === "drive" && <DriveStep connectionId={connectionId} />}
      {step === "slack" && <SlackStep />}
      {step === "team" && <TeamStep onFinish={() => router.push("/chat")} />}
    </div>
  );
}

function DriveStep({ connectionId }: { connectionId: string | null }) {
  const router = useRouter();
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connectionId) return;
    apiFetch<{ folders: Folder[] }>(`/api/connections/${connectionId}/folders`)
      .then((res) => {
        setFolders(res.folders);
        setSelected(new Set(res.folders.filter((f) => f.defaultSelected).map((f) => f.id)));
      })
      .catch((e) => setError(e.message));
  }, [connectionId]);

  async function connect() {
    setLoading(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/connections/google/start", {
        method: "POST",
      });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start OAuth");
      setLoading(false);
    }
  }

  async function save() {
    if (!connectionId) return;
    setLoading(true);
    try {
      const all = folders ?? [];
      await apiFetch(`/api/connections/${connectionId}`, {
        method: "PATCH",
        body: JSON.stringify({
          scope_config: {
            included_folder_ids: [...selected],
            excluded_folder_ids: all.filter((f) => !selected.has(f.id)).map((f) => f.id),
          },
        }),
      });
      router.push("/onboarding?step=slack");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Drive</CardTitle>
        <CardDescription>
          Pick which folders to index. Sensitive-looking folders (HR, Payroll,
          Legal, Finance) are unchecked by default.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!connectionId && (
          <Button onClick={connect} disabled={loading}>
            {loading ? "Redirecting…" : "Connect Google Drive"}
          </Button>
        )}
        {connectionId && !folders && <p className="text-sm text-gray-500">Loading folders…</p>}
        {connectionId && folders && (
          <>
            <div className="max-h-80 space-y-1 overflow-auto rounded-md border p-2">
              {folders.length === 0 && (
                <p className="p-2 text-sm text-gray-500">No top-level folders found.</p>
              )}
              {folders.map((f) => (
                <label
                  key={f.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(f.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(f.id);
                      else next.delete(f.id);
                      setSelected(next);
                    }}
                  />
                  <span className="text-sm">{f.name}</span>
                  {f.sensitive && <Badge variant="warning">sensitive</Badge>}
                </label>
              ))}
            </div>
            <Button onClick={save} disabled={loading || selected.size === 0}>
              {loading ? "Saving…" : "Index selected folders & continue"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SlackStep() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const connected = params.get("connected") === "1";

  async function connect() {
    setLoading(true);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/connections/slack/start", {
        method: "POST",
      });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start OAuth");
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Slack</CardTitle>
        <CardDescription>
          Install the Company Brain Slack app to enable the <code>/ask</code> command.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {connected ? (
          <Badge variant="success">Slack connected</Badge>
        ) : (
          <Button onClick={connect} disabled={loading}>
            {loading ? "Redirecting…" : "Connect Slack"}
          </Button>
        )}
        <div>
          <Button variant="ghost" onClick={() => router.push("/onboarding?step=team")}>
            {connected ? "Continue" : "Skip for now"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TeamStep({ onFinish }: { onFinish: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [invited, setInvited] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/admin/users/invite", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setInvited((prev) => [...prev, email]);
      setEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invite failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite your team</CardTitle>
        <CardDescription>Send email invites and assign a role.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={invite} className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-role">Role</Label>
            <select
              id="invite-role"
              className="h-9 rounded-md border border-gray-300 px-2 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="member">Member</option>
              <option value="curator">Curator</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <Button type="submit" disabled={loading}>
            Invite
          </Button>
        </form>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {invited.length > 0 && (
          <ul className="text-sm text-gray-600">
            {invited.map((e) => (
              <li key={e}>✓ Invited {e}</li>
            ))}
          </ul>
        )}
        <Button onClick={onFinish} className="w-full">
          Finish &amp; go to chat
        </Button>
      </CardContent>
    </Card>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <OnboardingInner />
    </Suspense>
  );
}
