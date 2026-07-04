"use client";

import { useEffect, useRef, useState } from "react";
import { FiRefreshCw, FiX, FiGift } from "react-icons/fi";
import type { ChangelogEntry } from "@/lib/changelog";

/**
 * Registers the service worker (production only — a dev server never has a
 * "new build" to detect, and a real SW would only get in the way of Fast
 * Refresh) and shows a premium banner the moment a new build is detected —
 * either via the service worker finishing an install, or via the
 * SW-independent /version.json poll (belt-and-suspenders: covers contexts
 * where a service worker can't register at all, e.g. Safari private browsing).
 *
 * We deliberately never auto-activate a waiting worker — control is handed
 * over only when the tester clicks "Reload Now", so an in-progress request or
 * scripted run is never yanked out from under them.
 */
export default function PwaUpdateManager() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestRelease, setLatestRelease] = useState<ChangelogEntry | null>(null);
  const [reloading, setReloading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const reArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announcedRef = useRef(false);

  // Whichever detection path fires first wins; both funnel through here so
  // the banner always has release notes to show, regardless of which signal
  // (service worker vs. version poll) actually caught the new deploy.
  const announceUpdate = async () => {
    if (announcedRef.current) return;
    announcedRef.current = true;
    setUpdateAvailable(true);
    try {
      const res = await fetch("/version.json", { cache: "no-store" });
      const data = await res.json();
      if (data.latestRelease) setLatestRelease(data.latestRelease);
    } catch {
      // No changelog to show — the generic message below still covers it.
    }
  };

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    let onVisibility: (() => void) | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    const armUpdateWatch = (registration: ServiceWorkerRegistration) => {
      // A worker already sitting in `waiting` from before this page load
      // (e.g. a prior tab detected it) counts as a genuine update too.
      if (registration.waiting && navigator.serviceWorker.controller) {
        announceUpdate();
      }

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          // "installed" + an existing controller = a genuine update (the very
          // first install on a fresh visit has no controller yet to compare against).
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            announceUpdate();
          }
        });
      });
    };

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (cancelled) return;
        registrationRef.current = registration;
        armUpdateWatch(registration);

        // Browsers only re-check sw.js on their own schedule (throttled, up to
        // 24h) — force a prompt check whenever the tab regains focus, plus a
        // steady background poll for long-lived sessions left in the background.
        const checkNow = () => registration.update().catch(() => {});
        onVisibility = () => { if (document.visibilityState === "visible") checkNow(); };
        document.addEventListener("visibilitychange", onVisibility);
        interval = setInterval(checkNow, 5 * 60 * 1000);
      })
      .catch(() => {
        // Registration failing (unsupported context, blocked, etc.) just
        // means no update UI — the app works fine without it.
      });

    return () => {
      cancelled = true;
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
      if (interval) clearInterval(interval);
    };
  }, []);

  useEffect(() => () => {
    if (reArmTimerRef.current) clearTimeout(reArmTimerRef.current);
  }, []);

  // Belt-and-suspenders: poll /version.json and compare against the build id
  // baked into this page load. Catches deploys even where the service worker
  // path can't (registration blocked, Safari private browsing, etc.) — the
  // common pattern most SPAs use for their own "new version" banner.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    const currentBuildId = process.env.NEXT_PUBLIC_BUILD_ID;
    const checkVersion = async () => {
      try {
        const res = await fetch("/version.json", { cache: "no-store" });
        const data = await res.json();
        if (data.buildId && currentBuildId && data.buildId !== currentBuildId) {
          if (announcedRef.current) return;
          announcedRef.current = true;
          setUpdateAvailable(true);
          if (data.latestRelease) setLatestRelease(data.latestRelease);
        }
      } catch {
        // Offline or blocked — nothing to do, the SW path (if available) still covers it.
      }
    };

    checkVersion();
    const onVisibility = () => { if (document.visibilityState === "visible") checkVersion(); };
    document.addEventListener("visibilitychange", onVisibility);
    const interval = setInterval(checkVersion, 5 * 60 * 1000);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(interval);
    };
  }, []);

  const handleReload = () => {
    const registration = registrationRef.current;
    const waiting = registration?.waiting;
    if (!waiting) {
      window.location.reload();
      return;
    }
    setReloading(true);
    const onControllerChange = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange, { once: true });
    waiting.postMessage({ type: "SKIP_WAITING" });
    // Safety net in case controllerchange never fires for some reason.
    setTimeout(() => window.location.reload(), 4000);
  };

  const handleLater = () => {
    setDismissed(true);
    // Reappear after a while rather than staying silently out of date for the
    // rest of a long testing session.
    reArmTimerRef.current = setTimeout(() => setDismissed(false), 10 * 60 * 1000);
  };

  if (!updateAvailable || dismissed) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[9999] w-[min(92vw,400px)] animate-[updateBannerIn_0.35s_ease-out]">
      <style>{`
        @keyframes updateBannerIn {
          from { opacity: 0; transform: translateY(12px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <div className="relative rounded-2xl overflow-hidden border border-cyan-500/25 bg-white/90 dark:bg-[#090b11]/95 backdrop-blur-xl shadow-2xl shadow-cyan-500/10">
        <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-cyan-500 opacity-20 blur-3xl pointer-events-none" />
        <div className="relative p-4 flex gap-3">
          <div className="shrink-0 w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
            <FiRefreshCw className={`w-4 h-4 text-cyan-500 ${reloading ? "animate-spin" : ""}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-black text-slate-900 dark:text-white">Update Available</p>
              {latestRelease && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-cyan-500 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded-full">
                  {latestRelease.version}
                </span>
              )}
            </div>
            {latestRelease && latestRelease.highlights.length > 0 ? (
              <div className="mt-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                  <FiGift className="w-3 h-3" /> What&apos;s new
                </p>
                <ul className="mt-1 space-y-1">
                  {latestRelease.highlights.slice(0, 4).map((item, i) => (
                    <li key={i} className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug pl-2.5 relative before:content-['•'] before:absolute before:left-0 before:text-cyan-500">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-[11px] text-slate-550 dark:text-slate-400 mt-0.5 leading-relaxed">
                A new version of Beacon API is ready. Reload to get the latest features and fixes.
              </p>
            )}
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={handleReload}
                disabled={reloading}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-cyan-500 text-white hover:bg-cyan-400 transition-colors disabled:opacity-60 cursor-pointer"
              >
                {reloading ? "Reloading…" : "Reload Now"}
              </button>
              <button
                type="button"
                onClick={handleLater}
                disabled={reloading}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg text-slate-550 dark:text-slate-400 hover:bg-slate-500/10 dark:hover:bg-white/5 transition-colors disabled:opacity-60 cursor-pointer"
              >
                Later
              </button>
            </div>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={handleLater}
            disabled={reloading}
            className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer disabled:opacity-60"
          >
            <FiX className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
