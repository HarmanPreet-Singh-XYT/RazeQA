"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Save, Trash2, Users } from "lucide-react";
import { Card, ErrorBanner } from "./notification-shared";

/**
 * Team recipients — the primary source the engine resolves when deciding who to
 * email. Members are scoped to a GitHub organization derived from the caller's
 * imported projects, so a user can only manage organizations they belong to.
 */

interface Member {
  id: string;
  org_login?: string;
  email?: string | null;
  role?: string | null;
  github_login?: string | null;
  seat_assigned?: boolean | null;
}

const ROLES = ["admin", "manager", "member"];

function roleLabel(role: string | null | undefined): string {
  if (!role) return "Member";
  return role[0].toUpperCase() + role.slice(1);
}

function MemberRow({
  member,
  onChanged,
  onRemoved,
}: {
  member: Member;
  onChanged: (member: Member) => void;
  onRemoved: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(member.email || "");
  const [githubLogin, setGithubLogin] = useState(member.github_login || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/team-members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: member.id, email, github_login: githubLogin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Could not save (HTTP ${res.status}).`);
        return;
      }
      onChanged(data.member);
      setEditing(false);
    } catch {
      setError("Could not reach the AutoQA server.");
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (role: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/team-members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: member.id, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Could not update role (HTTP ${res.status}).`);
        return;
      }
      onChanged(data.member);
    } catch {
      setError("Could not reach the AutoQA server.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/team-members?id=${encodeURIComponent(member.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `Could not remove (HTTP ${res.status}).`);
        return;
      }
      onRemoved(member.id);
    } catch {
      setError("Could not reach the AutoQA server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-2.5 border-b border-slate-100 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {editing ? (
            <div className="space-y-1.5">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
              />
              <input
                type="text"
                value={githubLogin}
                onChange={(e) => setGithubLogin(e.target.value)}
                placeholder="GitHub login (optional)"
                className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
              />
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-800 truncate">{member.email || "—"}</p>
              {member.github_login && (
                <p className="text-[11px] text-slate-400 truncate">@{member.github_login}</p>
              )}
            </>
          )}
          {error && <p className="text-[11px] text-rose-600 mt-1">{error}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <select
            value={member.role || "member"}
            onChange={(e) => changeRole(e.target.value)}
            disabled={busy}
            className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 cursor-pointer disabled:opacity-50"
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </select>
          {editing ? (
            <>
              <button
                onClick={save}
                disabled={busy}
                className="p-1 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-100 disabled:opacity-50"
                title="Save"
              >
                {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setEmail(member.email || "");
                  setGithubLogin(member.github_login || "");
                  setError(null);
                }}
                className="text-[11px] text-slate-500 hover:text-slate-800 px-1"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="text-[11px] text-slate-500 hover:text-slate-900 px-1"
            >
              Edit
            </button>
          )}
          <button
            onClick={remove}
            disabled={busy}
            className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 disabled:opacity-50"
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function TeamPanel() {
  const [orgs, setOrgs] = useState<string[]>([]);
  const [org, setOrg] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migrationRequired, setMigrationRequired] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("member");
  const [newGithub, setNewGithub] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async (targetOrg?: string) => {
    setLoading(true);
    setError(null);
    try {
      const query = targetOrg ? `?org=${encodeURIComponent(targetOrg)}` : "";
      const res = await fetch(`/api/team-members${query}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Could not load team members (HTTP ${res.status}).`);
        return;
      }
      if (data?.migration_required) setMigrationRequired(true);
      setOrgs(data.orgs || []);
      setMembers(data.members || []);
      if (!targetOrg && (data.orgs || []).length > 0) setOrg(data.orgs[0]);
    } catch {
      setError("Could not reach the AutoQA server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const switchOrg = (next: string) => {
    setOrg(next);
    setMembers([]);
    void load(next);
  };

  const add = async () => {
    if (!org || !newEmail.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/team-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org,
          email: newEmail.trim(),
          role: newRole,
          github_login: newGithub.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Could not add member (HTTP ${res.status}).`);
        return;
      }
      setNewEmail("");
      setNewGithub("");
      setNewRole("member");
      await load(org);
    } catch {
      setError("Could not reach the AutoQA server.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={org}
          onChange={(e) => switchOrg(e.target.value)}
          disabled={orgs.length === 0}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 cursor-pointer min-w-[220px] disabled:opacity-50"
        >
          {orgs.length === 0 && <option value="">No organization found</option>}
          {orgs.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <button
          onClick={() => load(org || undefined)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && <ErrorBanner message={error} />}
      {migrationRequired && (
        <ErrorBanner message="Apply supabase/migrations/20260913000000_pr_centric_model.sql before managing team members." />
      )}

      {orgs.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
          <Users className="h-4 w-4 mx-auto mb-2 text-slate-400" />
          No GitHub organization found. Install the AutoQA GitHub App on an organization and import a
          repository, then its members can be managed here.
        </p>
      ) : (
        <>
          <Card
            title={`Team members${org ? ` · ${org}` : ""}`}
            description="These people are emailed when a notification fires for a repository in this organization."
          >
            {members.length === 0 ? (
              <p className="text-[11px] text-slate-400">
                No members yet. Until one is added, notifications fall back to each project&apos;s owner.
              </p>
            ) : (
              <div>
                {members.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    onChanged={(updated) =>
                      setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
                    }
                    onRemoved={(id) => setMembers((prev) => prev.filter((m) => m.id !== id))}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card title="Add a member">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[220px]">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="dev@example.com"
                  className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div className="min-w-[150px]">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  GitHub login (optional)
                </label>
                <input
                  type="text"
                  value={newGithub}
                  onChange={(e) => setNewGithub(e.target.value)}
                  placeholder="octocat"
                  className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs cursor-pointer"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel(role)}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={add}
                disabled={adding || !newEmail.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {adding ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Add
              </button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
