"use client";

/**
 * Boards are scoped per browser session — no accounts. The session id is a
 * UUID persisted in localStorage and shared by the UI and the WebMCP tools,
 * so a human and their agent always operate on the same board.
 */
const SESSION_KEY = "fieldward:session";

export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(SESSION_KEY);
  if (id === null || id.length === 0) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}
