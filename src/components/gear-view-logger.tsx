"use client";

import { useEffect, useRef } from "react";

import { logActivity } from "@/lib/activity";

/**
 * Records "human viewed gear" in the shared activity log — quietly, no toast
 * (the page itself is the feedback). This is the other half of the
 * collaboration loop: the agent's get_activity_log tool can see which gear
 * the human has been eyeing before it suggests anything.
 */
export function GearViewLogger({ gearItemId, name }: { gearItemId: string; name: string }) {
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    void logActivity({
      actor: "human",
      action: "view_gear",
      detail: `You viewed ${name}.`,
      quiet: true,
    });
  }, [gearItemId, name]);
  return null;
}
