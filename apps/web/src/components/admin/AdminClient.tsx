"use client";

import { useState } from "react";
import Link from "next/link";
import { OverviewTab } from "./OverviewTab";
import { ConnectorsTab } from "./ConnectorsTab";
import { KnowledgeGapsTab } from "./KnowledgeGapsTab";
import { ContentHealthTab } from "./ContentHealthTab";
import { TeamTab } from "./TeamTab";
import { SettingsTab } from "./SettingsTab";

type Tab =
  | "overview"
  | "connectors"
  | "knowledge-gaps"
  | "content-health"
  | "team"
  | "settings";

const TABS: { id: Tab; label: string; adminOnly?: boolean }[] = [
  { id: "overview", label: "Overview", adminOnly: true },
  { id: "connectors", label: "Connectors", adminOnly: true },
  { id: "knowledge-gaps", label: "Knowledge Gaps" },
  { id: "content-health", label: "Content Health" },
  { id: "team", label: "Team", adminOnly: true },
  { id: "settings", label: "Settings", adminOnly: true },
];

export function AdminClient({ orgName, role }: { orgName: string; role: string }) {
  const visibleTabs = TABS.filter((t) => !t.adminOnly || role === "admin");
  const [tab, setTab] = useState<Tab>(visibleTabs[0]?.id ?? "knowledge-gaps");

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold">{orgName}</h1>
            <p className="text-sm text-gray-500">Admin dashboard</p>
          </div>
          <Link href="/chat" className="text-sm text-brand hover:underline">
            ← Back to chat
          </Link>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 px-6">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`border-b-2 px-4 py-2 text-sm ${
                tab === t.id
                  ? "border-brand font-medium text-brand"
                  : "border-transparent text-gray-500 hover:text-gray-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl p-6">
        {tab === "overview" && <OverviewTab />}
        {tab === "connectors" && <ConnectorsTab />}
        {tab === "knowledge-gaps" && <KnowledgeGapsTab />}
        {tab === "content-health" && <ContentHealthTab />}
        {tab === "team" && <TeamTab />}
        {tab === "settings" && <SettingsTab />}
      </main>
    </div>
  );
}
