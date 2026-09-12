"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface ProjectInfo {
  repo_full_name: string;
  name?: string;
  type?: "git" | "external";
  target_url?: string;
  domain?: string | null;
  last_commit?: {
    message: string;
    sha?: string;
    date?: string;
    branch?: string;
  } | null;
  github_url?: string;
  status?: "passed" | "failed" | "running" | "ready";
  framework?: string;
  isStarred?: boolean;
  installation_id?: number | null;
  default_branch?: string;
  settings?: any;
  created_at?: string;
  updated_at?: string;
}

interface DashboardContextType {
  userEmail: string | null;
  activeRepo: string | null;
  setActiveRepo: (repo: string | null) => void;
  gitSha: string | null;
  setGitSha: (sha: string | null) => void;
  engineConnected: boolean;
  setEngineConnected: (connected: boolean) => void;
  projects: ProjectInfo[];
  setProjects: React.Dispatch<React.SetStateAction<ProjectInfo[]>>;
  refreshProjects: () => Promise<void>;
  addExternalProject: (targetUrl: string) => void;
  isLoadingProjects: boolean;
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export function DashboardProvider({
  children,
  userEmail,
  initialRepo = null,
}: {
  children: React.ReactNode;
  userEmail: string | null;
  initialRepo?: string | null;
}) {
  const [activeRepo, setActiveRepoState] = useState<string | null>(initialRepo);
  const [gitSha, setGitSha] = useState<string | null>(null);
  const [engineConnected, setEngineConnected] = useState<boolean>(false);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState<boolean>(true);

  const setActiveRepo = useCallback((repo: string | null) => {
    setActiveRepoState(repo);
    if (typeof window !== "undefined" && repo) {
      try {
        localStorage.setItem("autoqa_active_repo", repo);
      } catch {}
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const [projRes, runsRes] = await Promise.all([
        fetch("/api/projects").catch(() => null),
        fetch("/api/runs").catch(() => null),
      ]);

      const gitProjects: ProjectInfo[] = [];
      if (projRes && projRes.ok) {
        const data = await projRes.json();
        if (data.projects && Array.isArray(data.projects)) {
          for (const p of data.projects) {
            const repoName = p.repo_full_name.split("/")[1] || p.repo_full_name;
            gitProjects.push({
              repo_full_name: p.repo_full_name,
              name: repoName,
              type: "git",
              domain: p.settings?.domain || (p.settings?.port ? `http://localhost:${p.settings.port}` : null),
              last_commit: p.settings?.last_commit || null,
              github_url: `https://github.com/${p.repo_full_name}`,
              status: "ready",
              framework: p.settings?.framework || "nextjs",
              installation_id: p.installation_id,
              default_branch: p.default_branch || "main",
              settings: p.settings,
              created_at: p.created_at,
              updated_at: p.updated_at,
            });
          }
        }
      }

      // Discover external site projects from runs & local storage
      const externalMap = new Map<string, ProjectInfo>();

      // Check localStorage for external sites tested by user
      if (typeof window !== "undefined") {
        try {
          const stored = localStorage.getItem("autoqa_external_sites");
          if (stored) {
            const list: string[] = JSON.parse(stored);
            for (const u of list) {
              const cleanUrl = u.startsWith("http") ? u : `https://${u}`;
              const hostname = cleanUrl.replace(/^https?:\/\//, "").split("/")[0];
              externalMap.set(hostname, {
                repo_full_name: `external:${hostname}`,
                name: hostname,
                type: "external",
                target_url: cleanUrl,
                domain: cleanUrl,
                status: "ready",
                framework: "web",
                last_commit: {
                  message: `Verified external site`,
                  sha: "web",
                  date: "Active",
                },
              });
            }
          }
        } catch {}
      }

      // Check live runs for external sites
      if (runsRes && runsRes.ok) {
        const runsData = await runsRes.json();
        if (runsData.runs && Array.isArray(runsData.runs)) {
          for (const r of runsData.runs) {
            const isExternal = r.scope === "external" || r.branch?.startsWith("http") || r.sha?.startsWith("http");
            if (isExternal) {
              const rawUrl = r.sha?.startsWith("http")
                ? r.sha
                : r.branch?.replace("🌐 ", "") || r.result?.target_url || "https://example.com";
              const cleanUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
              const hostname = cleanUrl.replace(/^https?:\/\//, "").split("/")[0];

              const isPassed = r.status === "passed" || r.result?.status === "success";
              const existing = externalMap.get(hostname);

              externalMap.set(hostname, {
                repo_full_name: `external:${hostname}`,
                name: hostname,
                type: "external",
                target_url: cleanUrl,
                domain: cleanUrl,
                status: isPassed ? "passed" : r.status === "failed" ? "failed" : "ready",
                framework: "web",
                last_commit: {
                  message: r.result?.summary || `Verified external site (${isPassed ? "Passed" : "Failed"})`,
                  sha: "web",
                  date: r.created_at ? new Date(r.created_at).toLocaleDateString() : existing?.last_commit?.date || "Active",
                },
              });
            }
          }
        }
      }

      const allProjects = [...gitProjects, ...Array.from(externalMap.values())];
      setProjects(allProjects);

      setActiveRepoState((prev) => {
        if (prev && allProjects.some((p) => p.repo_full_name === prev)) {
          return prev;
        }
        if (typeof window !== "undefined") {
          try {
            const stored = localStorage.getItem("autoqa_active_repo");
            if (stored && allProjects.some((p) => p.repo_full_name === stored)) {
              return stored;
            }
          } catch {}
        }
        return allProjects[0]?.repo_full_name || null;
      });
    } catch {
      // Ignore network errors on background poll
    } finally {
      setIsLoadingProjects(false);
    }
  }, []);

  const addExternalProject = useCallback((targetUrl: string) => {
    try {
      const cleanUrl = targetUrl.trim().startsWith("http") ? targetUrl.trim() : `https://${targetUrl.trim()}`;
      const stored = localStorage.getItem("autoqa_external_sites");
      const list: string[] = stored ? JSON.parse(stored) : [];
      if (!list.includes(cleanUrl)) {
        list.push(cleanUrl);
        localStorage.setItem("autoqa_external_sites", JSON.stringify(list));
      }
      refreshProjects();
    } catch {}
  }, [refreshProjects]);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  return (
    <DashboardContext.Provider
      value={{
        userEmail,
        activeRepo,
        setActiveRepo,
        gitSha,
        setGitSha,
        engineConnected,
        setEngineConnected,
        projects,
        setProjects,
        refreshProjects,
        addExternalProject,
        isLoadingProjects,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboard must be used within a DashboardProvider");
  }
  return context;
}
