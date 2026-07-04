"use client";

import { useEffect } from "react";
import { useSeederStore } from "@/store/seederStore";
import { useCollectionStore } from "@/store/collectionStore";
import SeederWorkspace from "./SeederWorkspace";
import CollectionRunner from "./CollectionRunner";
import EnvironmentModal from "./EnvironmentModal";
import ImportExportModal from "./ImportExportModal";
import RequestSidebar from "./RequestSidebar";
import RequestTabStrip from "./RequestTabStrip";

export default function SeederForm() {
  const {
    activeView,
    envModalOpen,
    setEnvModalOpen,
    importExportOpen,
    setImportExportOpen,
    importExportCollectionId,
    openTabs,
    openTab,
  } = useSeederStore();
  const { activeCollectionId, activeRequestId } = useCollectionStore();

  // A fresh workspace (or very first session) has an active request but no
  // open tab for it yet — reconcile once so the tab strip isn't empty while
  // the workspace already shows content.
  useEffect(() => {
    if (openTabs.length === 0 && activeRequestId && activeCollectionId) {
      openTab(activeCollectionId, activeRequestId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden bg-slate-900/5 dark:bg-[#040509]">

      {/* ── PERSISTENT LEFT SIDEBAR ── */}
      <div className="w-full lg:w-72 shrink-0 border-b lg:border-b-0 lg:h-full lg:min-h-0">
        <RequestSidebar />
      </div>

      {/* ── MAIN WORKSPACE workbench ── */}
      <main className="flex-1 h-full overflow-hidden min-h-0 relative z-10 flex flex-col">
        {activeView === "client" && <RequestTabStrip />}
        <div className="flex-1 min-h-0">
          {activeView === "client" ? (
            <SeederWorkspace />
          ) : (
            <CollectionRunner />
          )}
        </div>
      </main>

      {/* ── ENVIRONMENTS CONFIG DIALOG ── */}
      <EnvironmentModal
        open={envModalOpen}
        onClose={() => setEnvModalOpen(false)}
      />

      {/* ── IMPORT / EXPORT DRAWER ── */}
      <ImportExportModal
        open={importExportOpen}
        onClose={() => setImportExportOpen(false)}
        collectionId={importExportCollectionId}
      />

    </div>
  );
}
