import { cookies } from "next/headers";

const SESSION_COOKIE = "session";

/**
 * Seeded test account for the sandbox login flow. Deliberately not real
 * auth — the platform's login step (Section 3.3 of idea.md) authenticates
 * against exactly this account inside the Docker sandbox.
 */
export function getTestUser() {
  const email = process.env.TEST_USER_EMAIL ?? "qa@example.com";
  const password = process.env.TEST_USER_PASSWORD ?? "changeme123";
  return { email, password };
}

export async function createSession(email: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, email, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession() {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}
