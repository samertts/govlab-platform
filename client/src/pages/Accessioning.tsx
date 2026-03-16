import { useState } from "react";
import { usePatients } from "@/hooks/use-patients";
import { useTestTypes, useCreateSample } from "@/hooks/use-lab";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Loader2 } from "lucide-react";

export default function Accessioning() {
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTestIds, setSelectedTestIds] = useState<number[]>([]);
  const [priority, setPriority] = useState("routine");
  const [notes, setNotes] = useState("");

  const { data: patients } = usePatients(searchTerm);
  const { data: testTypes, isLoading: isLoadingTests } = useTestTypes();
  const { mutate: createSample, isPending } = useCreateSample();

  const handleCreate = () => {
    if (!selectedPatientId || selectedTestIds.length === 0) return;

    createSample({
      patientId: selectedPatientId,
      priority,
      notes,
      status: "collected",
      testTypeIds: selectedTestIds,
    }, {
      onSuccess: () => {
        // Reset form
        setSelectedPatientId(null);
        setSelectedTestIds([]);
        setPriority("routine");
        setNotes("");
        setSearchTerm("");
      }
    });
  };

  const selectedPatient = patients?.find((p: any) => p.id === selectedPatientId);

  return (
    <div className="space-y-8 pb-10">
      <PageHeader 
        title="Accessioning" 
        description="Create new sample records and assign tests."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Step 1: Select Patient */}
        <Card className="lg:col-span-2 border shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg text-primary">1. Select Patient</CardTitle>
            <CardDescription>Search for an existing patient to attach this sample to.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input 
                placeholder="Search by name or MRN..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            {selectedPatient && (
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-900">{selectedPatient.lastName}, {selectedPatient.firstName}</p>
                  <p className="text-sm text-slate-500">MRN: {selectedPatient.mrn} • DOB: {new Date(selectedPatient.dateOfBirth).toLocaleDateString()}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setSelectedPatientId(null)}>Change</Button>
              </div>
            )}

            {!selectedPatient && searchTerm.length > 0 && (
              <div className="border rounded-lg overflow-hidden divide-y">
                {patients?.slice(0, 5).map((patient: any) => (
                  <div 
                    key={patient.id} 
                    className="p-3 hover:bg-slate-50 cursor-pointer flex justify-between items-center transition-colors"
                    onClick={() => setSelectedPatientId(patient.id)}
                  >
                    <div>
                      <p className="font-medium">{patient.lastName}, {patient.firstName}</p>
                      <p className="text-xs text-slate-500">{patient.mrn}</p>
                    </div>
                    <Button size="sm" variant="ghost">Select</Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 3: Summary & Submit - Placed here for layout balance on large screens */}
        <Card className="border shadow-sm h-fit">
          <CardHeader>
            <CardTitle className="text-lg text-primary">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
               <Label>Priority</Label>
               <Select value={priority} onValueChange={setPriority}>
                 <SelectTrigger>
                   <SelectValue />
                 </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="routine">Routine</SelectItem>
                   <SelectItem value="urgent">Urgent</SelectItem>
                   <SelectItem value="stat">STAT (Emergency)</SelectItem>
                 </SelectContent>
               </Select>
            </div>

            <div className="space-y-2">
              <Label>Clinical Notes</Label>
              <Input 
                placeholder="e.g. Fasting patient" 
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="pt-4 border-t space-y-2">
              <div className="flex justify-between text-sm">
                <span>Selected Tests:</span>
                <span className="font-bold">{selectedTestIds.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Estimated Cost:</span>
                <span className="font-bold">
                  ${selectedTestIds.reduce((sum, id) => {
                    const test = testTypes?.find((t: any) => t.id === id);
                    return sum + (test?.price || 0);
                  }, 0) / 100}
                </span>
              </div>
            </div>

            <Button 
              className="w-full mt-4" 
              disabled={!selectedPatientId || selectedTestIds.length === 0 || isPending}
              onClick={handleCreate}
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Generate Accession"}
            </Button>
          </CardContent>
        </Card>

        {/* Step 2: Select Tests */}
        <Card className="lg:col-span-3 border shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg text-primary">2. Order Tests</CardTitle>
            <CardDescription>Select all applicable tests for this sample.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingTests ? (
              <div className="p-8 text-center text-muted-foreground">Loading catalog...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {testTypes?.map((test: any) => (
                  <div 
                    key={test.id} 
                    className={`
                      flex items-start gap-3 p-4 rounded-xl border transition-all cursor-pointer
                      ${selectedTestIds.includes(test.id) 
                        ? "border-primary bg-primary/5 shadow-sm" 
                        : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"}
                    `}
                    onClick={() => {
                      setSelectedTestIds(prev => 
                        prev.includes(test.id) ? prev.filter(id => id !== test.id) : [...prev, test.id]
                      );
                    }}
                  >
                    <Checkbox 
                      checked={selectedTestIds.includes(test.id)} 
                      className="mt-1"
                    />
                    <div>
                      <p className="font-semibold text-slate-900">{test.name}</p>
                      <p className="text-xs text-slate-500">{test.code} • ${test.price / 100}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
