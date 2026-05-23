import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PublicPageLayout } from "@/components/PublicPageLayout";
import { Download, Printer } from "lucide-react";
const phases = [{
  title: "Phase 1 - Entity Onboarding & Due Diligence (~2 min)",
  steps: ["Create buyer and seller organisations", "Register entities, UBO ownership, and ATB records", "Upload KYC documents", "Run sanctions/PEP screening", "Compute risk scores", "Complete approval workflow", "Issue Approved-to-Trade certification"]
}, {
  title: "Phase 2 - Discovery & Matching (~1.5 min)",
  steps: ["Create buyer and seller signals", "Run match discovery", "Send invite", "Send trade request (1 credit burn at $1.00 USD/credit)"]
}, {
  title: "Phase 3 - Intent Lifecycle & Collapse (~2 min)",
  steps: ["Run pre-flight checks", "Compute intent completion probability (must be ≥ 50.1%)", "Execute signed intent collapse"]
}, {
  title: "Phase 4 - Evidence & Final Output (~1.5 min)",
  steps: ["Generate Evidence Pack v1", "Confirm Signed Deal with hard-gate validations", "Collect buyer + seller attestations", "Seal Signed Deal (hash chain)", "Export certificate", "Export full audit log"]
}];
const verificationChecklist = ["Screening is clear and within 30 days for both parties", "Risk band is not high/critical for both parties", "Both parties are Approved to Trade", "Intent completion probability is ≥ 50.1%", "Collapse ledger entry created and hash-recorded", "Signed Deal sealed with attestations", "Evidence Pack export generated", "Audit trail export contains lifecycle events across the recorded workflow"];
export default function WalkthroughReport() {
  const onDownloadPdf = () => {
    window.print();
  };
  return <PublicPageLayout>

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 print:max-w-none print:px-0 print:py-0">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-4 print:hidden">
          <p className="text-sm text-muted-foreground">
            Use <strong>Download PDF</strong>, then choose <strong>Save as PDF</strong> in your browser print dialogue.
          </p>
          <Button onClick={onDownloadPdf} className="gap-2">
            <Download className="h-4 w-4" />
            Download PDF
          </Button>
        </div>

        <header className="mb-6 space-y-3">
          <Badge variant="outline">System-level Walkthrough</Badge>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl"> Complete End-to-End Happy Path (5 to 8 min) </h1>
          <p className="text-muted-foreground">
            Goal: prove the platform works as one integrated system - from onboarding to verification to evidence-backed output.
          </p>
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <span className="rounded-md border bg-background px-3 py-1">Duration: 5 to 8 min</span>
            <span className="rounded-md border bg-background px-3 py-1">Steps: 19</span>
            <span className="rounded-md border bg-background px-3 py-1">Outcome: Sealed Signed Deal + Evidence Pack + Audit Export</span>
          </div>
        </header>

        <section className="space-y-4">
          {phases.map((phase, phaseIndex) => <Card key={phase.title} className="break-inside-avoid print:shadow-none">
              <CardHeader>
                <CardTitle className="text-xl">{phase.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2">
                  {phase.steps.map((step, stepIndex) => {
                const stepNumber = phases.slice(0, phaseIndex).reduce((acc, p) => acc + p.steps.length, 0) + stepIndex + 1;
                return <li key={step} className="flex gap-3">
                        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
                          {stepNumber}
                        </span>
                        <span>{step}</span>
                      </li>;
              })}
                </ol>
              </CardContent>
            </Card>)}
        </section>

        <section className="mt-8 break-inside-avoid rounded-lg border p-5">
          <h2 className="mb-3 text-xl font-semibold">Hard-Gates Confirmed in This Walkthrough</h2>
          <ul className="space-y-2 text-sm">
            <li>• Signed Deal enforces screening freshness (≤ 30 days)</li>
            <li>• Signed Deal rejects high/critical risk bands</li>
            <li>• Governance credit burn is atomic</li>
            <li>• Collapse requires POI probability ≥ 50.1%</li>
          </ul>
        </section>

        <section className="mt-8 break-inside-avoid rounded-lg border p-5">
          <h2 className="mb-3 text-xl font-semibold">Verification Checklist</h2>
          <ul className="space-y-2">
            {verificationChecklist.map(item => <li key={item} className="flex items-start gap-2 text-sm">
                <Printer className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{item}</span>
              </li>)}
          </ul>
        </section>
      </main>
    </PublicPageLayout>;
}