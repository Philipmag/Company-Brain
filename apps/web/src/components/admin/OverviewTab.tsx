"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Stats {
  documentsIndexed: number;
  totalChunks: number;
  questions7d: number;
  connectors: Array<{
    id: string;
    provider: string;
    status: string;
    last_synced_at: string | null;
    display_name: string | null;
  }>;
}

export function OverviewTab() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    apiFetch<Stats>("/api/admin/stats").then(setStats).catch(() => setStats(null));
  }, []);

  if (!stats) return <p className="text-sm text-gray-500">Loading…</p>;

  const cards = [
    { label: "Documents indexed", value: stats.documentsIndexed },
    { label: "Total chunks", value: stats.totalChunks },
    { label: "Questions (7 days)", value: stats.questions7d },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader>
              <CardTitle className="text-3xl">{c.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">{c.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connectors</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {stats.connectors.length === 0 && (
            <p className="text-sm text-gray-500">No connectors yet.</p>
          )}
          {stats.connectors.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm">
              <span>{c.display_name ?? c.provider}</span>
              <span className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    c.status === "active"
                      ? "bg-green-500"
                      : c.status === "error"
                        ? "bg-red-500"
                        : "bg-amber-400"
                  }`}
                />
                {c.status}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
