"use client";

import { useRef, useState } from "react";
import { Button, Drawer } from "antd";
import { FiDownload, FiUpload, FiFileText } from "react-icons/fi";
import { useCollectionStore } from "@/store/collectionStore";
import { downloadCollectionExport, importCollectionFile } from "@/lib/importExport";
import { toast } from "@/lib/toast";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Collection to export when the drawer is opened from a specific collection's menu. */
  collectionId: string | null;
}

export default function ImportExportModal({ open, onClose, collectionId }: Props) {
  const { collections, environments, importCollection, importEnvironments, setActiveCollectionId } = useCollectionStore();
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportTarget = collections.find((c) => c.id === collectionId) || collections[0];

  const handleExport = () => {
    if (!exportTarget) return;
    downloadCollectionExport(exportTarget, environments);
    toast.success(`Exported "${exportTarget.name}"`);
  };

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const { collection, environments: importedEnvs } = importCollectionFile(text);
      importCollection(collection);
      if (importedEnvs.length > 0) importEnvironments(importedEnvs);
      setActiveCollectionId(collection.id);
      toast.success(`Imported "${collection.name}" (${collection.requests.length} requests)`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import file");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <Drawer title="Import / Export" open={open} onClose={onClose} size={420}>
      <div className="space-y-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Export</p>
          <p className="text-xs text-slate-500 mb-3">
            Download <span className="font-semibold">{exportTarget?.name || "a collection"}</span> as JSON to
            commit to a repo or share with your team. Variables marked secret are redacted.
          </p>
          <Button icon={<FiDownload />} onClick={handleExport} disabled={!exportTarget} block>
            Export &quot;{exportTarget?.name || "Collection"}&quot;
          </Button>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Import</p>
          <p className="text-xs text-slate-500 mb-3">
            Import a Beacon export or a Postman v2.1 collection export. Imported requests land in a new collection.
          </p>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors ${
              dragOver
                ? "border-indigo-500 bg-indigo-500/5"
                : "border-slate-500/20 dark:border-white/10 hover:border-indigo-500/40"
            }`}
          >
            <FiUpload className="w-5 h-5 text-slate-400" />
            <p className="text-xs text-slate-500 text-center">
              Drop a <span className="font-mono">.json</span> file here, or click to browse
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
          </div>
          <p className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-2">
            <FiFileText className="w-3 h-3 shrink-0" />
            Format is auto-detected (Beacon or Postman v2.1).
          </p>
        </div>
      </div>
    </Drawer>
  );
}
