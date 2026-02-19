import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import type { InsertPatient } from "@shared/schema";

export function usePatients(search?: string) {
  return useQuery({
    queryKey: [api.patients.list.path, search],
    queryFn: async () => {
      const url = search 
        ? `${api.patients.list.path}?search=${encodeURIComponent(search)}` 
        : api.patients.list.path;
      
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch patients");
      return await res.json();
    },
  });
}

export function usePatient(id: number) {
  return useQuery({
    queryKey: [api.patients.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.patients.get.path, { id });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch patient");
      return await res.json();
    },
    enabled: !!id,
  });
}

export function useCreatePatient() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertPatient) => {
      const res = await fetch(api.patients.create.path, {
        method: api.patients.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create patient");
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.patients.list.path] });
      toast({ title: "Success", description: "Patient registered successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}
