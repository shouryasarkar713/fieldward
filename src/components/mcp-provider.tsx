"use client";

import { useEffect } from "react";

import { useBoardStore } from "@/lib/board-store";
import { useBriefStore } from "@/lib/brief-store";
import { FIELDWARD_TOOL_NAMES, registerFieldwardTools, unregisterFieldwardTools } from "@/lib/mcp-tools";
import { useMcpStatusStore } from "@/lib/mcp-status";

/**
 * Mounts once at the root of the app and:
 *
 * 1. Initializes the board and brief stores (session id, polling, live
 *    refresh).
 * 2. Registers the Fieldward WebMCP tools with the raw
 *    `document.modelContext.registerTool(...)` API when the browser exposes
 *    a model context. Browsers without WebMCP simply get no tools — the
 *    board works fully for humans either way.
 * 3. Unregisters each tool individually on unmount.
 *
 * Some runtimes attach `document.modelContext` after page load (e.g. injected
 * extensions), so the provider retries for a short window instead of giving
 * up on the first miss. It also listens for a `fieldward:mcp-ready` event,
 * which external test harnesses can dispatch after installing a mock context.
 */
export function McpProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    useBoardStore.getState().init();
    useBriefStore.getState().init();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let registered = false;
    const status = useMcpStatusStore.getState();

    const attemptRegistration = async () => {
      if (registered || cancelled) return;
      const modelContext = typeof document !== "undefined" ? document.modelContext : undefined;
      if (!modelContext) return false;

      registered = true;
      try {
        await registerFieldwardTools(modelContext);
        if (cancelled) {
          // Unmounted mid-registration — undo immediately.
          await unregisterFieldwardTools(modelContext);
          return true;
        }
        useMcpStatusStore.getState().setActive(FIELDWARD_TOOL_NAMES.length);
        console.log(
          `[fieldward:mcp] registered ${FIELDWARD_TOOL_NAMES.length} tools: ${FIELDWARD_TOOL_NAMES.join(", ")}`,
        );
        return true;
      } catch (error) {
        console.error("[fieldward:mcp] tool registration failed", error);
        useMcpStatusStore.getState().setUnavailable();
        return true;
      }
    };

    void attemptRegistration();

    // Retry briefly for late-attaching runtimes (max ~30s, every 2s).
    const poll = setInterval(() => {
      if (registered || cancelled) {
        clearInterval(poll);
        return;
      }
      void attemptRegistration().then((done) => {
        if (done) clearInterval(poll);
      });
    }, 2000);
    const stopPolling = setTimeout(() => {
      clearInterval(poll);
      if (!registered && !cancelled) {
        useMcpStatusStore.getState().setUnavailable();
      }
    }, 30_000);

    const onReady = () => {
      void attemptRegistration().then((done) => {
        if (done) clearInterval(poll);
      });
    };
    window.addEventListener("fieldward:mcp-ready", onReady);

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearTimeout(stopPolling);
      window.removeEventListener("fieldward:mcp-ready", onReady);
      const modelContext = typeof document !== "undefined" ? document.modelContext : undefined;
      if (modelContext && registered) {
        // Unregister each tool individually — the raw WebMCP API has no
        // bulk-unregister convenience.
        void unregisterFieldwardTools(modelContext);
      }
    };
  }, []);

  return <>{children}</>;
}
