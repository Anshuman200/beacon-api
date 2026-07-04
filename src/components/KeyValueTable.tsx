"use client";

import { Checkbox, Button, Input, Tooltip, Upload, Segmented } from "antd";
import { FiTrash2, FiPlus, FiLock, FiUnlock, FiFile } from "react-icons/fi";
import { KeyValuePair, FormDataPair } from "@/store/collectionStore";

interface Props<T extends KeyValuePair> {
  value: T[];
  onChange: (newValue: T[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  showDescription?: boolean;
  /** Shows a lock toggle per row to flag a variable as secret (value redacted on export). */
  showSecretToggle?: boolean;
  /** Shows a Text/File toggle per row; file rows capture a real File object (session-only, never persisted). Only meaningful when T is FormDataPair. */
  allowFileRows?: boolean;
}

export default function KeyValueTable<T extends KeyValuePair = KeyValuePair>({
  value = [],
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  showDescription = true,
  showSecretToggle = false,
  allowFileRows = false,
}: Props<T>) {

  const handleRowChange = (index: number, field: string, val: string | boolean | File | undefined) => {
    const updated = [...value];
    updated[index] = {
      ...updated[index],
      [field]: val,
    };
    onChange(updated);
  };

  const handleAddRow = () => {
    onChange([
      ...value,
      { key: "", type: "text", value: "", description: "", enabled: true } as unknown as T,
    ]);
  };

  const handleDeleteRow = (index: number) => {
    const updated = value.filter((_, i) => i !== index);
    onChange(updated);
  };

  return (
    <div className="w-full space-y-2">
      {value.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-slate-500/10 dark:border-white/[0.06] rounded-xl">
          <p className="text-xs text-slate-550 dark:text-slate-500">No parameters defined</p>
        </div>
      ) : (
        <div className="border border-slate-500/10 dark:border-white/[0.06] rounded-xl overflow-hidden bg-slate-500/[0.01] dark:bg-white/[0.005]">
          {/* Table Header */}
          <div className="flex items-center px-3 py-2 bg-slate-500/5 dark:bg-white/[0.02] border-b border-slate-500/10 dark:border-white/[0.06] text-[10px] font-bold text-slate-550 dark:text-slate-400 uppercase tracking-wider">
            <div className="w-8 shrink-0 text-center">Use</div>
            <div className="flex-1 px-2">Key</div>
            <div className="flex-1 px-2">Value</div>
            {showDescription && <div className="flex-1 px-2 hidden sm:block">Description</div>}
            <div className="w-8 shrink-0"></div>
          </div>

          {/* Table Body */}
          <div className="divide-y divide-slate-500/10 dark:divide-white/[0.05]">
            {value.map((row, index) => {
              const fdRow = row as unknown as FormDataPair;
              const isFileRow = allowFileRows && fdRow.type === "file";

              return (
                <div
                  key={index}
                  className="flex items-center px-3 py-1.5 hover:bg-slate-550/[0.02] dark:hover:bg-white/[0.01] transition-colors"
                >
                  {/* Active Checkbox */}
                  <div className="w-8 shrink-0 flex items-center justify-center">
                    <Checkbox
                      checked={row.enabled}
                      onChange={(e) => handleRowChange(index, "enabled", e.target.checked)}
                    />
                  </div>

                  {/* Key Input */}
                  <div className="flex-1 px-1">
                    <Input
                      variant="borderless"
                      value={row.key}
                      placeholder={keyPlaceholder}
                      onChange={(e) => handleRowChange(index, "key", e.target.value)}
                      className="font-mono text-xs dark:text-white"
                    />
                  </div>

                  {/* Text/File toggle */}
                  {allowFileRows && (
                    <div className="shrink-0 px-1">
                      <Segmented
                        size="small"
                        value={fdRow.type || "text"}
                        onChange={(v) => handleRowChange(index, "type", v as string)}
                        options={[{ label: "Text", value: "text" }, { label: "File", value: "file" }]}
                        className="text-[10px]"
                      />
                    </div>
                  )}

                  {/* Value Input (text) or File picker */}
                  <div className="flex-1 px-1">
                    {isFileRow ? (
                      <Upload
                        beforeUpload={() => false}
                        showUploadList={false}
                        maxCount={1}
                        onChange={(info) => {
                          const file = info.fileList[0]?.originFileObj as File | undefined;
                          handleRowChange(index, "file", file);
                        }}
                      >
                        <Button size="small" icon={<FiFile className="w-3 h-3" />} className="text-xs">
                          {fdRow.file ? fdRow.file.name : "Choose File"}
                        </Button>
                      </Upload>
                    ) : (
                      <Input
                        variant="borderless"
                        value={row.value}
                        placeholder={valuePlaceholder}
                        onChange={(e) => handleRowChange(index, "value", e.target.value)}
                        className="font-mono text-xs dark:text-white"
                      />
                    )}
                  </div>

                  {/* Description Input */}
                  {showDescription && (
                    <div className="flex-1 px-1 hidden sm:block">
                      <Input
                        variant="borderless"
                        value={row.description || ""}
                        placeholder="Description"
                        onChange={(e) => handleRowChange(index, "description", e.target.value)}
                        className="text-xs text-slate-650 dark:text-slate-450"
                      />
                    </div>
                  )}

                  {/* Secret toggle */}
                  {showSecretToggle && (
                    <div className="w-8 shrink-0 flex items-center justify-center">
                      <Tooltip title={row.secret ? "Secret — value redacted on export" : "Mark as secret"}>
                        <Button
                          type="text"
                          aria-label={row.secret ? "Unmark as secret" : "Mark as secret"}
                          icon={row.secret
                            ? <FiLock className="w-3.5 h-3.5 text-amber-500" />
                            : <FiUnlock className="w-3.5 h-3.5 text-slate-400" />}
                          onClick={() => handleRowChange(index, "secret", !row.secret)}
                          className="flex items-center justify-center hover:bg-amber-500/10 border-none"
                        />
                      </Tooltip>
                    </div>
                  )}

                  {/* Action Trash */}
                  <div className="w-8 shrink-0 flex items-center justify-center">
                    <Button
                      type="text"
                      danger
                      icon={<FiTrash2 className="w-3.5 h-3.5" />}
                      onClick={() => handleDeleteRow(index)}
                      className="flex items-center justify-center hover:bg-rose-500/10 border-none"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Row Action */}
      <Button
        type="dashed"
        icon={<FiPlus />}
        onClick={handleAddRow}
        className="w-full text-xs font-semibold hover:border-indigo-500 hover:text-indigo-500 flex items-center justify-center border-slate-500/15 dark:border-white/10 dark:text-slate-350"
      >
        Add Parameter
      </Button>
    </div>
  );
}
