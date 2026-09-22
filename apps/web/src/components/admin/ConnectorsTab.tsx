"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Connector {
  id: string;
  provider: string;
  display_name: string | null;
  status: string;
  last_synced_at: string | null;
  error_message: string | null;
}

export function ConnectorsTab() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<{ connectors: Connector[] }>("/api/admin/stats");
    // /api/admin/stats returns connectors with a subset; fetch detailed list via documents? Use stats.
    setConnectors(res.connectors as unknown as Connector[]);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  async function connect(provider: "google" | "slack") {
    const { url } = await apiFetch<{ url: string }>(
      `/api/connections/${provider}/start`,
      { method: "POST" },
    );
    window.location.href = url;
  }

  async function syncNow(id: string) {
    setBusy(id);
    try {
      await apiFetch(`/api/connections/${id}/sync`, { method: "POST" });
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(id: string) {
    setBusy(id);
    try {
      await apiFetch(`/api/connections/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ disconnect: true }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    setBusy("upload");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/documents/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Upload failed");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button onClick={() => connect("google")}>Connect Google Drive</Button>
        <Button variant="outline" onClick={() => connect("slack")}>
          Connect Slack
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload files</CardTitle>
        </CardHeader>
        <CardContent>
          <label
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-6 text-sm text-gray-500 hover:border-brand"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) void upload(file);
            }}
          >
            <span>{busy === "upload" ? "Uploading…" : "Drag a file here or click to upload"}</span>
            <input
              type="file"
              className="hidden"
              accept=".pdf,.docx,.txt,.md"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>
        </CardContent>
      </Card>

      {connectors.map((c) => (
        <Card key={c.id}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              {c.display_name ?? c.provider}
            </CardTitle>
            <Badge
              variant={
                c.status === "active"
                  ? "success"
                  : c.status === "error"
                    ? "error"
                    : "warning"
              }
            >
              {c.status}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-gray-600">
            <p>
              Last synced:{" "}
              {c.last_synced_at
                ? new Date(c.last_synced_at).toLocaleString()
                : "never"}
            </p>
            {c.error_message && <p className="text-red-600">{c.error_message}</p>}
            <div className="flex gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy === c.id}
                onClick={() => syncNow(c.id)}
              >
                Sync now
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy === c.id}
                onClick={() => disconnect(c.id)}
              >
                Disconnect
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      {connectors.length === 0 && (
        <p className="text-sm text-gray-500">No connectors yet.</p>
      )}
    </div>
  );
}
