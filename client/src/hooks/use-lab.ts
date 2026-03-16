import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import type { InsertSample, TestType, SampleWithPatient, TestResult } from "@shared/schema";

// === TEST TYPES ===
export function useTestTypes() {
  return useQuery<TestType[]>({
    queryKey: [api.testTypes.list.path],
    queryFn: async () => {
      const res = await fetch(api.testTypes.list.path);
      if (!res.ok) throw new Error("Failed to fetch test types");
      return await res.json();
    },
  });
}

// === SAMPLES ===
export function useSamples(status?: string, patientId?: number) {
  return useQuery<SampleWithPatient[]>({
    queryKey: [api.samples.list.path, status, patientId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status) params.append("status", status);
      if (patientId) params.append("patientId", patientId.toString());
      
      const url = `${api.samples.list.path}?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch samples");
      return await res.json();
    },
  });
}

export function useSample(id: number) {
  return useQuery<SampleWithPatient>({
    queryKey: [api.samples.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.samples.get.path, { id });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch sample");
      return await res.json();
    },
    enabled: !!id,
  });
}

export function useCreateSample() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertSample & { testTypeIds: number[] }) => {
      const res = await fetch(api.samples.create.path, {
        method: api.samples.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create sample");
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.samples.list.path] });
      toast({ title: "Success", description: "Sample accessioned successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateSampleStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const url = buildUrl(api.samples.updateStatus.path, { id });
      const res = await fetch(url, {
        method: api.samples.updateStatus.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.samples.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.samples.get.path] });
      toast({ title: "Updated", description: "Sample status updated" });
    },
  });
}

// === RESULTS ===
export function useUpdateResult() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation<TestResult, Error, { id: number; resultValue: string; notes?: string }>({
    mutationFn: async ({ id, resultValue, notes }: { id: number; resultValue: string; notes?: string }) => {
      const url = buildUrl(api.results.update.path, { id });
      const res = await fetch(url, {
        method: api.results.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resultValue, notes }),
      });
      if (!res.ok) throw new Error("Failed to enter result");
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.samples.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.samples.get.path] });
      toast({ title: "Saved", description: "Result saved successfully" });
    },
  });
}

export function useVerifyResult() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.results.verify.path, { id });
      const res = await fetch(url, { method: api.results.verify.method });
      if (!res.ok) throw new Error("Failed to verify result");
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.samples.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.samples.get.path] });
      toast({ title: "Verified", description: "Result verified successfully" });
    },
  });
}
