import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface OfflineOperation {
  operationType: string;
  endpoint: string;
  method: string;
  payload?: any;
  timestamp: number;
}

const OFFLINE_QUEUE_KEY = "govlab_offline_queue";

function getLocalQueue(): OfflineOperation[] {
  try {
    const stored = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveLocalQueue(queue: OfflineOperation[]) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

export function useOfflineMode() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [localQueue, setLocalQueue] = useState<OfflineOperation[]>(getLocalQueue);
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const enqueue = useCallback((op: Omit<OfflineOperation, "timestamp">) => {
    const operation: OfflineOperation = { ...op, timestamp: Date.now() };
    const updated = [...localQueue, operation];
    setLocalQueue(updated);
    saveLocalQueue(updated);
  }, [localQueue]);

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (localQueue.length === 0) return { synced: 0 };

      const res = await fetch("/api/sovereign/offline/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operations: localQueue }),
      });
      if (!res.ok) throw new Error("Failed to sync offline operations");

      const syncRes = await fetch("/api/sovereign/offline/sync", { method: "POST" });
      if (!syncRes.ok) throw new Error("Failed to process synced operations");
      return syncRes.json();
    },
    onSuccess: () => {
      setLocalQueue([]);
      saveLocalQueue([]);
      queryClient.invalidateQueries();
    },
  });

  useEffect(() => {
    if (isOnline && localQueue.length > 0) {
      syncMutation.mutate();
    }
  }, [isOnline]);

  const { data: serverPending } = useQuery({
    queryKey: ["/api/sovereign/offline/pending"],
    enabled: isOnline,
    refetchInterval: 30000,
  });

  return {
    isOnline,
    localQueueLength: localQueue.length,
    serverPendingCount: (serverPending as any[])?.length || 0,
    enqueue,
    sync: syncMutation.mutate,
    isSyncing: syncMutation.isPending,
  };
}
