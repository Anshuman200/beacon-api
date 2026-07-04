"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Select, Checkbox, InputNumber, Tag, Tooltip } from "antd";
import { FiPlay, FiSave, FiTrash2, FiPlus, FiHelpCircle } from "react-icons/fi";
import { useCollectionStore, ApiRequest, AuthMatrixSnapshot } from "@/store/collectionStore";
import type { SendRequestFn } from "@/lib/securityProbes";
import { toast } from "@/lib/toast";

const AUTH_TYPE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth" },
  { value: "apikey", label: "API Key" },
];

interface RunResult {
  profileId: string;
  status: number;
}

export interface MatrixResultSummary {
  profileName: string;
  status: number;
  expectedStatus?: number;
  isMismatch: boolean;
  isRegression: boolean;
  baselineStatus?: number;
}

interface Props {
  request: ApiRequest;
  onSend: SendRequestFn;
  onUpdateAuthMatrixBaseline: (baseline: AuthMatrixSnapshot[]) => void;
  /** Reports the full latest-run detail — feeds the API5 checklist hint and the exportable report. */
  onResultsChange?: (summary: MatrixResultSummary[]) => void;
  /** Bump this (e.g. a counter) to trigger a run from outside — used by the panel's "Run Full Scan". */
  runSignal?: number;
}

