import { cn } from "@/lib/utils";

const statusStyles: Record<string, string> = {
  collected: "bg-blue-100 text-blue-700 border-blue-200",
  received: "bg-purple-100 text-purple-700 border-purple-200",
  processing: "bg-amber-100 text-amber-700 border-amber-200",
  completed: "bg-green-100 text-green-700 border-green-200",
  pending: "bg-slate-100 text-slate-600 border-slate-200",
  verified: "bg-teal-100 text-teal-700 border-teal-200",
  routine: "bg-slate-100 text-slate-600 border-slate-200",
  urgent: "bg-orange-100 text-orange-700 border-orange-200",
  stat: "bg-red-100 text-red-700 border-red-200 animate-pulse",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const styles = statusStyles[status.toLowerCase()] || "bg-gray-100 text-gray-700 border-gray-200";
  
  return (
    <span className={cn(
      "px-2.5 py-0.5 rounded-full text-xs font-medium border uppercase tracking-wide",
      styles,
      className
    )}>
      {status}
    </span>
  );
}
