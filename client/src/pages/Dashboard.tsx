import { useSamples } from "@/hooks/use-lab";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Clock, FileCheck, FlaskConical, AlertCircle } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: samples, isLoading } = useSamples();

  const stats = [
    { label: "Pending Tests", value: samples?.filter(s => s.status !== "completed").length || 0, icon: Clock, color: "text-amber-500", bg: "bg-amber-50" },
    { label: "Completed Today", value: samples?.filter(s => s.status === "completed").length || 0, icon: FileCheck, color: "text-green-500", bg: "bg-green-50" },
    { label: "Urgent/STAT", value: samples?.filter(s => s.priority !== "routine").length || 0, icon: AlertCircle, color: "text-red-500", bg: "bg-red-50" },
    { label: "Total Accessions", value: samples?.length || 0, icon: FlaskConical, color: "text-blue-500", bg: "bg-blue-50" },
  ];

  return (
    <div className="space-y-8">
      <PageHeader 
        title="Dashboard" 
        description="Overview of laboratory activities and pending workload."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <Card key={i} className="border-none shadow-md hover:shadow-lg transition-all duration-200">
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                <h3 className="text-3xl font-bold font-display text-slate-900 mt-2">{isLoading ? "-" : stat.value}</h3>
              </div>
              <div className={`p-4 rounded-full ${stat.bg}`}>
                <stat.icon className={`h-6 w-6 ${stat.color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="col-span-1 lg:col-span-2 border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {isLoading ? (
                <div className="h-40 flex items-center justify-center text-muted-foreground">Loading...</div>
              ) : samples?.slice(0, 5).map((sample) => (
                <div key={sample.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-white border flex items-center justify-center font-bold text-slate-700 shadow-sm">
                      {sample.patient.firstName[0]}{sample.patient.lastName[0]}
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">{sample.patient.firstName} {sample.patient.lastName}</p>
                      <p className="text-xs text-slate-500">ACC: {sample.accessionNumber}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={sample.priority} />
                    <StatusBadge status={sample.status} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>System Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Database Connection</span>
                <span className="flex h-2 w-2 rounded-full bg-green-500" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Instrument Interface</span>
                <span className="flex h-2 w-2 rounded-full bg-green-500" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">HL7 Gateway</span>
                <span className="flex h-2 w-2 rounded-full bg-green-500" />
              </div>
              
              <div className="pt-6 mt-6 border-t">
                <p className="text-xs text-slate-500 text-center">
                  Last Backup: {format(new Date(), "MMM d, HH:mm")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
