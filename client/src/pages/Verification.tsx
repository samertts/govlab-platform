import { useState } from "react";
import { useSamples, useVerifyResult, useUpdateSampleStatus } from "@/hooks/use-lab";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { CheckCircle, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export default function Verification() {
  const { data: samples, isLoading } = useSamples("completed");
  const [selectedSample, setSelectedSample] = useState<any>(null);

  // Filter out fully verified samples if needed, but "completed" status implies results entered but not fully reported
  
  return (
    <div className="space-y-8">
      <PageHeader 
        title="Result Verification" 
        description="Review and approve final laboratory reports."
      />

      <div className="grid gap-4">
        {isLoading ? (
          <div className="text-center">Loading...</div>
        ) : samples?.length === 0 ? (
          <div className="p-12 text-center bg-white rounded-xl border border-dashed text-slate-500">
            <CheckCircle className="h-12 w-12 mx-auto mb-4 text-slate-200" />
            No samples pending verification.
          </div>
        ) : (
          samples?.map((sample: any) => (
            <Card key={sample.id} className="border-l-4 border-l-amber-400 hover:shadow-md transition-all cursor-pointer" onClick={() => setSelectedSample(sample)}>
              <CardContent className="p-6 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-lg">{sample.patient.lastName}, {sample.patient.firstName}</h3>
                  <p className="text-sm text-slate-500">ACC: {sample.accessionNumber} • {sample.results.length} results to review</p>
                </div>
                <div className="flex items-center gap-4">
                   <div className="text-right text-sm">
                     <p className="text-slate-900 font-medium">Entered By Tech</p>
                     <p className="text-slate-500">{new Date(sample.collectionDate).toLocaleDateString()}</p>
                   </div>
                   <Button>Review</Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {selectedSample && (
        <VerificationModal 
          sample={selectedSample} 
          open={!!selectedSample} 
          onOpenChange={(o) => !o && setSelectedSample(null)} 
        />
      )}
    </div>
  );
}

function VerificationModal({ sample, open, onOpenChange }: { sample: any, open: boolean, onOpenChange: (o: boolean) => void }) {
  const { mutate: verifyResult } = useVerifyResult();
  const { mutate: updateStatus } = useUpdateSampleStatus();

  const handleVerifyAll = () => {
    // Optimistic for demo: verify each result then update status
    sample.results.forEach((r: any) => verifyResult(r.id));
    updateStatus({ id: sample.id, status: "reported" });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-teal-500" />
            Verify Results
          </DialogTitle>
          <DialogDescription>
            Accession: <span className="font-mono font-medium text-slate-900">{sample.accessionNumber}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-8 my-4">
          <div>
            <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Patient Demographics</h4>
            <div className="text-sm space-y-1">
              <p className="font-medium text-slate-900">{sample.patient.lastName}, {sample.patient.firstName}</p>
              <p>DOB: {new Date(sample.patient.dateOfBirth).toLocaleDateString()}</p>
              <p>Sex: {sample.patient.gender}</p>
              <p>MRN: {sample.patient.mrn}</p>
            </div>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Sample Details</h4>
            <div className="text-sm space-y-1">
              <p>Collected: {new Date(sample.collectionDate).toLocaleString()}</p>
              <p>Priority: {sample.priority}</p>
              <p>Clinical Notes: {sample.notes || "None"}</p>
            </div>
          </div>
        </div>

        <Separator />

        <ScrollArea className="h-[300px] pr-4">
          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b">
                <th className="pb-2 pl-2">Test</th>
                <th className="pb-2">Result</th>
                <th className="pb-2">Units</th>
                <th className="pb-2">Ref Range</th>
                <th className="pb-2 text-right pr-2">Flag</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sample.results.map((result: any) => (
                <tr key={result.id} className="group hover:bg-slate-50">
                  <td className="py-3 pl-2 font-medium">{result.testType.name}</td>
                  <td className="py-3 font-mono font-semibold text-slate-900">{result.resultValue}</td>
                  <td className="py-3 text-slate-500">{result.testType.units}</td>
                  <td className="py-3 text-slate-500">{result.testType.referenceRange}</td>
                  <td className="py-3 text-right pr-2">
                    {/* Basic logic for abnormal flag would go here based on range parsing */}
                    <span className="opacity-0 group-hover:opacity-100 text-xs bg-slate-100 px-2 py-1 rounded">Normal</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleVerifyAll} className="bg-teal-600 hover:bg-teal-700">
            Approve & Release Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
