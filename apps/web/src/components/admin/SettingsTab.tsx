"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Group {
  id: string;
  name: string;
  slug: string;
  is_default: boolean;
}

export function SettingsTab() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [newGroup, setNewGroup] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<{ groups: Group[] }>("/api/admin/visibility-groups");
    setGroups(res.groups);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/admin/visibility-groups", {
        method: "POST",
        body: JSON.stringify({ name: newGroup }),
      });
      setNewGroup("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    }
  }

  async function remove(id: string) {
    try {
      await apiFetch(`/api/admin/visibility-groups/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function openBilling() {
    try {
      const { url } = await apiFetch<{ url: string }>("/api/billing/portal", {
        method: "POST",
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Billing unavailable");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Visibility groups</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={create} className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label>New group name</Label>
              <Input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
            </div>
            <Button type="submit">Create</Button>
          </form>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <ul className="divide-y">
            {groups.map((g) => (
              <li key={g.id} className="flex items-center justify-between py-2 text-sm">
                <span className="flex items-center gap-2">
                  {g.name}
                  {g.is_default && <Badge variant="muted">default</Badge>}
                </span>
                {!g.is_default && (
                  <Button size="sm" variant="ghost" onClick={() => remove(g.id)}>
                    Delete
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Billing</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={openBilling}>
            Manage billing
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
