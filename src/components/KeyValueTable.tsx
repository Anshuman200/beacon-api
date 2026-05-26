"use client";

import { Checkbox, Button, Input } from "antd";
import { FiTrash2, FiPlus } from "react-icons/fi";
import { KeyValuePair } from "@/store/collectionStore";

interface Props {
  value: KeyValuePair[];
  onChange: (newValue: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  showDescription?: boolean;
}

export default function KeyValueTable({
  value = [],
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  showDescription = true,
}: Props) {
  
  const handleRowChange = (index: number, field: keyof KeyValuePair, val: string | boolean) => {
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
      { key: "", value: "", description: "", enabled: true },
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
            {value.map((row, index) => (
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

                {/* Value Input */}
                <div className="flex-1 px-1">
                  <Input
                    variant="borderless"
                    value={row.value}
                    placeholder={valuePlaceholder}
                    onChange={(e) => handleRowChange(index, "value", e.target.value)}
                    className="font-mono text-xs dark:text-white"
                  />
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
            ))}
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
