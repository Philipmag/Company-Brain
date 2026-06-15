"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";

interface Group {
  id: string;
  name: string;
}

export function CuratedAnswerModal({
  initialQuestion = "",
  questionEditable = true,
  gapId,
  onClose,
  onSaved,
}: {
  initialQuestion?: string;
  questionEditable?: boolean;
  gapId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [answer, setAnswer] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ groups: Group[] }>("/api/admin/visibility-groups")
      .then((res) => setGroups(res.groups))
      .catch(() => undefined);
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/admin/curated-answers", {
        method: "POST",
        body: JSON.stringify({
          question,
          answer,
          visibility_group_ids: [...selected],
          gapId,
        }),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">Curated answer</h2>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Question</Label>
            <Input
              value={question}
              disabled={!questionEditable}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Answer</Label>
            <Textarea
              rows={6}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Write the verified answer your team should see…"
            />
          </div>
          <div className="space-y-1">
            <Label>Visibility groups</Label>
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <label key={g.id} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(g.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(g.id);
                      else next.delete(g.id);
                      setSelected(next);
                    }}
                  />
                  {g.name}
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-400">
              Leave empty to default to the org&apos;s default group.
            </p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !answer.trim()}>
              {saving ? "Saving…" : "Save answer"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
