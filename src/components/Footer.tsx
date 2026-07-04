import { FiHeart } from "react-icons/fi";
import { APP_VERSION } from "@/lib/site";

/**
 * Slim status-bar-style footer — server component, no interactivity needed.
 * The build id is the same NEXT_PUBLIC_BUILD_ID baked in for the PWA update
 * system (see next.config.ts / PwaUpdateManager.tsx), so this always matches
 * whatever the update banner would call "the latest build."
 */
export default function Footer() {
  const buildId = process.env.NEXT_PUBLIC_BUILD_ID || "dev";

  return (
    <footer className="shrink-0 border-t border-slate-500/10 dark:border-white/[0.06] bg-white/70 dark:bg-[#07080f]/85 backdrop-blur-xl px-4 h-8 flex items-center justify-between text-[11px] text-slate-550 dark:text-slate-400">
      <p className="flex items-center gap-1.5 truncate">
        Made with <FiHeart className="w-3 h-3 text-rose-500 fill-rose-500 shrink-0" /> by Ansh, for the world.
      </p>
      <p className="flex items-center gap-2 shrink-0 font-mono">
        <span className="font-semibold">v{APP_VERSION}</span>
        <span className="text-slate-500/40 dark:text-slate-600">•</span>
        <span>Build {buildId}</span>
      </p>
    </footer>
  );
}
