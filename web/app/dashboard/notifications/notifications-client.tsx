"use client";

import React, { useState } from "react";
import { Bell, Globe, UserCog, Users, GitBranch } from "lucide-react";
import { RepositoryPanel } from "./repository-panel";
import { PreferencePanel } from "./preference-panel";
import { TeamPanel } from "./team-panel";

/**
 * Notification settings shell.
 *
 * Four scopes, four tabs:
 *   - Repositories    — per-repo overrides and the delivery log;
 *   - Global defaults — workspace policy for repos that have not overridden it;
 *   - My preferences  — this user's own subscription;
 *   - Team            — the organization's recipients.
 */

type Tab = "repositories" | "defaults" | "personal" | "team";

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "repositories", label: "Repositories", icon: GitBranch },
  { id: "defaults", label: "Global defaults", icon: Globe },
  { id: "personal", label: "My preferences", icon: UserCog },
  { id: "team", label: "Team", icon: Users },
];

export function NotificationsClient() {
  const [tab, setTab] = useState<Tab>("repositories");

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl mx-auto w-full text-slate-900 animate-in fade-in-50">
      <div className="space-y-1 pb-5 border-b border-slate-200">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
          <Bell className="h-5 w-5 text-slate-700" />
          Notifications
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 max-w-2xl leading-relaxed">
          Choose who is emailed when a verification, finding, review or fix needs attention — per
          repository, workspace-wide, for yourself, or for your GitHub organization&apos;s team.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-3">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {tab === "repositories" && <RepositoryPanel />}
      {tab === "defaults" && <PreferencePanel mode="defaults" />}
      {tab === "personal" && <PreferencePanel mode="personal" />}
      {tab === "team" && <TeamPanel />}
    </div>
  );
}
