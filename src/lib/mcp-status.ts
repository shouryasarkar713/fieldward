"use client";

import { create } from "zustand";

/** Registration status of the WebMCP tool surface, shown as a header pill. */
export type McpStatus = "checking" | "active" | "unavailable";

type McpStatusState = {
  status: McpStatus;
  toolCount: number;
  setChecking: () => void;
  setActive: (toolCount: number) => void;
  setUnavailable: () => void;
};

export const useMcpStatusStore = create<McpStatusState>((set) => ({
  status: "checking",
  toolCount: 0,
  setChecking: () => set({ status: "checking" }),
  setActive: (toolCount) => set({ status: "active", toolCount }),
  setUnavailable: () => set({ status: "unavailable", toolCount: 0 }),
}));
