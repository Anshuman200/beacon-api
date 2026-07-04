import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { encryptData, decryptData } from "@/lib/crypto";
import { useCollectionStore } from "./collectionStore";

export type AppTheme =  "light" | "dark";
export type WorkspaceView = "client" | "runner";

export interface OpenTab {
  requestId: string;
  collectionId: string;
}

interface SeederStore {
  activeView: WorkspaceView;
  setActiveView: (view: WorkspaceView) => void;
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  isRunning: boolean;
  setIsRunning: (isRunning: boolean) => void;
  tourActive: boolean;
  setTourActive: (active: boolean) => void;
  resetCounter: number;
  triggerReset: () => void;
  envModalOpen: boolean;
  setEnvModalOpen: (open: boolean) => void;
  importExportOpen: boolean;
  importExportCollectionId: string | null;
  openImportExport: (collectionId: string | null) => void;
  setImportExportOpen: (open: boolean) => void;

  // Open request tabs — focuses an existing tab or opens a new one; always-open,
  // no VS-Code-style preview-tab state machine.
  openTabs: OpenTab[];
  openTab: (collectionId: string, requestId: string) => void;
  closeTab: (requestId: string) => void;
  closeTabsForCollection: (collectionId: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
}

export const useSeederStore = create
<SeederStore>()(
  persist(
    (set, get) => ({
      activeView: "client",
      theme: "dark",
      isRunning: false,
      tourActive: false,
      resetCounter: 0,
      envModalOpen: false,
      importExportOpen: false,
      importExportCollectionId: null,
      openTabs: [],

      setActiveView: (activeView) => set({ activeView }),
      setTheme: (theme) => {
        if (typeof window !== "undefined") {
          localStorage.setItem("beacon-theme", theme);
        }
        set({ theme });
      },
      setIsRunning: (isRunning) => set({ isRunning }),
      setTourActive: (tourActive) => set({ tourActive }),
      setEnvModalOpen: (envModalOpen) => set({ envModalOpen }),
      openImportExport: (collectionId) => set({ importExportOpen: true, importExportCollectionId: collectionId }),
      setImportExportOpen: (importExportOpen) => set({ importExportOpen }),

      triggerReset: () => {
        // Reset collection workspace variables, requests, and history
        useCollectionStore.getState().resetCollectionStore();
        set((state) => ({
          activeView: "client",
          resetCounter: state.resetCounter + 1,
          openTabs: [],
        }));
      },

      openTab: (collectionId, requestId) => {
        const exists = get().openTabs.some((t) => t.requestId === requestId);
        if (!exists) {
          set((state) => ({ openTabs: [...state.openTabs, { collectionId, requestId }] }));
        }
        useCollectionStore.getState().setActiveCollectionId(collectionId);
        useCollectionStore.getState().setActiveRequestId(requestId);
      },

      closeTab: (requestId) => {
        const { openTabs } = get();
        const idx = openTabs.findIndex((t) => t.requestId === requestId);
        if (idx === -1) return;
        const newTabs = openTabs.filter((t) => t.requestId !== requestId);
        const wasActive = useCollectionStore.getState().activeRequestId === requestId;
        set({ openTabs: newTabs });
        if (wasActive) {
          // Prefer the tab to the right, else the one to the left, else none.
          const next = newTabs[idx] ?? newTabs[idx - 1] ?? null;
          useCollectionStore.getState().setActiveRequestId(next?.requestId ?? null);
          if (next) useCollectionStore.getState().setActiveCollectionId(next.collectionId);
        }
      },

      closeTabsForCollection: (collectionId) => set((state) => ({
        openTabs: state.openTabs.filter((t) => t.collectionId !== collectionId),
      })),

      reorderTabs: (fromIndex, toIndex) => set((state) => {
        const tabs = [...state.openTabs];
        const [moved] = tabs.splice(fromIndex, 1);
        tabs.splice(toIndex, 0, moved);
        return { openTabs: tabs };
      }),
    }),
    {
      name: "api-seeder-preferences",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => { },
            removeItem: () => { },
          };
        }
        return {
          getItem: async (name) => {
            const val = localStorage.getItem(name);
            if (!val) return null;
            return await decryptData(val);
          },
          setItem: async (name, value) => {
            const encrypted = await encryptData(value);
            localStorage.setItem(name, encrypted);
          },
          removeItem: (name) => localStorage.removeItem(name),
        };
      }),
      // No version/migrate system here (unlike collectionStore) — this is the
      // one field that used to have a third value ("system", removed). A
      // browser that persisted that before now falls back to the new default
      // (dark) instead of carrying an invalid theme forward forever.
      merge: (persisted, current) => {
        const state = { ...current, ...(persisted as Partial<SeederStore>) };
        if (state.theme !== "light" && state.theme !== "dark") {
          state.theme = "dark";
        }
        return state;
      },
    }
  )
);
