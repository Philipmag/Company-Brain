"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";

interface Doc {
  id: string;
  title: string | null;
  source_type: string;
  source_url: string | null;
  last_verified_at: string | null;
  citation_count_30d: number;
}

export function ContentHealthTab() {
  const [docs, setDocs] = useState<Doc[]>([]);

  const load = useCallback(async () => {
    const res = await apiFetch<{ documents: Doc[] }>("/api/admin/content-health");
    setDocs(res.documents);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  async function verify(id: string) {
    await apiFetch(`/api/documents/${id}/verify`, { method: "PATCH" });
    await load();
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-gray-500">
          <th className="py-2">Document</th>
          <th className="py-2">Last verified</th>
          <th className="py-2">Citations (30d)</th>
          <th className="py-2">Action</th>
        </tr>
      </thead>
      <tbody>
        {docs.map((d) => (
          <tr key={d.id} className="border-b">
            <td className="py-2 pr-4">{d.title ?? "Untitled"}</td>
            <td className="py-2">
              {d.last_verified_at
                ? new Date(d.last_verified_at).toLocaleDateString()
                : "never"}
            </td>
            <td className="py-2">{d.citation_count_30d}</td>
            <td className="space-x-2 py-2">
              <Button size="sm" variant="outline" onClick={() => verify(d.id)}>
                Mark verified
              </Button>
              {d.source_url && (
                <a
                  href={d.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-brand hover:underline"
                >
                  Open source
                </a>
              )}
            </td>
          </tr>
        ))}
        {docs.length === 0 && (
          <tr>
            <td colSpan={4} className="py-6 text-center text-gray-500">
              Nothing needs attention. 🎉
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
