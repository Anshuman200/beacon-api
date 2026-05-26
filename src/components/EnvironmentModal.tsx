"use client";

import { useState } from "react";
import { useCollectionStore, KeyValuePair } from "@/store/collectionStore";
import { FiPlus, FiTrash2, FiGlobe, FiLayers, FiCheck, FiInfo, FiX } from "react-icons/fi";
import { Button, Input, message, Drawer } from "antd";
import KeyValueTable from "./KeyValueTable";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function EnvironmentModal({ open, onClose }: Props) {
  const {
    environments,
    activeEnvironmentId,
    setActiveEnvironmentId,
    addEnvironment,
    updateEnvironment,
    deleteEnvironment,
  } = useCollectionStore();

  const [selectedEnvId, setSelectedEnvId] = useState<string>("env_globals");
  const [newEnvName, setNewEnvName] = useState("");

  const selectedEnv = environments.find((e) => e.id === selectedEnvId) || environments[0];

  const handleAddEnvironment = () => {
    if (!newEnvName.trim()) {
      message.error("Environment name cannot be empty");
      return;
    }
    const id = addEnvironment(newEnvName.trim());
    setNewEnvName("");
    setSelectedEnvId(id);
    message.success(`Environment "${newEnvName}" created`);
  };

  const handleVariablesChange = (newVars: KeyValuePair[]) => {
    updateEnvironment(selectedEnv.id, { variables: newVars });
  };

  const handleDeleteEnvironment = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (id === "env_globals") {
      message.error("Cannot delete Globals environment");
      return;
    }
    deleteEnvironment(id);
    if (selectedEnvId === id) {
      setSelectedEnvId("env_globals");
    }
    message.success("Environment deleted");
  };

  const toggleActive = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeEnvironmentId === id) {
      setActiveEnvironmentId(null);
    } else {
      setActiveEnvironmentId(id);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="right"
      width={1100}
      closeIcon={null}
      styles={{
        header: { display: "none" },
        body: { padding: 0, display: "flex", flexDirection: "column", height: "100%" },
        wrapper: { boxShadow: "-8px 0 40px rgba(0,0,0,0.4)" },
      }}
      className="environment-drawer"
    >
      {/* ── Custom Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-500/10 dark:border-white/[0.07] bg-white/80 dark:bg-[#07080f]/95 backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/15 border border-indigo-500/20 dark:border-indigo-500/25 flex items-center justify-center">
            <FiGlobe className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white leading-none">
              Manage Environments
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Configure scoped variables for your requests
            </p>
          </div>
        </div>
        <Button
          type="text"
          icon={<FiX className="w-4 h-4" />}
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-500/10 dark:hover:bg-white/[0.05] border-none"
        />
      </div>

      {/* ── Body: Two Column Layout ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left Sidebar: Environment List */}
        <div className="w-64 shrink-0 flex flex-col border-r border-slate-500/10 dark:border-white/[0.07] bg-slate-500/[0.02] dark:bg-white/[0.01] overflow-y-auto">
          
          {/* Section Label */}
          <div className="px-4 pt-4 pb-2 shrink-0">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-450 uppercase tracking-wider">
              Environments
            </span>
          </div>

          {/* Add Environment Input */}
          <div className="px-3 pb-3 shrink-0">
            <div className="flex gap-1.5">
              <Input
                value={newEnvName}
                placeholder="New environment..."
                size="small"
                onChange={(e) => setNewEnvName(e.target.value)}
                onPressEnter={handleAddEnvironment}
                className="text-xs dark:bg-white/[0.04] dark:border-white/[0.08] dark:text-white dark:placeholder:text-slate-500"
              />
              <Button
                type="primary"
                size="small"
                icon={<FiPlus />}
                onClick={handleAddEnvironment}
                className="flex items-center justify-center shrink-0 border-none bg-indigo-600 shadow shadow-indigo-500/30"
              />
            </div>
          </div>

          {/* Environment List */}
          <div className="flex-1 px-2 pb-4 space-y-1">
            {environments.map((env) => {
              const isSelected = selectedEnvId === env.id;
              const isActive = activeEnvironmentId === env.id;
              const isGlobals = env.id === "env_globals";

              return (
                <div
                  key={env.id}
                  onClick={() => setSelectedEnvId(env.id)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl border cursor-pointer transition-all duration-150 ${
                    isSelected
                      ? "bg-indigo-500/10 dark:bg-indigo-500/15 border-indigo-500/25 dark:border-indigo-500/30 text-indigo-600 dark:text-indigo-400"
                      : "bg-transparent border-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-500/[0.04] dark:hover:bg-white/[0.03] hover:border-slate-500/10 dark:hover:border-white/[0.06]"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isGlobals ? (
                      <FiGlobe className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                    ) : (
                      <FiLayers className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span className="truncate text-xs font-semibold">{env.name}</span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Toggle Active */}
                    <button
                      onClick={(e) => toggleActive(env.id, e)}
                      title={isActive ? "Active environment" : "Set as active"}
                      className={`w-5 h-5 rounded-lg flex items-center justify-center border transition-all ${
                        isActive
                          ? "bg-emerald-500 border-emerald-500 text-white shadow shadow-emerald-500/30"
                          : "bg-slate-500/5 dark:bg-white/[0.05] border-slate-500/15 dark:border-white/[0.08] hover:border-emerald-500/40 hover:bg-emerald-500/10"
                      }`}
                    >
                      {isActive && <FiCheck className="w-2.5 h-2.5" />}
                    </button>

                    {/* Delete */}
                    {!isGlobals && (
                      <button
                        onClick={(e) => handleDeleteEnvironment(env.id, e)}
                        title="Delete environment"
                        className="w-5 h-5 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 transition-all"
                      >
                        <FiTrash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Panel: Variable Editor */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-white/50 dark:bg-[#07080f]/60">

          {/* Panel Header */}
          <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-500/10 dark:border-white/[0.06] shrink-0 bg-white/60 dark:bg-white/[0.015]">
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-bold text-slate-900 dark:text-white">
                {selectedEnv.name}
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                Variables
              </span>
              {activeEnvironmentId === selectedEnv.id && (
                <span className="text-[9px] bg-emerald-500/10 dark:bg-emerald-500/15 border border-emerald-500/20 dark:border-emerald-500/25 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
                  Active
                </span>
              )}
            </div>

            {selectedEnv.id !== "env_globals" && (
              <Input
                value={selectedEnv.name}
                size="small"
                onChange={(e) => updateEnvironment(selectedEnv.id, { name: e.target.value })}
                className="w-40 text-xs dark:bg-white/[0.04] dark:border-white/[0.08] dark:text-white"
                placeholder="Environment name"
              />
            )}
          </div>

          {/* Variable Table — fills remaining height */}
          <div className="flex-1 overflow-y-auto px-6 pt-4 min-h-0">
            <KeyValueTable
              value={selectedEnv.variables || []}
              onChange={handleVariablesChange}
              keyPlaceholder="VARIABLE_NAME"
              valuePlaceholder="value"
              showDescription={false}
            />
          </div>

          {/* Footer Tip */}
          <div className="px-6 py-4 shrink-0 border-t border-slate-500/10 dark:border-white/[0.06]">
            <div className="flex items-start gap-2.5 bg-indigo-500/5 dark:bg-indigo-500/[0.08] border border-indigo-500/10 dark:border-indigo-500/20 rounded-xl p-3">
              <FiInfo className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                Reference variables using{" "}
                <code className="px-1.5 py-0.5 bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-mono rounded text-[10px]">
                  {"{{variable_name}}"}
                </code>{" "}
                syntax in your request URL, headers, params, and body.
              </p>
            </div>
          </div>

        </div>
      </div>
    </Drawer>
  );
}
