"use client";
import { Button, Tooltip, Segmented, Select } from "antd";
import { FiRotateCcw, FiSun, FiMoon, FiMonitor, FiHelpCircle, FiLayers, FiSettings } from "react-icons/fi";
import { useSeederStore } from "@/store/seederStore";
import { useCollectionStore } from "@/store/collectionStore";
import type { AppTheme } from "@/store/seederStore";

export default function Header() {
  const {
    theme,
    setTheme,
    isRunning,
    triggerReset,
    setTourActive,
    setEnvModalOpen,
  } = useSeederStore();

  const {
    environments,
    activeEnvironmentId,
    setActiveEnvironmentId,
  } = useCollectionStore();

  return (
    <header className="sticky top-0 z-50 border-b border-slate-500/10 dark:border-white/[0.06] bg-white/70 dark:bg-[#07080f]/85 backdrop-blur-xl transition-colors duration-300 shrink-0">
      <div className="max-w-full mx-auto px-6 h-16 flex items-center justify-between">

        {/* Logo */}
        <div className="flex items-center gap-4">
          <div className="relative w-9 h-9 shrink-0 select-none">
            {/* Cyan glow background */}
            <div className="absolute inset-0 rounded-xl bg-cyan-500 opacity-40 blur-lg" />
            {/* Glassmorphic squircle */}
            <div className="relative w-9 h-9 rounded-xl bg-[#090b11]/90 border border-cyan-500/35 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              {/* Neon circular ring */}
              <div className="absolute w-[28px] h-[28px] rounded-full border-2 border-cyan-400/80 shadow-[0_0_8px_rgba(34,211,238,0.5)] flex items-center justify-center">
                {/* Bold white B. text */}
                <span className="text-xs font-black text-white leading-none font-sans translate-x-[0.5px]">B.</span>
              </div>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-black text-slate-900 dark:text-white tracking-tight">Beacon API</span>
              <span className="text-[10px] font-extrabold text-indigo-650 bg-indigo-500/10 border border-indigo-500/20 dark:text-indigo-400 dark:bg-indigo-500/15 dark:border-indigo-500/25 px-2 py-0.5 rounded-full leading-none">v2.0</span>
            </div>
            <p className="text-[11px] text-slate-550 dark:text-slate-400 mt-0.5 font-medium">Advanced Client, Sandboxed Testing &amp; Scripting Suite</p>
          </div>
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-3">

          {/* Environment Selector Dropdown */}
          <div className="flex items-center gap-2 mr-2">
            <Select
              size="large"
              value={activeEnvironmentId || "no_env"}
              style={{ width: 140 }}
              popupMatchSelectWidth={false}
              onChange={(val) => {
                if (val === "no_env") {
                  setActiveEnvironmentId(null);
                } else {
                  setActiveEnvironmentId(val);
                }
              }}
              disabled={isRunning}
              options={[
                { label: "No Environment", value: "no_env" },
                ...environments.map((e) => ({
                  label: (
                    <div className="flex items-center gap-1.5 text-xs">
                      <FiLayers className="w-3 h-3 text-slate-500" />
                      <span className="truncate">{e.name}</span>
                    </div>
                  ),
                  value: e.id,
                })),
              ]}
              className="text-xs rounded-full"
            />
          </div>

          {/* Manage Environments Button */}
          <Tooltip title="Manage Environments">
            <Button
              type="text"
              icon={<FiSettings className="w-3.5 h-3.5" />}
              onClick={() => setEnvModalOpen(true)}
              className="text-slate-550 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-405 text-xs flex items-center border border-slate-500/10 dark:border-white/5 rounded-lg px-2.5 py-1.5 hover:bg-slate-500/5"
            >
              Environments
            </Button>
          </Tooltip>

          <div className="w-[1px] h-6 bg-slate-500/15 dark:bg-white/10 hidden sm:block" />

          {/* Reset Button */}
          <Tooltip title={isRunning ? "Cannot reset while running" : "Clear workspace to defaults"}>
            <Button
              type="text"
              icon={<FiRotateCcw className="w-3.5 h-3.5" />}
              disabled={isRunning}
              onClick={triggerReset}
              className="text-slate-550 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-405 text-xs flex items-center border border-slate-500/10 dark:border-white/5 rounded-lg px-2.5 py-1.5 hover:bg-slate-500/5"
            >
              Reset All
            </Button>
          </Tooltip>

          {/* Theme Selector */}
          <Segmented
            value={theme}
            onChange={(value) => setTheme(value as AppTheme)}
            options={[
              { value: "light", icon: <FiSun className="w-3.5 h-3.5 inline-block align-middle" /> },
              { value: "dark", icon: <FiMoon className="w-3.5 h-3.5 inline-block align-middle" /> },
              { value: "system", icon: <FiMonitor className="w-3.5 h-3.5 inline-block align-middle" /> },
            ]}
            className="bg-slate-500/5 border border-slate-500/10 dark:bg-white/[0.02] dark:border-white/[0.05]"
          />

          {/* Help Button */}
          <Tooltip title="Help & Tour">
            <Button
              type="text"
              shape="circle"
              icon={<FiHelpCircle className="w-4 h-4" />}
              onClick={() => setTourActive(true)}
              className="text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center justify-center hover:bg-slate-500/5"
            />
          </Tooltip>
        </div>
      </div>
    </header>
  );
}
