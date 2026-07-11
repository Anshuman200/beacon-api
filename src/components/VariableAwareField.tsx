"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "antd";
import { VariableLookupResult } from "@/lib/variables";

const SOURCE_LABEL: Record<VariableLookupResult["source"], string> = {
  environment: "active environment",
  global: "global variables",
  collection: "collection variables",
};

/**
 * Single-line text field that renders {{variable}} tokens as hoverable chips showing the
 * resolved value (from the active environment / globals / collection) when not focused —
 * so users don't have to leave the request to check what a placeholder resolves to.
 * Falls back to a plain input while editing, since a live-highlighted contentEditable
 * would fight the caret on every keystroke.
 */
export default function VariableAwareField({
  value,
  onChange,
  placeholder,
  className,
  lookup,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  lookup: (key: string) => VariableLookupResult | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder={placeholder}
        className={`${className} outline-none border-none bg-transparent`}
      />
    );
  }

  const segments: { text: string; isVar: boolean }[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const varPattern = /\{\{([^}]+)\}\}/g;
  while ((match = varPattern.exec(value))) {
    if (match.index > lastIndex) segments.push({ text: value.slice(lastIndex, match.index), isVar: false });
    segments.push({ text: match[0], isVar: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) segments.push({ text: value.slice(lastIndex), isVar: false });

  const activate = () => {
    // A drag-select-then-click (e.g. to copy part of the URL) fires this same click handler on
    // mouseup — don't blow the selection away by swapping to the edit input underneath it.
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    setEditing(true);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={`${className} bg-transparent cursor-text whitespace-nowrap overflow-x-auto flex items-center focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400/60 rounded`}
    >
      {value.length === 0 ? (
        <span className="text-slate-400 dark:text-slate-600">{placeholder}</span>
      ) : (
        segments.map((seg, i) => {
          if (!seg.isVar) return <span key={i}>{seg.text}</span>;
          const key = seg.text.slice(2, -2).trim();
          const found = lookup(key);
          const title = found
            ? found.secret
              ? `${key} — defined in ${SOURCE_LABEL[found.source]} (secret, value hidden)`
              : `${key} = ${found.value || "(empty)"}  ·  ${SOURCE_LABEL[found.source]}`
            : `${key} is not defined in any active environment, global, or collection variable`;

          return (
            <Tooltip key={i} title={title}>
              <span
                className={`px-1 rounded font-semibold cursor-help ${
                  found
                    ? "bg-indigo-500/15 text-indigo-500 dark:text-indigo-400"
                    : "bg-rose-500/15 text-rose-500 dark:text-rose-400"
                }`}
              >
                {seg.text}
              </span>
            </Tooltip>
          );
        })
      )}
    </div>
  );
}
