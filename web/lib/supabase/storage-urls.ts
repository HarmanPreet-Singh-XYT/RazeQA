import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Mirrors agent/src/agent/db/storage.py's DEFAULT_BUCKET / SIGNED_URL_EXPIRY_S.
 * Forensic run artifacts (video/trace) live in a private bucket, so every URL
 * handed to a client is a signed URL that expires — 1 hour after issue. A run
 * viewed later than that gets back a dead link unless it's re-signed on read.
 */
const ARTIFACT_BUCKET = "run-artifacts";
const SIGNED_URL_EXPIRES_IN = 3600;

/**
 * Extracts the storage object path (e.g. "runs/run_123/video/x.webm") out of
 * a previously-issued signed URL for the run-artifacts bucket. Supabase signs
 * URLs shaped like ".../storage/v1/object/sign/<bucket>/<path>?token=...";
 * only the full signed URL is persisted on the run row, so refreshing an
 * expired one means parsing the path back out of it.
 */
function objectPathFromSignedUrl(signedUrl: string): string | null {
  const marker = `/object/sign/${ARTIFACT_BUCKET}/`;
  const idx = signedUrl.indexOf(marker);
  if (idx === -1) return null;
  const pathAndQuery = signedUrl.slice(idx + marker.length);
  const path = pathAndQuery.split("?", 1)[0];
  return path || null;
}

/**
 * Re-signs a Supabase Storage URL so links stay live past their original
 * signature. Returns the original URL unchanged for anything that isn't one
 * of our signed URLs, or if re-signing fails for any reason (bucket
 * unreachable, object deleted by retention, etc) — a stale-but-present link
 * is a better failure mode than throwing and breaking the whole page.
 */
export async function refreshSignedArtifactUrl(
  admin: SupabaseClient,
  url: string | null | undefined
): Promise<string | null> {
  if (!url || !url.startsWith("http") || !url.includes("/object/sign/")) {
    return url ?? null;
  }
  const objectPath = objectPathFromSignedUrl(url);
  if (!objectPath) return url;

  try {
    const { data, error } = await admin.storage
      .from(ARTIFACT_BUCKET)
      .createSignedUrl(objectPath, SIGNED_URL_EXPIRES_IN);
    if (error || !data?.signedUrl) return url;
    return data.signedUrl;
  } catch {
    return url;
  }
}

/** Re-signs the video_url/trace_url fields on a run-shaped object in place. */
export async function refreshRunArtifactUrls<
  T extends { video_url?: string | null; trace_url?: string | null }
>(admin: SupabaseClient, run: T): Promise<T> {
  const [video_url, trace_url] = await Promise.all([
    refreshSignedArtifactUrl(admin, run.video_url),
    refreshSignedArtifactUrl(admin, run.trace_url),
  ]);
  return { ...run, video_url, trace_url };
}
