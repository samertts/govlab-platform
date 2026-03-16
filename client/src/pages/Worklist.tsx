import { useState } from "react";
import { useSamples, useUpdateResult, useUpdateSampleStatus } from "@/hooks/use-lab";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Save } from "lucide-react";
import type { TestResult } from "@shared/schema";

export default function Worklist() {
  const [activeTab, setActiveTab] = useState("pending"); // pending | completed
  const { data: samples, isLoading } = useSamples();
  const [selectedSample, setSelectedSample] = useState<any>(null);

  // Filter samples client-side for this view
  const filteredSamples = samples?.filter((s: any) => {
    if (activeTab === "pending") return s.status !== "completed" && s.status !== "verified";
    return s.status === "completed" || s.status === "verified";
  });

  return (
    <div className="space-y-8">
      <PageHeader 
        title="Lab Worklist" 
        description="Enter results for pending samples."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-white border">
          <TabsTrigger value="pending">Pending Processing</TabsTrigger>
          <TabsTrigger value="completed">Completed / Reported</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-4">
        {isLoading ? (
          <div className="text-center py-12">Loading worklist...</div>
        ) : filteredSamples?.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-dashed">
            <p className="text-slate-500">No samples found in this category.</p>
          </div>
        ) : (
          filteredSamples?.map((sample: any) => (
            <Card key={sample.id} className="border shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-0">
                <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x">
                  {/* Sample Header Info */}
                  <div className="p-6 md:w-1/3 space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-lg text-slate-900">
                          {sample.patient.lastName}, {sample.patient.firstName}
                        </h3>
                        <p className="text-sm font-mono text-slate-500">{sample.accessionNumber}</p>
                      </div>
                      <StatusBadge status={sample.priority} />
                    </div>
                    <div className="text-sm text-slate-500 pt-2">
                      <p>Tests: {sample.results.length}</p>
                      <p>Collected: {new Date(sample.collectionDate!).toLocaleDateString()}</p>
                    </div>
                    <div className="pt-4">
                      <Button 
                        onClick={() => setSelectedSample(sample)}
                        className="w-full"
                        variant={activeTab === "completed" ? "outline" : "default"}
                      >
                        {activeTab === "completed" ? "View Results" : "Enter Results"}
                      </Button>
                    </div>
                  </div>

                  {/* Quick Test Preview */}
                  <div className="p-6 md:w-2/3 bg-slate-50/50">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {sample.results.map((res: any) => (
                        <div key={res.id} className="flex justify-between items-center p-3 bg-white border rounded-lg">
                          <span className="font-medium text-sm">{res.testType.name}</span>
                          {res.resultValue ? (
                            <span className="font-mono font-semibold text-primary">{res.resultValue} {res.testType.units}</span>
                          ) : (
                            <span className="text-xs text-slate-400 italic">Pending</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {selectedSample && (
        <ResultEntryDialog 
          sample={selectedSample} 
          open={!!selectedSample} 
          onOpenChange={(open) => !open && setSelectedSample(null)} 
        />
      )}
    </div>
  );
}

function ResultEntryDialog({ sample, open, onOpenChange }: { sample: any, open: boolean, onOpenChange: (o: boolean) => void }) {
  const { mutate: updateResult } = useUpdateResult();
  const { mutate: updateStatus } = useUpdateSampleStatus();
  const [localResults, setLocalResults] = useState<Record<number, string>>({});

  const handleSaveResult = (resultId: number, value: string) => {
    updateResult({ id: resultId, resultValue: value });
    setLocalResults(prev => ({ ...prev, [resultId]: value }));
  };

  const allDone = sample.results.every((r: any) => r.resultValue || localResults[r.id]);

  const handleComplete = () => {
    updateStatus({ id: sample.id, status: "completed" });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enter Results: {sample.accessionNumber}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="bg-slate-50 p-4 rounded-lg border">
            <h4 className="font-semibold text-sm text-slate-700 mb-2">Patient Details</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <p><span className="text-slate-500">Name:</span> {sample.patient.lastName}, {sample.patient.firstName}</p>
              <p><span className="text-slate-500">DOB:</span> {new Date(sample.patient.dateOfBirth).toLocaleDateString()}</p>
              <p><span className="text-slate-500">Gender:</span> {sample.patient.gender}</p>
              <p><span className="text-slate-500">Priority:</span> <span className="uppercase font-bold text-slate-700">{sample.priority}</span></p>
            </div>
          </div>

          <div className="space-y-4">
            {sample.results.map((result: any) => (
              <div key={result.id} className="p-4 border rounded-xl hover:border-primary/50 transition-colors">
                <div className="flex justify-between items-center mb-3">
                  <div>
                    <span className="font-bold text-slate-900">{result.testType.name}</span>
                    <span className="ml-2 text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{result.testType.code}</span>
                  </div>
                  {result.status === "verified" && <StatusBadge status="Verified" />}
                </div>
                
                <div className="grid grid-cols-3 gap-4 items-center">
                  <div className="col-span-2">
                    <Label className="text-xs text-muted-foreground mb-1 block">Result Value</Label>
                    <div className="flex gap-2">
                      <Input 
                        defaultValue={result.resultValue || ""} 
                        onBlur={(e) => handleSaveResult(result.id, e.target.value)}
                        placeholder="Enter value"
                        className="font-mono"
                      />
                      <div className="flex items-center justify-center bg-slate-100 px-3 rounded-md border text-sm text-slate-600 min-w-[3rem]">
                        {result.testType.units || "-"}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 border-l pl-4">
                    <p className="font-medium mb-1">Ref Range</p>
                    <p>{result.testType.referenceRange || "N/A"}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            <Button onClick={handleComplete} disabled={!allDone} className={allDone ? "bg-green-600 hover:bg-green-700" : ""}>
              {allDone ? "Mark as Completed" : "Enter All Results First"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
