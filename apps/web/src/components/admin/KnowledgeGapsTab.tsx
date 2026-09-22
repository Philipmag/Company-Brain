"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CuratedAnswerModal } from "./CuratedAnswerModal";

interface Gap {
  id: string;
  question: string;
  frequency: number;
  status: "open" | "answered" | "dismissed";
  last_asked_at: string;
}

export function KnowledgeGapsTab() {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [modalGap, setModalGap] = useState<Gap | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<{ gaps: Gap[] }>("/api/admin/knowledge-gaps");
    setGaps(res.gaps);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  async function setStatus(id: string, status: Gap["status"]) {
    await apiFetch(`/api/admin/knowledge-gaps/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    await load();
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-2">Question</th>
            <th className="py-2">Frequency</th>
            <th className="py-2">Last asked</th>
            <th className="py-2">Status</th>
            <th className="py-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((g) => (
            <tr key={g.id} className="border-b">
              <td className="py-2 pr-4">{g.question}</td>
              <td className="py-2">{g.frequency}</td>
              <td className="py-2">{new Date(g.last_asked_at).toLocaleDateString()}</td>
              <td className="py-2">
                <Badge
                  variant={
                    g.status === "answered"
                      ? "success"
                      : g.status === "dismissed"
                        ? "muted"
                        : "warning"
                  }
                >
                  {g.status}
                </Badge>
              </td>
              <td className="space-x-2 py-2">
                <Button size="sm" variant="outline" onClick={() => setModalGap(g)}>
                  Write answer
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setStatus(g.id, "dismissed")}
                >
                  Dismiss
                </Button>
              </td>
            </tr>
          ))}
          {gaps.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-gray-500">
                No knowledge gaps yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {modalGap && (
        <CuratedAnswerModal
          initialQuestion={modalGap.question}
          questionEditable={false}
          gapId={modalGap.id}
          onClose={() => setModalGap(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
