"use client";
import { useState } from "react";
import Image from "next/image";
import { Button, Tooltip, Select, Drawer, App } from "antd";
import { FiRotateCcw, FiSun, FiMoon, FiHelpCircle, FiLayers, FiSettings, FiUpload, FiMenu } from "react-icons/fi";
import { useSeederStore } from "@/store/seederStore";
import { useCollectionStore } from "@/store/collectionStore";
import type { AppTheme } from "@/store/seederStore";
import { APP_VERSION } from "@/lib/site";

export default function Header() {
  const { modal } = App.useApp();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const {
    theme,
    setTheme,
    isRunning,
    triggerReset,
    setTourActive,
    setEnvModalOpen,
    openImportExport,
  } = useSeederStore();

  const {
    environments,
    activeEnvironmentId,
    setActiveEnvironmentId,
    activeCollectionId,
  } = useCollectionStore();

  const envSelect = (widthClassName: string) => (
    <Select
      size="large"
      value={activeEnvironmentId || "no_env"}
      className={`text-xs rounded-full ${widthClassName}`}
      popupMatchSelectWidth={false}
      onChange={(val) => setActiveEnvironmentId(val === "no_env" ? null : val)}
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
    />
  );

  const handleReset = () => {
    modal.confirm({
      title: "Reset workspace?",
      content: "This will permanently delete all collections, requests, environments, and history. This cannot be undone.",
      okText: "Reset Everything",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      centered: true,
      onOk: triggerReset,
    });
  };

  const themeOrder: AppTheme[] = ["light", "dark"];
  const themeIcons: Record<AppTheme, React.ReactNode> = {
    light: <FiSun className="w-[15px] h-[15px]" />,
    dark: <FiMoon className="w-[15px] h-[15px]" />,
  };
  const themeLabels: Record<AppTheme, string> = { light: "Light", dark: "Dark" };

  return (
    <header className="sticky top-0 z-50 border-b border-slate-500/10 dark:border-white/[0.06] bg-white/70 dark:bg-[#07080f]/85 backdrop-blur-xl transition-colors duration-300 shrink-0">
      <div className="max-w-full mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2">

        {/* Logo */}
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <div className="relative w-9 h-9 shrink-0 select-none">
            {/* Cyan glow background */}
            <div className="absolute inset-0 rounded-xl bg-cyan-500 opacity-45 blur-lg animate-pulse" style={{ animationDuration: "3s" }} />
            {/* Glassmorphic squircle */}
            <div className="relative w-9 h-9 rounded-xl bg-[#090b11]/90 border border-cyan-500/35 flex items-center justify-center shadow-lg shadow-cyan-500/20 overflow-hidden">
              <Image
                src="/BeaconAPI.png"
                alt="Beacon API Logo"
                width={36}
                height={36}
                priority
                unoptimized
                className="object-cover rounded-xl"
              />
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-black text-slate-900 dark:text-white tracking-tight truncate">Beacon API</span>
              <span className="hidden sm:inline-flex text-[10px] font-extrabold text-indigo-650 bg-indigo-500/10 border border-indigo-500/20 dark:text-indigo-400 dark:bg-indigo-500/15 dark:border-indigo-500/25 px-2 py-0.5 rounded-full leading-none shrink-0">v{APP_VERSION}</span>
            </div>
            <p className="hidden md:block text-[11px] text-slate-550 dark:text-slate-400 mt-0.5 font-medium truncate">Advanced Client, Sandboxed Testing &amp; Scripting Suite</p>
          </div>
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">

          {/* Environment Selector Dropdown — hidden on mobile, moved into the menu drawer */}
          <div className="hidden sm:flex items-center gap-2 mr-1 sm:mr-2" data-tour="env-selector">
            {envSelect("w-[110px] lg:w-[140px]")}
          </div>

          {/* Manage Environments Button — icon-only until lg, hidden on mobile.
              Visibility toggling lives on this plain wrapper div, not the antd
              Button's own className — antd's CSS-in-JS injects its own
              `display` rule at the same specificity as Tailwind's `.hidden`,
              but later in the cascade, so it silently wins if put directly
              on the Button. */}
          <div className="hidden sm:block">
            <Tooltip title="Manage Environments">
              <Button
                type="text"
                icon={<FiSettings className="w-3.5 h-3.5" />}
                onClick={() => setEnvModalOpen(true)}
                className="flex text-slate-550 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-405 text-xs items-center border border-slate-500/10 dark:border-white/5 rounded-lg px-2.5 py-1.5 hover:bg-slate-500/5"
              >
                <span className="hidden lg:inline">Environments</span>
              </Button>
            </Tooltip>
          </div>

          {/* Import / Export Button — icon-only until lg, hidden on mobile */}
          <div className="hidden sm:block">
            <Tooltip title="Import / Export">
              <Button
                type="text"
                aria-label="Import / Export"
                data-tour="import-btn"
                icon={<FiUpload className="w-3.5 h-3.5" />}
                onClick={() => openImportExport(activeCollectionId)}
                className="flex text-slate-550 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-405 text-xs items-center border border-slate-500/10 dark:border-white/5 rounded-lg px-2.5 py-1.5 hover:bg-slate-500/5"
              >
                <span className="hidden lg:inline">Import</span>
              </Button>
            </Tooltip>
          </div>

          <div className="w-[1px] h-6 bg-slate-500/15 dark:bg-white/10 hidden sm:block" />

          {/* Reset Button — icon-only until lg, hidden on mobile */}
          <div className="hidden sm:block">
            <Tooltip title={isRunning ? "Cannot reset while running" : "Clear workspace to defaults"}>
              <Button
                type="text"
                icon={<FiRotateCcw className="w-3.5 h-3.5" />}
                disabled={isRunning}
                onClick={handleReset}
                className="flex text-slate-550 dark:text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 text-xs items-center border border-slate-500/10 dark:border-white/5 rounded-lg px-2.5 py-1.5 hover:bg-rose-500/5 hover:border-rose-500/20"
              >
                <span className="hidden lg:inline">Reset All</span>
              </Button>
            </Tooltip>
          </div>

          {/* Theme Toggle — always visible, compact enough at every size */}
          <Tooltip title={`${themeLabels[theme]} theme — click to switch`}>
            <button
              type="button"
              data-tour="theme-toggle"
              onClick={() => setTheme(themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length])}
              className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full bg-slate-100/80 dark:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08] hover:bg-slate-200 dark:hover:bg-white/[0.09] hover:border-slate-300 dark:hover:border-white/[0.15] transition-all duration-200 cursor-pointer text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
            >
              <span key={theme} className="theme-icon-pop flex items-center justify-center">
                {themeIcons[theme]}
              </span>
            </button>
          </Tooltip>

          {/* Help Button — always visible */}
          <Tooltip title="Help & Tour">
            <Button
              type="text"
              shape="circle"
              icon={<FiHelpCircle className="w-4 h-4" />}
              onClick={() => setTourActive(true)}
              className="shrink-0 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center justify-center hover:bg-slate-500/5"
            />
          </Tooltip>

          {/* Mobile menu trigger — everything hidden above collapses in here */}
          <div className="sm:hidden">
            <Tooltip title="More">
              <Button
                type="text"
                shape="circle"
                aria-label="More"
                icon={<FiMenu className="w-4 h-4" />}
                onClick={() => setMobileMenuOpen(true)}
                className="flex shrink-0 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 items-center justify-center hover:bg-slate-500/5"
              />
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Mobile menu — same actions the sm+ breakpoints show inline, stacked full-width */}
      <Drawer
        title="Menu"
        placement="right"
        width={280}
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        className="sm:hidden"
      >
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Environment</p>
            {envSelect("w-full")}
          </div>
          <Button
            icon={<FiSettings className="w-3.5 h-3.5" />}
            onClick={() => { setEnvModalOpen(true); setMobileMenuOpen(false); }}
            className="flex items-center justify-start gap-2"
            block
          >
            Manage Environments
          </Button>
          <Button
            icon={<FiUpload className="w-3.5 h-3.5" />}
            onClick={() => { openImportExport(activeCollectionId); setMobileMenuOpen(false); }}
            className="flex items-center justify-start gap-2"
            block
          >
            Import / Export
          </Button>
          <Button
            icon={<FiRotateCcw className="w-3.5 h-3.5" />}
            disabled={isRunning}
            onClick={() => { setMobileMenuOpen(false); handleReset(); }}
            danger
            className="flex items-center justify-start gap-2"
            block
          >
            Reset All
          </Button>
        </div>
      </Drawer>
    </header>
  );
}
