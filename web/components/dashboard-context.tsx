"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface ProjectInfo {
  repo_full_name: string;
  installation_id?: number | null;
  default_branch?: string;
  settings?: any;
  created_at?: string;
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
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        if (data.projects && Array.isArray(data.projects)) {
          setProjects(data.projects);
          setActiveRepoState((prev) => {
            if (prev && data.projects.some((p: ProjectInfo) => p.repo_full_name === prev)) {
              return prev;
            }
            if (typeof window !== "undefined") {
              try {
                const stored = localStorage.getItem("autoqa_active_repo");
                if (stored && data.projects.some((p: ProjectInfo) => p.repo_full_name === stored)) {
                  return stored;
                }
              } catch {}
            }
            return data.projects[0]?.repo_full_name || null;
          });
        }
      }
    } catch {
      // Ignore network errors on background poll
    } finally {
      setIsLoadingProjects(false);
    }
  }, []);

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