export default function AuthMatrixSection({ request, onSend, onUpdateAuthMatrixBaseline, onResultsChange, runSignal }: Props) {
  const { collections, activeCollectionId, addAuthProfile, updateAuthProfile, deleteAuthProfile, ensureDefaultAuthProfiles } = useCollectionStore();
  const collection = useMemo(() => collections.find((c) => c.id === activeCollectionId), [collections, activeCollectionId]);
  const profiles = collection?.authProfiles ?? [];

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [results, setResults] = useState<RunResult[] | null>(null);
  const [running, setRunning] = useState(false);

  // Collections created before the Authorization Matrix shipped (or ones a user
  // has never opened this section on) start with an empty profile list — seed
  // the standard Anonymous/Regular User/Admin templates so testers get a
  // ready-to-run matrix instead of a blank "add one yourself" screen.
  useEffect(() => {
    if (activeCollectionId) ensureDefaultAuthProfiles(activeCollectionId);
  }, [activeCollectionId, ensureDefaultAuthProfiles]);

  // Auto-select every profile the first time they become available, so a
  // first-time visitor can hit "Run Matrix" immediately with zero setup
  // (Anonymous needs no credentials and already has an expected status set)
  // instead of having to first understand that profiles must be ticked.
  const hasAutoSelected = useRef(false);
  useEffect(() => {
    if (!hasAutoSelected.current && profiles.length > 0) {
      hasAutoSelected.current = true;
      setSelectedIds(profiles.map((p) => p.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.length]);

  const baseline = request.security.authMatrixBaseline ?? [];

  useEffect(() => {
    if (!results) return;
    const summary: MatrixResultSummary[] = results.map((r) => {
      const profile = profiles.find((p) => p.id === r.profileId);
      const baselineEntry = baseline.find((b) => b.profileId === r.profileId);
      return {
        profileName: profile?.name ?? "Unknown role",
        status: r.status,
        expectedStatus: profile?.expectedStatus,
        isMismatch: !!(profile?.expectedStatus && r.status !== profile.expectedStatus),
        isRegression: !!(baselineEntry && r.status !== baselineEntry.status),
        baselineStatus: baselineEntry?.status,
      };
    });
    onResultsChange?.(summary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  };

  const handleAddProfile = () => {
    if (!collection) return;
    addAuthProfile(collection.id);
  };

  const handleRunMatrix = async () => {
    if (!collection || selectedIds.length === 0) return;
    setRunning(true);
    try {
      const nextResults: RunResult[] = [];
      for (const profileId of selectedIds) {
        const profile = profiles.find((p) => p.id === profileId);
        if (!profile) continue;
        const response = await onSend({ ...request, auth: profile.auth });
        nextResults.push({ profileId, status: response.status });
      }
      setResults(nextResults);
      toast.success(`Ran the matrix across ${nextResults.length} profile(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run the authorization matrix");
    } finally {
      setRunning(false);
    }
  };

  // Lets the panel's "Run Full Scan" trigger a run here without duplicating
  // the run logic — only fires on genuine changes, never on initial mount.
  const prevRunSignalRef = useRef(runSignal);
  useEffect(() => {
    if (runSignal === undefined || runSignal === prevRunSignalRef.current) return;
    prevRunSignalRef.current = runSignal;
    // Deferred (not called synchronously in the effect body) since
    // handleRunMatrix's first statement is a setState call.
    const timer = setTimeout(() => {
      if (selectedIds.length > 0) handleRunMatrix();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSignal]);

  const handleSaveBaseline = () => {
    if (!results) return;
    const snapshot: AuthMatrixSnapshot[] = results.map((r) => ({
      profileId: r.profileId,
      status: r.status,
      timestamp: new Date().toISOString(),
    }));
    onUpdateAuthMatrixBaseline(snapshot);
    toast.success("Saved current results as the baseline for this request");
  };

  if (!collection) {
    return <p className="text-xs text-slate-500 py-3 text-center">No active collection.</p>;
  }

  const resultRows = (results ?? [])
    .map((r) => {
      const profile = profiles.find((p) => p.id === r.profileId);
      if (!profile) return null;
      const baselineEntry = baseline.find((b) => b.profileId === r.profileId);
      const isRegression = !!(baselineEntry && r.status !== baselineEntry.status);
      const isMismatch = !!(profile.expectedStatus && r.status !== profile.expectedStatus);
      return { profile, status: r.status, isRegression, isMismatch, baselineStatus: baselineEntry?.status };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-slate-500 space-y-1">
        <p className="font-semibold text-slate-600 dark:text-slate-400">
          Test this endpoint as different user roles to catch broken access control — one of the most common API vulnerabilities.
        </p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Set each role&apos;s credentials below (Anonymous needs none).</li>
          <li>Tick the roles you want to run.</li>
          <li>Click Run Matrix and compare the results.</li>
        </ol>
      </div>

      {resultRows.length > 0 && (
        <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-2.5 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Results</p>
          {resultRows.map(({ profile, status, isRegression, isMismatch, baselineStatus }) => (
            <div key={profile.id} className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300 flex-1 truncate">{profile.name}</span>
              <Tag color={isMismatch || isRegression ? "red" : "green"} className="text-[10px]">
                {status}
              </Tag>
              {isMismatch && (
                <span className="text-[10px] text-rose-500 font-semibold">Mismatch — expected {profile.expectedStatus}</span>
              )}
              {isRegression && (
                <span className="text-[10px] text-rose-500 font-semibold">Regression — was {baselineStatus}</span>
              )}
              {!isMismatch && !isRegression && <span className="text-[10px] text-emerald-500 font-semibold">Pass</span>}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {profiles.length === 0 && (
          <p className="text-xs text-slate-500 py-2 text-center border border-dashed border-slate-500/20 rounded-lg">
            No auth profiles yet — add one for each role you want to test (e.g. Admin, Regular User, Anonymous).
          </p>
        )}
        {profiles.map((profile) => (
          <div key={profile.id} className="rounded-lg border border-slate-500/10 dark:border-white/[0.06] p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox checked={selectedIds.includes(profile.id)} onChange={(e) => toggleSelected(profile.id, e.target.checked)} />
              <Input
                size="small"
                value={profile.name}
                onChange={(e) => updateAuthProfile(collection.id, profile.id, { name: e.target.value })}
                className="flex-1 text-xs font-semibold"
                placeholder="Role name (e.g. Admin)"
              />
              <Select
                size="small"
                value={profile.auth.type}
                onChange={(type) => updateAuthProfile(collection.id, profile.id, { auth: { ...profile.auth, type } })}
                options={AUTH_TYPE_OPTIONS}
                className="w-32"
              />
              <Button
                size="small"
                danger
                icon={<FiTrash2 />}
                onClick={() => deleteAuthProfile(collection.id, profile.id)}
              />
            </div>

            {profile.auth.type === "bearer" && (
              <Input.Password
                size="small"
                placeholder="Paste this role's bearer token"
                value={profile.auth.bearerToken}
                onChange={(e) => updateAuthProfile(collection.id, profile.id, { auth: { ...profile.auth, bearerToken: e.target.value } })}
              />
            )}
            {profile.auth.type === "basic" && (
              <div className="flex gap-2">
                <Input
                  size="small"
                  placeholder="Username"
                  value={profile.auth.basicUser}
                  onChange={(e) => updateAuthProfile(collection.id, profile.id, { auth: { ...profile.auth, basicUser: e.target.value } })}
                />
                <Input.Password
                  size="small"
                  placeholder="Password"
                  value={profile.auth.basicPass}
                  onChange={(e) => updateAuthProfile(collection.id, profile.id, { auth: { ...profile.auth, basicPass: e.target.value } })}
                />
              </div>
            )}
            {profile.auth.type === "apikey" && (
              <div className="flex gap-2">
                <Input
                  size="small"
                  placeholder="Key name"
                  value={profile.auth.apiKeyName}
                  onChange={(e) => updateAuthProfile(collection.id, profile.id, { auth: { ...profile.auth, apiKeyName: e.target.value } })}
                />
                <Input.Password
                  size="small"
                  placeholder="Key value"
                  value={profile.auth.apiKeyValue}
                  onChange={(e) => updateAuthProfile(collection.id, profile.id, { auth: { ...profile.auth, apiKeyValue: e.target.value } })}
                />
                <Select
                  size="small"
                  value={profile.auth.apiKeyLocation}
                  onChange={(loc) => updateAuthProfile(collection.id, profile.id, { auth: { ...profile.auth, apiKeyLocation: loc } })}
                  options={[{ value: "header", label: "Header" }, { value: "query", label: "Query" }]}
                  className="w-28"
                />
              </div>
            )}
            {profile.auth.type === "none" && (
              <p className="text-[10px] text-slate-500">No credentials needed — this role is tested with no auth at all.</p>
            )}

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-500">What status should this role get?</span>
              <Tooltip title="Leave blank if you're not sure yet — you can still run the matrix and fill this in once you see the actual response.">
                <span className="cursor-help text-slate-400"><FiHelpCircle className="w-3 h-3" /></span>
              </Tooltip>
              <InputNumber
                size="small"
                placeholder="e.g. 200"
                value={profile.expectedStatus}
                onChange={(v) => updateAuthProfile(collection.id, profile.id, { expectedStatus: v ?? undefined })}
                className="w-20"
              />
            </div>
          </div>
        ))}
      </div>

      <Button icon={<FiPlus />} onClick={handleAddProfile} className="text-xs font-semibold">
        Add Profile
      </Button>

      <div className="flex gap-2 pt-1">
        <Button
          type="primary"
          icon={<FiPlay />}
          loading={running}
          disabled={selectedIds.length === 0}
          onClick={handleRunMatrix}
          className="flex-1 text-xs font-bold"
        >
          Run Matrix
        </Button>
        <Button icon={<FiSave />} disabled={!results} onClick={handleSaveBaseline} className="text-xs font-semibold">
          Save as Baseline
        </Button>
      </div>
    </div>
  );
}
