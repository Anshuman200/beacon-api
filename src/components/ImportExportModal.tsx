"use client";

import { useRef, useState } from "react";
import { Button, Drawer, Segmented, Input, Select } from "antd";
import { FiDownload, FiUpload, FiFileText, FiLink } from "react-icons/fi";
import { useCollectionStore } from "@/store/collectionStore";
import { downloadCollectionExport, importCollectionFile } from "@/lib/importExport";
import { fetchOpenApiSpecFromUrl, parseOpenApiDocument, SpecFetchCredentials } from "@/lib/openApiImport";
import { toast } from "@/lib/toast";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Collection to export when the drawer is opened from a specific collection's menu. */
  collectionId: string | null;
}

export default function ImportExportModal({ open, onClose, collectionId }: Props) {
  const { collections, environments, importCollection, importEnvironments, setActiveCollectionId, setActiveEnvironmentId } = useCollectionStore();
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [importMode, setImportMode] = useState<"file" | "url">("file");
  const [specUrl, setSpecUrl] = useState("");
  const [credType, setCredType] = useState<SpecFetchCredentials["type"]>("none");
  const [basicUser, setBasicUser] = useState("");
  const [basicPass, setBasicPass] = useState("");
  const [headerName, setHeaderName] = useState("");
  const [headerValue, setHeaderValue] = useState("");
  const [urlImporting, setUrlImporting] = useState(false);

  const exportTarget = collections.find((c) => c.id === collectionId) || collections[0];

  const handleExport = () => {
    if (!exportTarget) return;
    downloadCollectionExport(exportTarget, environments);
    toast.success(`Exported "${exportTarget.name}"`);
  };

  const finishImport = (result: { collection: ReturnType<typeof importCollectionFile>["collection"]; environments: ReturnType<typeof importCollectionFile>["environments"] }) => {
    importCollection(result.collection);
    if (result.environments.length > 0) {
      importEnvironments(result.environments);
      // Auto-select it — every imported request references its base_url via
      // {{base_url}}, so leaving no environment active would make them all
      // fail to resolve until the tester happens to pick it manually.
      setActiveEnvironmentId(result.environments[0].id);
    }
    setActiveCollectionId(result.collection.id);
    toast.success(`Imported "${result.collection.name}" (${result.collection.requests.length} requests)`);
    onClose();
  };

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      finishImport(importCollectionFile(text));
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

  const handleImportFromUrl = async () => {
    if (!specUrl.trim()) return;
    setUrlImporting(true);
    try {
      const credentials: SpecFetchCredentials =
        credType === "basic"
          ? { type: "basic", username: basicUser, password: basicPass }
          : credType === "header"
            ? { type: "header", name: headerName, value: headerValue }
            : { type: "none" };
      const { text, url } = await fetchOpenApiSpecFromUrl(specUrl.trim(), credentials);
      finishImport(parseOpenApiDocument(text, undefined, url));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import from URL");
    } finally {
      setUrlImporting(false);
    }
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
            Import a Beacon export, a Postman v2.1 collection, or an OpenAPI 3.x / Swagger 2.0 spec (JSON or YAML).
            Imported requests land in a new collection.
          </p>

          <Segmented
            block
            value={importMode}
            onChange={(v) => setImportMode(v as "file" | "url")}
            options={[
              { label: "File", value: "file", icon: <FiUpload /> },
              { label: "From URL", value: "url", icon: <FiLink /> },
            ]}
            className="mb-3"
          />

          {importMode === "file" ? (
            <>
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
                  Drop a <span className="font-mono">.json</span> or <span className="font-mono">.yaml</span> file here, or click to browse
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json,.yaml,.yml"
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
                Format is auto-detected (Beacon, Postman v2.1, or OpenAPI/Swagger).
              </p>
            </>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Spec URL</p>
                <Input
                  value={specUrl}
                  onChange={(e) => setSpecUrl(e.target.value)}
                  placeholder="https://api.example.com/swagger/v1/swagger.json"
                />
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Credentials to fetch the spec (only if the docs page itself is protected)
                </p>
                <Select
                  value={credType}
                  onChange={setCredType}
                  className="w-full"
                  options={[
                    { label: "None — spec is public", value: "none" },
                    { label: "Basic Auth", value: "basic" },
                    { label: "Custom Header", value: "header" },
                  ]}
                />
              </div>

              {credType === "basic" && (
                <div className="flex gap-2">
                  <Input placeholder="Username" value={basicUser} onChange={(e) => setBasicUser(e.target.value)} />
                  <Input.Password placeholder="Password" value={basicPass} onChange={(e) => setBasicPass(e.target.value)} />
                </div>
              )}
              {credType === "header" && (
                <div className="flex gap-2">
                  <Input placeholder="Header name (e.g. Cookie)" value={headerName} onChange={(e) => setHeaderName(e.target.value)} />
                  <Input.Password placeholder="Header value" value={headerValue} onChange={(e) => setHeaderValue(e.target.value)} />
                </div>
              )}

              <Button type="primary" icon={<FiLink />} loading={urlImporting} onClick={handleImportFromUrl} disabled={!specUrl.trim()} block>
                Fetch &amp; Import
              </Button>
              <p className="text-[10px] text-slate-400">
                These credentials are only used to fetch the spec document itself — they&apos;re not saved anywhere and are separate from each imported request&apos;s own auth (which is set per-endpoint from the spec).
              </p>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
