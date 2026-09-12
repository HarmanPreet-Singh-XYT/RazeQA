"use client";

import { useState, useCallback } from "react";

export type ApplyFixErrorType = "missing_api_key" | "backend_unreachable" | "generic" | null;

export interface ApplyFixState {
  isApplying: boolean;
  isSuccess: boolean;
  error: string | null;
  errorType: ApplyFixErrorType;
}

export function useApplyFix(runId: string, onApplied?: () => void) {
  const [state, setState] = useState<ApplyFixState>({
    isApplying: false,
    isSuccess: false,
    error: null,
    errorType: null,
  });

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null, errorType: null }));
  }, []);

  const applyFix = useCallback(async () => {
    if (!runId) return;

    setState({
      isApplying: true,
      isSuccess: false,
      error: null,
      errorType: null,
    });

    try {
      const res = await fetch(`/api/runs/${runId}/apply`, {
        method: "POST",
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setState({
          isApplying: false,
          isSuccess: true,
          error: null,
          errorType: null,
        });
        if (onApplied) onApplied();
      } else {
        const errorMsg = data.error || `Failed to apply fix (HTTP ${res.status}).`;
        let errType: ApplyFixErrorType = "generic";

        if (res.status === 503 || errorMsg.includes("AGENT_API_KEY")) {
          if (errorMsg.includes("AGENT_API_KEY")) {
            errType = "missing_api_key";
          } else {
            errType = "backend_unreachable";
          }
        }

        setState({
          isApplying: false,
          isSuccess: false,
          error: errorMsg,
          errorType: errType,
        });
      }
    } catch (err: any) {
      setState({
        isApplying: false,
        isSuccess: false,
        error: err?.message || "Network error while connecting to AutoQA Engine.",
        errorType: "backend_unreachable",
      });
    }
  }, [runId, onApplied]);

  return {
    ...state,
    applyFix,
    clearError,
  };
}
