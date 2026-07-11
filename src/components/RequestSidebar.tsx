"use client";

import { useState } from "react";
import { useSeederStore } from "@/store/seederStore";
import { useCollectionStore, ApiRequest, Folder } from "@/store/collectionStore";
import { DEMO_REQUESTS, DEMO_ENVIRONMENT } from "@/lib/demoData";
import { METHOD_THEMES } from "@/lib/methodThemes";
import {
  FiPlus, FiTrash2, FiCopy, FiSearch, FiClock, FiPlay,
  FiActivity, FiZap, FiEdit2, FiCheck, FiX, FiChevronDown, FiChevronRight,
  FiFolder, FiFolderPlus, FiMove, FiDownload,
} from "react-icons/fi";
import { Button, Input, Tooltip, Popconfirm, Dropdown } from "antd";
import { toast } from "@/lib/toast";

// Distinct per-collection identity colours — cycles deterministically by collection id.
const COLLECTION_ACCENTS = ["#6366f1", "#06b6d4", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6"];

export default function RequestSidebar() {
  const { activeView, setActiveView, isRunning, openImportExport } = useSeederStore();

  const {
    collections,
    activeCollectionId,
    activeRequestId,
    addCollection,
    renameCollection,
    deleteCollection,
    addFolder,
    renameFolder,
    deleteFolder,
    addRequest,
    deleteRequest,
    duplicateRequest,
    history,
    clearHistory,
    environments,
    addEnvironment,
    updateEnvironment,
    setActiveEnvironmentId,
  } = useCollectionStore();

  // ── UI State ──
  const [sidebarTab, setSidebarTab] = useState<"requests" | "history">("requests");
  const [search, setSearch] = useState("");

  // Which collections are collapsed (default: all expanded)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  // Inline rename state
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [draftColName, setDraftColName] = useState("");

  // Inline request rename state
  const [editingReqId, setEditingReqId] = useState<string | null>(null);
  const [draftReqName, setDraftReqName] = useState("");

  // Folder UI state
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(new Set());
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [draftFolderName, setDraftFolderName] = useState("");

  const [loadingDemo, setLoadingDemo] = useState(false);

  // ── Helpers ──
  const isExpanded = (colId: string) => !collapsedIds.has(colId);

  const toggleCollapse = (colId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(colId)) next.delete(colId);
      else next.add(colId);
      return next;
    });
  };

  // ── Collection actions ──
  const handleAddCollection = () => {
    const id = addCollection();
    setCollapsedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    const newCol = useCollectionStore.getState().collections.find((c) => c.id === id);
    setDraftColName(newCol?.name || "New Collection");
    setEditingColId(id);
  };

  const handleConfirmRename = (id: string) => {
    const trimmed = draftColName.trim();
    if (trimmed) renameCollection(id, trimmed);
    setEditingColId(null);
  };

  const handleDeleteCollection = (id: string) => {
    if (collections.length <= 1) {
      toast.warning("Cannot delete the last collection");
      return;
    }
    deleteCollection(id);
    useSeederStore.getState().closeTabsForCollection(id);
    toast.success("Collection deleted");
  };

  // ── Folder actions ──
  const toggleFolderCollapse = (folderId: string) => {
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const handleAddFolder = (collectionId: string) => {
    const id = addFolder(collectionId);
    setCollapsedIds((prev) => { const next = new Set(prev); next.delete(collectionId); return next; });
    const col = useCollectionStore.getState().collections.find((c) => c.id === collectionId);
    const folder = col?.folders.find((f) => f.id === id);
    setDraftFolderName(folder?.name || "New Folder");
    setEditingFolderId(id);
  };

  const handleConfirmFolderRename = (collectionId: string, folderId: string) => {
    const trimmed = draftFolderName.trim();
    if (trimmed) renameFolder(collectionId, folderId, trimmed);
    setEditingFolderId(null);
  };

  const handleDeleteFolder = (collectionId: string, folderId: string) => {
    deleteFolder(collectionId, folderId);
    toast.success("Folder deleted");
  };

  const handleMoveRequest = (reqId: string, folderId: string | null) => {
    useCollectionStore.getState().updateRequest(reqId, { folderId });
  };

  // ── Request actions ──
  const handleAddRequest = (collectionId: string) => {
    const id = addRequest(collectionId);
    useSeederStore.getState().openTab(collectionId, id);
    setActiveView("client");
    // Expand the collection if collapsed
    setCollapsedIds((prev) => { const next = new Set(prev); next.delete(collectionId); return next; });
    toast.success("New request created");
    // Auto-rename
    const col = useCollectionStore.getState().collections.find((c) => c.id === collectionId);
    const req = col?.requests.find((r) => r.id === id);
    setDraftReqName(req?.name || "New Request");
    setEditingReqId(id);
  };

  const handleDuplicate = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    duplicateRequest(id);
    const newId = useCollectionStore.getState().activeRequestId;
    const owningCollection = useCollectionStore.getState().collections.find((c) => c.requests.some((r) => r.id === newId));
    if (newId && owningCollection) useSeederStore.getState().openTab(owningCollection.id, newId);
    toast.success("Request duplicated");
  };

  const handleDelete = (id: string) => {
    deleteRequest(id);
    useSeederStore.getState().closeTab(id);
    toast.success("Request deleted");
  };

  const handleRequestClick = (collectionId: string, requestId: string) => {
    useSeederStore.getState().openTab(collectionId, requestId);
    setActiveView("client");
  };

  const confirmReqRename = (id: string) => {
    const trimmed = draftReqName.trim();
    if (trimmed) {
      // Find which collection owns this request and call updateRequest
      useCollectionStore.getState().updateRequest(id, { name: trimmed });
    }
    setEditingReqId(null);
  };

  // ── Demo loader ──
  const handleLoadDemo = async () => {
    setLoadingDemo(true);
    try {
      const alreadyLoaded = collections.some((col) =>
        col.requests.some((r) => r.id.startsWith("demo_req_"))
      );
      if (alreadyLoaded) {
        toast.info("Demo collection is already loaded!");
        setLoadingDemo(false);
        return;
      }

      const existingDemoEnv = environments.find((e) => e.name === "Beacon Demo");
      let envId: string;
      if (existingDemoEnv) {
        envId = existingDemoEnv.id;
        updateEnvironment(envId, { variables: DEMO_ENVIRONMENT.variables });
      } else {
        envId = addEnvironment(DEMO_ENVIRONMENT.name);
        await new Promise((r) => setTimeout(r, 50));
        updateEnvironment(envId, { variables: DEMO_ENVIRONMENT.variables });
      }
      setActiveEnvironmentId(envId);

      // Create a dedicated demo collection
      const demoColId = addCollection("Demo Collection");
      await new Promise((r) => setTimeout(r, 30));
      setCollapsedIds((prev) => { const next = new Set(prev); next.delete(demoColId); return next; });

      for (const req of DEMO_REQUESTS) {
        addRequest(demoColId, { ...req });
        await new Promise((r) => setTimeout(r, 10));
      }

      useSeederStore.getState().openTab(demoColId, DEMO_REQUESTS[0].id);
      setActiveView("client");

      toast.success("Demo collection loaded! 8 requests ready to explore.", { duration: 4000 });
    } catch (err) {
      toast.error("Failed to load demo collection: " + String(err));
    } finally {
      setLoadingDemo(false);
    }
  };

  // ── Method badge theme (shared across the app — every method gets its own colour) ──
  const methodTheme = (method: string) => METHOD_THEMES[method] || METHOD_THEMES.GET;

  // ── Per-collection accent colour — gives each collection a distinct identity strip ──
  const collectionAccent = (id: string) => {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return COLLECTION_ACCENTS[hash % COLLECTION_ACCENTS.length];
  };

  return (
    <div className="w-full lg:h-full flex flex-col bg-slate-500/5 dark:bg-white/[0.015] border-r border-slate-500/10 dark:border-white/[0.06] lg:overflow-hidden" data-tour="sidebar">

      {/* Tab switcher — plain flex buttons (not antd Segmented) so the two halves are always
          exactly 50/50; Segmented's sliding thumb is JS-measured and can drift out of sync
          with the actual cell width inside a resizing sidebar. */}
      <div className="p-3 border-b border-slate-500/10 dark:border-white/[0.06] shrink-0">
        <div role="tablist" aria-label="Sidebar view" className="flex items-stretch gap-1 p-1 rounded-md bg-slate-500/5 border border-slate-500/10 dark:bg-white/[0.01] dark:border-white/[0.05]">
          {(["requests", "history"] as const).map((key, i, arr) => {
            const { label, icon: Icon } = key === "requests"
              ? { label: "Collections", icon: FiFolder }
              : { label: "History", icon: FiClock };
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={sidebarTab === key}
                onClick={() => setSidebarTab(key)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault();
                    setSidebarTab(arr[(i + 1) % arr.length]);
                  }
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold transition-all cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400/60 ${
                  sidebarTab === key
                    ? "bg-indigo-600 dark:bg-indigo-500 text-white shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search + new collection */}
      <div className="px-3 pb-3 pt-2.5 border-b border-slate-500/10 dark:border-white/[0.06] shrink-0 flex items-center gap-2">
        <Input
          prefix={<FiSearch className="text-slate-500 w-3.5 h-3.5" />}
          placeholder={sidebarTab === "requests" ? "Search requests..." : "Search logs..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="small"
          className="text-xs"
          allowClear
        />
        {sidebarTab === "requests" && (
          <>
            <Tooltip title="New Collection">
              <Button
                size="small"
                data-tour="new-collection"
                icon={<FiFolderPlus className="w-3.5 h-3.5" />}
                onClick={handleAddCollection}
                disabled={isRunning}
                className="flex items-center justify-center shrink-0 border-slate-500/20 dark:border-white/10 text-indigo-500"
              />
            </Tooltip>
          </>
        )}
      </div>

      {/* Scrollable list */}
      <div className="flex-1 lg:overflow-y-auto lg:min-h-0 py-2 space-y-0.5">

        {/* ── COLLECTIONS VIEW ── */}
        {sidebarTab === "requests" && (
          <>
            {collections.length === 0 ? (
              <div className="text-center py-10 text-xs text-slate-500">
                No collections yet
              </div>
            ) : (
              collections.map((col) => {
                const expanded = isExpanded(col.id);
                const isColActive = activeCollectionId === col.id;
                const filteredReqs = col.requests.filter((r) =>
                  !search ||
                  r.name.toLowerCase().includes(search.toLowerCase()) ||
                  r.method.toLowerCase().includes(search.toLowerCase()) ||
                  `${r.baseUrl}/${r.endpoint}`.toLowerCase().includes(search.toLowerCase())
                );

                const renderRequestRow = (req: ApiRequest) => {
                  const isActive = activeRequestId === req.id && activeView === "client";
                  const isEditingName = editingReqId === req.id;
                  const theme = methodTheme(req.method);
                  const moveTargets = [
                    { key: "__root__", label: "No folder (root)", disabled: !req.folderId },
                    ...col.folders.map((f) => ({ key: f.id, label: f.name, disabled: req.folderId === f.id })),
                  ];

                  return (
                    <div
                      key={req.id}
                      onClick={() => !isEditingName && handleRequestClick(col.id, req.id)}
                      style={isActive ? { borderLeftColor: theme.primary, borderLeftWidth: 3 } : undefined}
                      className={`flex items-center justify-between px-2.5 py-2 rounded-lg border cursor-pointer group/req transition-all duration-150 ${
                        isActive
                          ? "bg-white dark:bg-white/[0.05] border-slate-200 dark:border-white/10 shadow-sm text-slate-900 dark:text-white"
                          : "bg-slate-500/[0.02] dark:bg-white/[0.02] border-slate-500/10 dark:border-white/[0.05] text-slate-700 dark:text-slate-400 hover:-translate-y-px hover:shadow-sm hover:bg-white dark:hover:bg-white/[0.04] hover:border-slate-500/20 dark:hover:border-white/10"
                      }`}
                    >
                      <div className="flex-1 min-w-0 pr-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-md border uppercase tracking-wide shrink-0"
                            style={{ backgroundColor: theme.bg, borderColor: theme.border, color: theme.text }}
                          >
                            {req.method}
                          </span>
                          {isEditingName ? (
                            <Input
                              autoFocus
                              size="small"
                              value={draftReqName}
                              onChange={(e) => setDraftReqName(e.target.value)}
                              onPressEnter={() => confirmReqRename(req.id)}
                              onBlur={() => confirmReqRename(req.id)}
                              onKeyDown={(e) => { if (e.key === "Escape") setEditingReqId(null); }}
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs flex-1 h-5 min-w-0"
                              maxLength={64}
                            />
                          ) : (
                            <span className="truncate text-xs font-semibold">{req.name}</span>
                          )}
                        </div>
                        {!isEditingName && (
                          <p className="text-[9px] font-mono text-slate-500 truncate mt-0.5">
                            {req.baseUrl}/{req.endpoint}
                          </p>
                        )}
                      </div>

                      {/* Request actions */}
                      {!isEditingName && (
                        <div className="flex items-center gap-0.5 lg:opacity-0 lg:group-hover/req:opacity-100 transition-opacity">
                          <Tooltip title="Rename">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDraftReqName(req.name);
                                setEditingReqId(req.id);
                              }}
                              className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-indigo-500 hover:bg-indigo-500/10 transition-all cursor-pointer"
                            >
                              <FiEdit2 className="w-2.5 h-2.5" />
                            </button>
                          </Tooltip>
                          {(col.folders.length > 0 || req.folderId) && (
                            <Dropdown
                              trigger={["click"]}
                              menu={{
                                items: moveTargets,
                                onClick: ({ key }) => handleMoveRequest(req.id, key === "__root__" ? null : key),
                              }}
                            >
                              <Tooltip title="Move to folder">
                                <button
                                  type="button"
                                  aria-label="Move to folder"
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-amber-500 hover:bg-amber-500/10 transition-all cursor-pointer"
                                >
                                  <FiMove className="w-2.5 h-2.5" />
                                </button>
                              </Tooltip>
                            </Dropdown>
                          )}
                          <Tooltip title="Duplicate">
                            <button
                              type="button"
                              onClick={(e) => handleDuplicate(req.id, e)}
                              disabled={isRunning}
                              className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-600 hover:bg-slate-500/10 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <FiCopy className="w-2.5 h-2.5" />
                            </button>
                          </Tooltip>
                          <Popconfirm
                            title="Delete request?"
                            onConfirm={() => handleDelete(req.id)}
                            okText="Delete"
                            cancelText="Cancel"
                            okButtonProps={{ danger: true }}
                            disabled={isRunning}
                          >
                            <button
                              type="button"
                              aria-label="Delete request"
                              onClick={(e) => e.stopPropagation()}
                              disabled={isRunning}
                              className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <FiTrash2 className="w-2.5 h-2.5" />
                            </button>
                          </Popconfirm>
                        </div>
                      )}

                      {isEditingName && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); confirmReqRename(req.id); }}
                            className="w-5 h-5 flex items-center justify-center rounded text-emerald-500 hover:bg-emerald-500/10 cursor-pointer"
                          >
                            <FiCheck className="w-2.5 h-2.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setEditingReqId(null); }}
                            className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:bg-slate-500/10 cursor-pointer"
                          >
                            <FiX className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                };

                const renderFolder = (folder: Folder) => {
                  const folderExpanded = !collapsedFolderIds.has(folder.id);
                  const folderReqs = filteredReqs.filter((r) => r.folderId === folder.id);
                  const isEditingFolder = editingFolderId === folder.id;

                  return (
                    <div key={folder.id} className="mb-0.5">
                      <div
                        className="group/folder flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-slate-500/5 dark:hover:bg-white/[0.02] transition-all"
                        onClick={() => toggleFolderCollapse(folder.id)}
                      >
                        <span className="text-slate-400 shrink-0 w-3">
                          {folderExpanded
                            ? <FiChevronDown className="w-2.5 h-2.5" />
                            : <FiChevronRight className="w-2.5 h-2.5" />}
                        </span>
                        <FiFolder className="w-3 h-3 text-amber-500 shrink-0" />
                        {isEditingFolder ? (
                          <Input
                            autoFocus
                            size="small"
                            value={draftFolderName}
                            onChange={(e) => setDraftFolderName(e.target.value)}
                            onPressEnter={() => handleConfirmFolderRename(col.id, folder.id)}
                            onBlur={() => handleConfirmFolderRename(col.id, folder.id)}
                            onKeyDown={(e) => { if (e.key === "Escape") setEditingFolderId(null); }}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs font-semibold flex-1 h-6"
                            maxLength={48}
                          />
                        ) : (
                          <span className="flex-1 min-w-0 flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">
                              {folder.name}
                            </span>
                            <span className="shrink-0 text-slate-400 dark:text-slate-500 font-normal">
                              ({folderReqs.length})
                            </span>
                          </span>
                        )}
                        <div className="lg:opacity-0 lg:group-hover/folder:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
                          <Tooltip title="Rename">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDraftFolderName(folder.name);
                                setEditingFolderId(folder.id);
                              }}
                              className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-indigo-500 hover:bg-indigo-500/10 transition-all cursor-pointer"
                            >
                              <FiEdit2 className="w-2.5 h-2.5" />
                            </button>
                          </Tooltip>
                          <Popconfirm
                            title="Delete folder"
                            description={`Delete "${folder.name}"? Requests inside move to the collection root.`}
                            onConfirm={() => handleDeleteFolder(col.id, folder.id)}
                            okText="Delete"
                            cancelText="Cancel"
                            okButtonProps={{ danger: true }}
                          >
                            <button
                              type="button"
                              onClick={(e) => e.stopPropagation()}
                              className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all cursor-pointer"
                            >
                              <FiTrash2 className="w-2.5 h-2.5" />
                            </button>
                          </Popconfirm>
                        </div>
                      </div>
                      {folderExpanded && (
                        <div className="ml-4 pl-2 border-l space-y-0.5 mb-0.5" style={{ borderLeftColor: `${accent}33` }}>
                          {folderReqs.length === 0 ? (
                            <p className="px-2 py-1.5 text-[10px] text-slate-400 dark:text-slate-600">Empty folder</p>
                          ) : (
                            folderReqs.map((req) => renderRequestRow(req))
                          )}
                        </div>
                      )}
                    </div>
                  );
                };

                const accent = collectionAccent(col.id);

                return (
                  <div key={col.id} className="px-2">
                    {/* Collection header — solid card with a per-collection accent edge for quick visual ID */}
                    <div
                      style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
                      className={`group flex items-center gap-1.5 pl-2 pr-2 py-1.5 rounded-lg border cursor-pointer transition-all duration-150 ${
                        isColActive
                          ? "bg-white dark:bg-white/[0.06] border-slate-200 dark:border-white/10 shadow-sm"
                          : "bg-slate-500/[0.03] dark:bg-white/[0.03] border-slate-500/10 dark:border-white/[0.06] hover:bg-white dark:hover:bg-white/[0.05] hover:shadow-sm"
                      }`}
                      onClick={() => toggleCollapse(col.id)}
                    >
                      {/* Expand arrow */}
                      <span className="text-slate-400 shrink-0 w-3.5">
                        {expanded
                          ? <FiChevronDown className="w-3 h-3" />
                          : <FiChevronRight className="w-3 h-3" />}
                      </span>

                      {/* Collection name / edit input */}
                      {editingColId === col.id ? (
                        <Input
                          autoFocus
                          size="small"
                          value={draftColName}
                          onChange={(e) => setDraftColName(e.target.value)}
                          onPressEnter={() => handleConfirmRename(col.id)}
                          onBlur={() => handleConfirmRename(col.id)}
                          onKeyDown={(e) => { if (e.key === "Escape") setEditingColId(null); }}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs font-bold flex-1 h-6"
                          maxLength={48}
                        />
                      ) : (
                        <span className="flex-1 min-w-0 flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                            {col.name}
                          </span>
                          <span
                            className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: `${accent}1a`, color: accent }}
                          >
                            {col.requests.length}
                          </span>
                        </span>
                      )}

                      {/* Hover actions — always visible below lg (no real hover on touch), hover-reveal at lg+ */}
                      <div className="lg:opacity-0 lg:group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
                        <Tooltip title="Rename">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDraftColName(col.name);
                              setEditingColId(col.id);
                            }}
                            className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-indigo-500 hover:bg-indigo-500/10 transition-all cursor-pointer"
                          >
                            <FiEdit2 className="w-2.5 h-2.5" />
                          </button>
                        </Tooltip>
                        <Tooltip title="Export">
                          <button
                            type="button"
                            aria-label="Export collection"
                            onClick={(e) => { e.stopPropagation(); openImportExport(col.id); }}
                            className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-sky-500 hover:bg-sky-500/10 transition-all cursor-pointer"
                          >
                            <FiDownload className="w-2.5 h-2.5" />
                          </button>
                        </Tooltip>
                        <Tooltip title="New Folder">
                          <button
                            type="button"
                            aria-label="New folder"
                            onClick={(e) => { e.stopPropagation(); handleAddFolder(col.id); }}
                            disabled={isRunning}
                            className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-amber-500 hover:bg-amber-500/10 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <FiFolderPlus className="w-2.5 h-2.5" />
                          </button>
                        </Tooltip>
                        <Tooltip title="Add Request">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleAddRequest(col.id); }}
                            disabled={isRunning}
                            className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-emerald-500 hover:bg-emerald-500/10 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <FiPlus className="w-2.5 h-2.5" />
                          </button>
                        </Tooltip>
                        <Popconfirm
                          title="Delete collection"
                          description={`Delete "${col.name}" and all its requests?`}
                          onConfirm={() => handleDeleteCollection(col.id)}
                          okText="Delete"
                          cancelText="Cancel"
                          okButtonProps={{ danger: true }}
                          disabled={isRunning || collections.length <= 1}
                        >
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            disabled={isRunning || collections.length <= 1}
                            className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <FiTrash2 className="w-2.5 h-2.5" />
                          </button>
                        </Popconfirm>
                      </div>
                    </div>

                    {/* Requests list */}
                    {expanded && (
                      <div className="ml-4 pl-2.5 border-l mt-0.5 mb-1 space-y-0.5" style={{ borderLeftColor: `${accent}33` }}>
                        {filteredReqs.length === 0 && col.folders.length === 0 && !search && (
                          <button
                            type="button"
                            onClick={() => handleAddRequest(col.id)}
                            disabled={isRunning}
                            className="w-full text-left px-2 py-2.5 text-[10px] text-slate-400 dark:text-slate-600 hover:text-indigo-500 flex items-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <FiPlus className="w-3 h-3" />
                            Add a request
                          </button>
                        )}

                        {col.folders.filter((f) => f.parentId === null).map((folder) => renderFolder(folder))}

                        {filteredReqs.filter((r) => !r.folderId).map((req) => renderRequestRow(req))}

                        {/* Add request at bottom of expanded collection */}
                        {col.requests.length > 0 && (
                          <button
                            type="button"
                            onClick={() => handleAddRequest(col.id)}
                            disabled={isRunning}
                            className="w-full text-left px-2 py-1.5 text-[10px] text-slate-400 dark:text-slate-600 hover:text-indigo-500 flex items-center gap-1.5 transition-colors mt-0.5 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <FiPlus className="w-3 h-3" />
                            Add request
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* New collection button */}
            <div className="px-4 pt-1">
              <button
                type="button"
                onClick={handleAddCollection}
                disabled={isRunning}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-500/5 hover:border-indigo-500/30 rounded-lg border border-dashed border-slate-500/25 dark:border-white/10 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <FiFolderPlus className="w-3.5 h-3.5" />
                New Collection
              </button>
            </div>
          </>
        )}

        {/* ── HISTORY VIEW ── */}
        {sidebarTab === "history" && (
          history.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-500">
              No runs recorded yet
            </div>
          ) : (
            <div className="space-y-1 px-2">
              <div className="flex items-center justify-between px-2 py-1 shrink-0 mb-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Run Logs</span>
                <button
                  onClick={clearHistory}
                  className="text-[9px] font-bold text-rose-500 hover:underline cursor-pointer"
                >
                  Clear All
                </button>
              </div>

              {history
                .filter((h) =>
                  h.requestName.toLowerCase().includes(search.toLowerCase()) ||
                  h.url.toLowerCase().includes(search.toLowerCase())
                )
                .map((log) => {
                  const passed = log.status === "success";
                  return (
                    <div
                      key={log.id}
                      className="px-2.5 py-2 border border-slate-500/5 dark:border-white/[0.03] rounded-lg bg-slate-500/[0.01] dark:bg-white/[0.002] space-y-1"
                    >
                      <div className="flex items-center justify-between text-[10px] font-bold">
                        <span className="text-slate-900 dark:text-white truncate max-w-[120px]">
                          {log.requestName}
                        </span>
                        <span className={passed ? "text-emerald-500" : "text-rose-500"}>
                          {log.assertionPassCount}/{log.assertionTotalCount} assertions
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono">
                        <span className="truncate max-w-[140px]">{log.url}</span>
                        <span>{log.responseTime}ms</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          )
        )}
      </div>

      {/* Bottom actions */}
      <div className="p-3 border-t border-slate-500/10 dark:border-white/[0.06] bg-slate-500/5 dark:bg-white/[0.01] space-y-2 shrink-0">

        <div className="grid grid-cols-2 gap-2">
          <Button
            type={activeView === "client" ? "primary" : "default"}
            icon={<FiActivity />}
            onClick={() => setActiveView("client")}
            className="text-xs font-bold h-9 flex items-center justify-center gap-1.5"
            block
          >
            Builder
          </Button>
          <Button
            type={activeView === "runner" ? "primary" : "default"}
            icon={<FiPlay />}
            onClick={() => setActiveView("runner")}
            className="text-xs font-bold h-9 flex items-center justify-center gap-1.5"
            block
          >
            Runner
          </Button>
        </div>

        <Button
          icon={<FiZap />}
          onClick={handleLoadDemo}
          loading={loadingDemo}
          disabled={isRunning}
          className="w-full text-xs font-bold h-8 flex items-center justify-center gap-1.5 border-indigo-500/30 text-indigo-500 hover:bg-indigo-500/10 dark:border-indigo-400/30 dark:text-indigo-400 dark:hover:bg-indigo-500/[0.08]"
        >
          Load Demo Collection
        </Button>

      </div>
    </div>
  );
}
