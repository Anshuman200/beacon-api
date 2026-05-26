import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { encryptData, decryptData } from "@/lib/crypto";
import { useCollectionStore } from "./collectionStore";

export type AppTheme = "system" | "light" | "dark";
export type WorkspaceView = "client" | "runner";

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
}

export const useSeederStore = create<SeederStore>()(
  persist(
    (set) => ({
      activeView: "client",
      theme: "system",
      isRunning: false,
      tourActive: false,
      resetCounter: 0,
      envModalOpen: false,

      setActiveView: (activeView) => set({ activeView }),
      setTheme: (theme) => set({ theme }),
      setIsRunning: (isRunning) => set({ isRunning }),
      setTourActive: (tourActive) => set({ tourActive }),
      setEnvModalOpen: (envModalOpen) => set({ envModalOpen }),
      
      triggerReset: () => {
        // Reset collection workspace variables, requests, and history
        useCollectionStore.getState().resetCollectionStore();
        set((state) => ({
          activeView: "client",
          resetCounter: state.resetCounter + 1,
        }));
      },
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
    }
  )
);
