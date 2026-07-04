"use client";

import { useSeederStore } from "@/store/seederStore";
import { useCollectionStore } from "@/store/collectionStore";
import { METHOD_THEMES } from "@/lib/methodThemes";
import { FiX } from "react-icons/fi";

export default function RequestTabStrip() {
  const { openTabs, closeTab } = useSeederStore();
  const { collections, activeRequestId } = useCollectionStore();

  if (openTabs.length === 0) return null;

  const allRequests = collections.flatMap((c) => c.requests.map((r) => ({ ...r, collectionId: c.id })));

  return (
    <div className="flex items-center gap-0.5 px-2 pt-1.5 border-b border-slate-500/10 dark:border-white/[0.06] bg-slate-500/[0.02] dark:bg-white/[0.008] overflow-x-auto shrink-0">
      {openTabs.map((tab) => {
        const req = allRequests.find((r) => r.id === tab.requestId);
        if (!req) return null;
        const isActive = activeRequestId === tab.requestId;
        const theme = METHOD_THEMES[req.method] || METHOD_THEMES.GET;

        return (
          <div
            key={tab.requestId}
            onClick={() => useSeederStore.getState().openTab(tab.collectionId, tab.requestId)}
            className={`group/tab flex items-center gap-1.5 px-2.5 py-1.5 rounded-t-lg border-t border-x cursor-pointer shrink-0 max-w-[180px] transition-colors ${
              isActive
                ? "bg-white dark:bg-[#0c0d16] border-slate-500/10 dark:border-white/[0.06] text-slate-900 dark:text-white"
                : "bg-transparent border-transparent text-slate-500 hover:bg-slate-500/5 dark:hover:bg-white/[0.02]"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: theme.primary }} />
            <span className="truncate text-xs font-semibold">{req.name}</span>
            <button
              type="button"
              aria-label={`Close ${req.name} tab`}
              onClick={(e) => { e.stopPropagation(); closeTab(tab.requestId); }}
              className="w-4 h-4 shrink-0 flex items-center justify-center rounded text-slate-400 opacity-0 group-hover/tab:opacity-100 hover:bg-slate-500/15 hover:text-rose-500 transition-all cursor-pointer"
            >
              <FiX className="w-2.5 h-2.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
