import { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 animate-in fade-in slide-in-from-top-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold font-display text-slate-900 tracking-tight">{title}</h1>
        {description && <p className="text-slate-500 mt-2">{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
