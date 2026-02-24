import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUpdateResult, useUpdateSampleStatus } from "@/hooks/use-lab";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, AlertTriangle, CheckCircle2, Clock, Beaker } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface BenchItem {
  sampleId: number;
  barcode: string;
  accessionNumber: string;
  patientName: string;
  patientMrn: string;
  analyzerType: string | null;
  priority: string | null;
  collectionDate: string | null;
  pendingTests: {
    resultId: number;
    testCode: string;
    testName: string;
    units: string | null;
    referenceRange: string | null;
  }[];
  enteredTests: {
    resultId: number;
    testCode: string;
    testName: string;
    value: string | null;
    qcFlag: string | null;
    units: string | null;
  }[];
}

function QcBadge({ flag }: { flag: string | null }) {
  if (!flag) return null;
  const variant = flag === "Critical" ? "destructive" : flag === "High" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className={
      flag === "Critical" ? "bg-red-600 animate-pulse" :
      flag === "High" ? "bg-amber-500 text-white" :
      "bg-blue-100 text-blue-800"
    } data-testid={`badge-qc-${flag.toLowerCase()}`}>
      {flag === "Critical" && <AlertTriangle className="h-3 w-3 mr-1" />}
      {flag}
    </Badge>
  );
}

export default function TechnicianBench() {
  const [analyzerFilter, setAnalyzerFilter] = useState("all");
  const [resultValues, setResultValues] = useState<Record<number, string>>({});
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: queue, isLoading } = useQuery<BenchItem[]>({
    queryKey: ["/api/sovereign/bench/queue", analyzerFilter],
    queryFn: async () => {
      const params = analyzerFilter !== "all" ? `?analyzerType=${analyzerFilter}` : "";
      const res = await fetch(`/api/sovereign/bench/queue${params}`);
      if (!res.ok) throw new Error("Failed to fetch bench queue");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const { mutate: updateResult, isPending: isSaving } = useUpdateResult();
  const { mutate: updateStatus } = useUpdateSampleStatus();

  const handleResultEntry = (resultId: number) => {
    const value = resultValues[resultId];
    if (!value?.trim()) return;
    updateResult({ id: resultId, resultValue: value }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/sovereign/bench/queue"] });
      }
    });
  };

  const handleCompleteSample = (sampleId: number) => {
    updateStatus({ id: sampleId, status: "completed" }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/sovereign/bench/queue"] });
        toast({ title: "Complete", description: "Sample marked as completed" });
      }
    });
  };

  const totalPending = queue?.reduce((sum, item) => sum + item.pendingTests.length, 0) || 0;
  const totalEntered = queue?.reduce((sum, item) => sum + item.enteredTests.length, 0) || 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Technician Bench"
        description="Focused sample processing queue. Enter results and manage QC flags."
      />

      <div className="flex flex-wrap gap-4 items-center" data-testid="bench-controls">
        <div className="flex items-center gap-2">
          <Beaker className="h-4 w-4 text-slate-500" />
          <Select value={analyzerFilter} onValueChange={setAnalyzerFilter}>
            <SelectTrigger className="w-48" data-testid="select-analyzer-filter">
              <SelectValue placeholder="All Analyzers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Analyzers</SelectItem>
              <SelectItem value="CBC">CBC / Hematology</SelectItem>
              <SelectItem value="Chemistry">Chemistry</SelectItem>
              <SelectItem value="Immunoassay">Immunoassay</SelectItem>
              <SelectItem value="Coagulation">Coagulation</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-3 ml-auto">
          <div className="flex items-center gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-3 py-1.5 text-sm font-medium" data-testid="stat-pending">
            <Clock className="h-4 w-4" />
            {totalPending} Pending
          </div>
          <div className="flex items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg px-3 py-1.5 text-sm font-medium" data-testid="stat-entered">
            <CheckCircle2 className="h-4 w-4" />
            {totalEntered} Entered
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !queue?.length ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed" data-testid="empty-queue">
          <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Bench is clear</p>
          <p className="text-sm text-slate-400">No samples awaiting processing.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {queue.map((item) => (
            <Card key={item.sampleId} className={`border shadow-sm ${item.priority === "urgent" ? "border-red-300 bg-red-50/30" : ""}`} data-testid={`bench-item-${item.sampleId}`}>
              <CardContent className="p-0">
                <div className="flex items-center justify-between p-4 border-b bg-slate-50/80">
                  <div className="flex items-center gap-4">
                    <div>
                      <span className="font-mono text-sm font-bold text-primary" data-testid={`text-barcode-${item.sampleId}`}>{item.barcode}</span>
                      <p className="text-sm font-medium text-slate-900" data-testid={`text-patient-${item.sampleId}`}>{item.patientName}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">{item.patientMrn}</Badge>
                    {item.analyzerType && <Badge variant="secondary" className="text-xs">{item.analyzerType}</Badge>}
                    {item.priority === "urgent" && <Badge variant="destructive" className="text-xs">URGENT</Badge>}
                  </div>
                  {item.pendingTests.length === 0 && (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => handleCompleteSample(item.sampleId)}
                      data-testid={`button-complete-${item.sampleId}`}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Complete
                    </Button>
                  )}
                </div>

                <div className="p-4">
                  {item.pendingTests.length > 0 && (
                    <div className="mb-4">
                      <h4 className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-2">Pending Entry</h4>
                      <div className="space-y-2">
                        {item.pendingTests.map((test) => (
                          <div key={test.resultId} className="flex items-center gap-3 p-3 bg-white border rounded-lg" data-testid={`pending-test-${test.resultId}`}>
                            <div className="flex-1 min-w-0">
                              <span className="font-medium text-sm text-slate-900">{test.testName}</span>
                              <span className="ml-2 text-xs text-slate-400 font-mono">{test.testCode}</span>
                              {test.referenceRange && (
                                <span className="ml-2 text-xs text-slate-500">Ref: {test.referenceRange}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Input
                                className="w-32 font-mono text-sm"
                                placeholder="Value"
                                value={resultValues[test.resultId] || ""}
                                onChange={(e) => setResultValues(prev => ({ ...prev, [test.resultId]: e.target.value }))}
                                onKeyDown={(e) => e.key === "Enter" && handleResultEntry(test.resultId)}
                                data-testid={`input-result-${test.resultId}`}
                              />
                              <span className="text-xs text-slate-500 min-w-[2rem]">{test.units || ""}</span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleResultEntry(test.resultId)}
                                disabled={!resultValues[test.resultId]?.trim() || isSaving}
                                data-testid={`button-save-${test.resultId}`}
                              >
                                <Save className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {item.enteredTests.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-2">Results Entered</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {item.enteredTests.map((test) => (
                          <div key={test.resultId} className="flex items-center justify-between p-2 bg-blue-50/50 border border-blue-100 rounded-lg" data-testid={`entered-test-${test.resultId}`}>
                            <span className="text-sm font-medium">{test.testName}</span>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-sm">{test.value} {test.units}</span>
                              <QcBadge flag={test.qcFlag} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
