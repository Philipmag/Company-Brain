"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

interface Member {
  id: string;
  email: string;
  display_name: string | null;
  role: "admin" | "curator" | "member";
  visibility_group_ids: string[];
}

interface Group {
  id: string;
  name: string;
}

export function TeamTab() {
  const [members, setMembers] = useState<Member[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [u, g] = await Promise.all([
      apiFetch<{ users: Member[] }>("/api/admin/users"),
      apiFetch<{ groups: Group[] }>("/api/admin/visibility-groups"),
    ]);
    setMembers(u.users);
    setGroups(g.groups);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/admin/users/invite", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setEmail("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    }
  }

  async function updateRole(id: string, newRole: string) {
    await apiFetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ role: newRole }),
    });
    await load();
  }

  async function toggleGroup(member: Member, groupId: string) {
    const set = new Set(member.visibility_group_ids);
    if (set.has(groupId)) set.delete(groupId);
    else set.add(groupId);
    await apiFetch(`/api/admin/users/${member.id}`, {
      method: "PATCH",
      body: JSON.stringify({ visibility_group_ids: [...set] }),
    });
    await load();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={invite} className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label>Invite by email</Label>
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <select
          className="h-9 rounded-md border border-gray-300 px-2 text-sm"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="member">Member</option>
          <option value="curator">Curator</option>
          <option value="admin">Admin</option>
        </select>
        <Button type="submit">Invite</Button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-2">Email</th>
            <th className="py-2">Role</th>
            <th className="py-2">Visibility groups</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className="border-b align-top">
              <td className="py-2 pr-4">{m.email}</td>
              <td className="py-2">
                <select
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                  value={m.role}
                  onChange={(e) => updateRole(m.id, e.target.value)}
                >
                  <option value="member">member</option>
                  <option value="curator">curator</option>
                  <option value="admin">admin</option>
                </select>
              </td>
              <td className="py-2">
                <div className="flex flex-wrap gap-2">
                  {groups.map((g) => (
                    <label key={g.id} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={m.visibility_group_ids.includes(g.id)}
                        onChange={() => toggleGroup(m, g.id)}
                      />
                      {g.name}
                    </label>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
