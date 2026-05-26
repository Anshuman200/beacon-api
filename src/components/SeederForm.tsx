"use client";

import { useSeederStore } from "@/store/seederStore";
import SeederWorkspace from "./SeederWorkspace";
import CollectionRunner from "./CollectionRunner";
import EnvironmentModal from "./EnvironmentModal";
import RequestSidebar from "./RequestSidebar";

export default function SeederForm() {
  const { activeView, envModalOpen, setEnvModalOpen } = useSeederStore();

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden bg-slate-900/5 dark:bg-[#040509]">

      {/* ── PERSISTENT LEFT SIDEBAR ── */}
      <div className="w-full lg:w-72 shrink-0 border-b lg:border-b-0 lg:h-full lg:min-h-0">
        <RequestSidebar />
      </div>

      {/* ── MAIN WORKSPACE workbench ── */}
      <main className="flex-1 h-full overflow-hidden min-h-0 relative z-10">
        {activeView === "client" ? (
          <SeederWorkspace />
        ) : (
          <CollectionRunner />
        )}
      </main>

      {/* ── ENVIRONMENTS CONFIG DIALOG ── */}
      <EnvironmentModal
        open={envModalOpen}
        onClose={() => setEnvModalOpen(false)}
      />
      
    </div>
  );
}
