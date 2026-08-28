"use client";

import { create } from "zustand";

import { useBriefStore } from "@/lib/brief-store";
import { getSessionId } from "@/lib/session";
import type { WeatherOutlook } from "@/lib/types";

/**
 * Client-side weather state for the trip-brief panel's chip and the rail's
 * readiness panel — the HUMAN-side view of the same outlook the
 * get_weather_outlook tool returns (both read GET /api/weather; the server
 * TTL-caches the upstream call, so they share one Open-Meteo round trip).
 *
 * No polling loop of its own: weather for a fixed place + date window doesn't
 * change on a two-second cadence. The store refreshes when the brief's
 * place/dates identity changes (the component effect) and whenever a brief
 * save or proposal resolution nudges the brief store (the brief's fields
 * changing re-triggers that same effect).
 *
 * While the place/dates are unset the store stays at outlook=null — the chip
 * derives its "not yet available" state from the brief itself, no server
 * round trip needed.
 */

type WeatherState = {
  /** The identity of the place/dates the current outlook describes. */
  key: string | null;
  outlook: WeatherOutlook | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

function briefWeatherKey(): string | null {
  const brief = useBriefStore.getState().brief;
  if (brief === null) return null;
  if (brief.location === null || brief.startDate === null || brief.endDate === null) return null;
  return `${brief.location}|${brief.startDate}|${brief.endDate}`;
}

export const useWeatherStore = create<WeatherState>((set, get) => ({
  key: null,
  outlook: null,
  loading: false,

  refresh: async () => {
    const key = briefWeatherKey();
    // No place/dates (or a partial set) → nothing to fetch; the chip says why.
    if (key === null) {
      set({ key: null, outlook: null, loading: false });
      return;
    }
    const state = get();
    // Same window as what's loaded — the server cache makes a re-fetch cheap,
    // but there's no reason to even ask. (Also short-circuits a refresh that
    // races one already in flight for the same window.)
    if (state.key === key && (state.outlook !== null || state.loading)) return;

    const sessionId = getSessionId();
    if (sessionId.length === 0) return;
    // The window CHANGED: any outlook we still hold describes a DIFFERENT
    // place or date range. Keeping it up while the new one loads shows the
    // human the wrong window's weather — or, worse, a stale "couldn't find
    // <old place>" for a place they just fixed, with no sign of re-checking.
    // Drop it so the chip honestly flips to its checking state instead.
    set({ key, outlook: state.key === key ? state.outlook : null, loading: true });
    try {
      const response = await fetch(`/api/weather?sessionId=${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        // Keep whatever we had — a transient failure shouldn't blank the chip.
        set({ loading: false });
        return;
      }
      const body = (await response.json()) as { outlook: WeatherOutlook };
      // Ignore a stale response if the window changed mid-flight.
      if (briefWeatherKey() === key) {
        set({ key, outlook: body.outlook, loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },
}));
