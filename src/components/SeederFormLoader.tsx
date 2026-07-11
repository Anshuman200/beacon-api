"use client";

/**
 * Client-side wrapper that loads SeederForm with ssr:false.
 * This ensures Zustand's persist middleware has already read and decrypted
 * localStorage before the form initialValues are computed.
 */
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useSeederStore } from "@/store/seederStore";
import { useCollectionStore } from "@/store/collectionStore";

const SeederForm = dynamic(() => import("./SeederForm"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center text-slate-700 dark:text-slate-400 text-sm">
      Loading Beacon…
    </div>
  ),
});

export default function SeederFormLoader() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const checkHydration = () => {
      if (useSeederStore.persist.hasHydrated() && useCollectionStore.persist.hasHydrated()) {
        setHydrated(true);
      }
    };

    checkHydration();

    const unsubSeeder = useSeederStore.persist.onFinishHydration(checkHydration);
    const unsubCollection = useCollectionStore.persist.onFinishHydration(checkHydration);

    return () => {
      unsubSeeder();
      unsubCollection();
    };
  }, []);

  if (!hydrated) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 dark:text-slate-400 text-sm">
        Decrypting configuration workspace…
      </div>
    );
  }

  return <SeederForm />;
}
