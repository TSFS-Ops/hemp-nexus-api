import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle, CheckCircle, XCircle, Play, RotateCcw, Download,
  Shield, Clock, Hash, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface StepResult {
  stepNumber: number;
  name: string;
  type: "positive" | "negative";
  status: "pending" | "running" | "pass" | "fail";
  result?: any;
  error?: string;
  timestamp?: string;
}

const POSITIVE_STEPS: Omit<StepResult, "status">[] = [
  { stepNumber: 1, name: "Create demo organisations (Buyer + Seller)", type: "positive" },
  { stepNumber: 2, name: "Upload KYC documents for both orgs", type: "positive" },
  { stepNumber: 3, name: "Run sanctions & PEP screening", type: "positive" },
  { stepNumber: 4, name: "Compute deterministic risk scores", type: "positive" },
  { stepNumber: 5, name: "Approval workflow enforcement", type: "positive" },
  { stepNumber: 6, name: "Write 'Approved to Trade' status", type: "positive" },
  { stepNumber: 7, name: "Pre-flight validation (non-binding)", type: "positive" },
  { stepNumber: 8, name: "POI Collapse (binding event)", type: "positive" },
  { stepNumber: 9, name: "Generate Evidence Pack v1", type: "positive" },
];

const NEGATIVE_STEPS: Omit<StepResult, "status">[] = [
  { stepNumber: 10, name: "Missing mandatory field → rejected", type: "negative" },
  { stepNumber: 11, name: "Invalid ECDSA signature → rejected", type: "negative" },
  { stepNumber: 12, name: "Collapse before approvals → rejected", type: "negative" },
  { stepNumber: 13, name: "Mutate collapsed record → impossible", type: "negative" },
  { stepNumber: 14, name: "Idempotency burst → only 1 record", type: "negative" },
];

const ACTION_MAP: Record<number, string> = {
  1: "step_1_create_orgs",
  2: "step_2_upload_kyc",
  3: "step_3_screening",
  4: "step_4_risk_score",
  5: "step_5_approval_workflow",
  6: "step_6_trade_approval",
  7: "step_7_preflight",
  8: "step_8_collapse",
  9: "step_9_evidence_pack",
  10: "negative_missing_field",
  11: "negative_invalid_signature",
  12: "negative_collapse_before_approval",
  13: "negative_mutate_collapsed",
  14: "negative_idempotency_burst",
};

export function CheckpointDemo() {
  const { user, roles } = useAuth();
  const [runId, setRunId] = useState<string | null>(null);
  const [orgAId, setOrgAId] = useState<string | null>(null);
  const [orgBId, setOrgBId] = useState<string | null>(null);
  const [collapseId, setCollapseId] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepResult[]>([
    ...POSITIVE_STEPS.map(s => ({ ...s, status: "pending" as const })),
    ...NEGATIVE_STEPS.map(s => ({ ...s, status: "pending" as const })),
  ]);
  const [isRunning, setIsRunning] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);

  // Use refs to avoid stale closures in sequential runAll loops
  const orgARef = useRef<string | null>(null);
  const orgBRef = useRef<string | null>(null);
  const collapseRef = useRef<string | null>(null);
  const runIdRef = useRef<string | null>(null);

  const allowedRoles = ["platform_admin", "admin", "director", "api_admin"];
  const hasAccess = roles.some(r => allowedRoles.includes(r));

  const callDemo = async (action: string, stepData?: any) => {
    let { data: { session } } = await supabase.auth.getSession();

    const isExpiringSoon = session?.expires_at
      ? session.expires_at * 1000 < Date.now() + 30_000
      : true;

    if (!session || isExpiringSoon) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshed.session) {
        throw new Error("Session expired. Please sign in again.");
      }
      session = refreshed.session;
    }

    // Use fetch directly to handle non-2xx responses gracefully
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/checkpoint-demo`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ action, run_id: runIdRef.current, step_data: stepData }),
    });

    const data = await response.json();

    if (!response.ok) {
      // For negative tests, non-2xx is expected — return the data with success info
      return { ...data, _httpStatus: response.status, _isError: true };
    }

    return { ...data, _httpStatus: response.status, _isError: false };
  };

  const updateStep = (stepNumber: number, updates: Partial<StepResult>) => {
    setSteps(prev => prev.map(s => s.stepNumber === stepNumber ? { ...s, ...updates } : s));
  };

  const createRun = async () => {
    try {
      const data = await callDemo("create_run");
      const newRunId = data.run?.run_id;
      setRunId(newRunId);
      runIdRef.current = newRunId;
      toast.success(`Run created: ${newRunId}`);
      return newRunId;
    } catch (err: any) {
      toast.error(`Failed to create run: ${err.message}`);
      return null;
    }
  };

  const resetDemo = async () => {
    try {
      await callDemo("reset_demo_data");
      setSteps(prev => prev.map(s => ({ ...s, status: "pending" as const, result: undefined, error: undefined, timestamp: undefined })));
      setOrgAId(null); orgARef.current = null;
      setOrgBId(null); orgBRef.current = null;
      setCollapseId(null); collapseRef.current = null;
      setRunId(null); runIdRef.current = null;
      toast.success("Demo data reset successfully");
    } catch (err: any) {
      toast.error(`Reset failed: ${err.message}`);
    }
    setShowResetDialog(false);
  };

  const runStep = useCallback(async (stepNumber: number) => {
    const action = ACTION_MAP[stepNumber];
    if (!action) return;

    updateStep(stepNumber, { status: "running" });

    try {
      const stepData: any = {};
      if (orgARef.current) stepData.org_a_id = orgARef.current;
      if (orgBRef.current) stepData.org_b_id = orgBRef.current;
      if (collapseRef.current) stepData.collapse_id = collapseRef.current;

      const data = await callDemo(action, stepData);

      // Extract org IDs from step 1
      if (stepNumber === 1 && data.org_a && data.org_b) {
        setOrgAId(data.org_a.id); orgARef.current = data.org_a.id;
        setOrgBId(data.org_b.id); orgBRef.current = data.org_b.id;
      }

      // Extract collapse ID from step 8
      if (stepNumber === 8 && data.collapse?.collapse_id) {
        setCollapseId(data.collapse.collapse_id);
        collapseRef.current = data.collapse.collapse_id;
      }

      // Determine pass/fail
      const isNegativeTest = stepNumber >= 10;
      let passed: boolean;

      if (isNegativeTest) {
        // Negative tests: the edge function returns success:true/false based on its own logic
        // If the call itself errored but the function handled it, check the data
        passed = data.success === true;
      } else {
        passed = data.success !== false && !data._isError;
      }

      updateStep(stepNumber, {
        status: passed ? "pass" : "fail",
        result: data,
        error: !passed && data._isError ? (data.error || data.message || `HTTP ${data._httpStatus}`) : undefined,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      updateStep(stepNumber, {
        status: "fail",
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }, []);

  const runAllPositive = async () => {
    setIsRunning(true);
    if (!runIdRef.current) await createRun();
    for (let i = 1; i <= 9; i++) {
      await runStep(i);
      await new Promise(r => setTimeout(r, 500));
    }
    setIsRunning(false);
  };

  const runAllNegative = async () => {
    setIsRunning(true);
    for (let i = 10; i <= 14; i++) {
      await runStep(i);
      await new Promise(r => setTimeout(r, 500));
    }
    setIsRunning(false);
  };

  const runAll = async () => {
    setIsRunning(true);
    if (!runIdRef.current) await createRun();
    for (let i = 1; i <= 14; i++) {
      await runStep(i);
      await new Promise(r => setTimeout(r, 500));
    }
    // Complete run
    if (runIdRef.current) {
      try { await callDemo("complete_run"); } catch {}
    }
    setIsRunning(false);
  };

  const downloadBundle = () => {
    const bundle = {
      run_id: runId,
      generated_at: new Date().toISOString(),
      actor: user?.email,
      environment: "sandbox",
      steps: steps.map(s => ({
        step: s.stepNumber,
        name: s.name,
        type: s.type,
        status: s.status,
        result: s.result,
        error: s.error,
        timestamp: s.timestamp,
      })),
      summary: {
        total: steps.length,
        passed: steps.filter(s => s.status === "pass").length,
        failed: steps.filter(s => s.status === "fail").length,
        pending: steps.filter(s => s.status === "pending").length,
      },
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `checkpoint-demo-${runId || "bundle"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const passCount = steps.filter(s => s.status === "pass").length;
  const failCount = steps.filter(s => s.status === "fail").length;
  const pendingCount = steps.filter(s => s.status === "pending").length;

  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case "pass": return <CheckCircle className="h-5 w-5 text-primary" />;
      case "fail": return <XCircle className="h-5 w-5 text-destructive" />;
      case "running": return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
      default: return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  if (!hasAccess) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <Shield className="h-12 w-12 mx-auto text-destructive mb-2" />
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You require Director or API Admin privileges to access the checkpoint demo.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            16 April Checkpoint Demo Pack
          </h2>
          <p className="text-muted-foreground mt-1">
            Test harness running against real services. Sandbox environment only.
          </p>
        </div>
        <Badge variant="outline" className="text-xs font-mono">
          <Shield className="h-3 w-3 mr-1" />
          Director Access
        </Badge>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-3">
            {!runId ? (
              <Button onClick={createRun} variant="default">
                <Hash className="h-4 w-4 mr-2" />
                Generate Run ID
              </Button>
            ) : (
              <Badge variant="secondary" className="font-mono text-xs px-3 py-1.5">
                Run: {runId}
              </Badge>
            )}
            <Button onClick={runAll} disabled={isRunning} variant="default">
              <Play className="h-4 w-4 mr-2" />
              {isRunning ? "Running…" : "Run All Steps"}
            </Button>
            <Button onClick={runAllPositive} disabled={isRunning} variant="outline">
              Run Positive Path
            </Button>
            <Button onClick={runAllNegative} disabled={isRunning || !orgAId} variant="outline">
              Run Negative Tests
            </Button>
            <Button onClick={() => setShowResetDialog(true)} variant="destructive" size="sm">
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset Demo Data
            </Button>
            <Button onClick={downloadBundle} variant="outline" size="sm" disabled={passCount === 0}>
              <Download className="h-4 w-4 mr-2" />
              Download Evidence Bundle
            </Button>
          </div>

          {/* Summary bar */}
          <div className="flex gap-4 mt-4 text-sm">
            <span className="flex items-center gap-1.5">
              <CheckCircle className="h-4 w-4 text-primary" /> {passCount} passed
            </span>
            <span className="flex items-center gap-1.5">
              <XCircle className="h-4 w-4 text-destructive" /> {failCount} failed
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-muted-foreground" /> {pendingCount} pending
            </span>
          </div>

          {/* Org context */}
          {orgAId && (
            <div className="mt-3 flex gap-4 text-xs font-mono text-muted-foreground">
              <span>Buyer: {orgAId}</span>
              <span>Seller: {orgBId}</span>
              {collapseId && <span>Collapse: {collapseId}</span>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Positive Path */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Positive Path (Steps 1–9)</CardTitle>
          <CardDescription>Full lifecycle: KYC → Screening → Risk → Approvals → Collapse → Evidence</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {steps.filter(s => s.type === "positive").map(step => (
            <div key={step.stepNumber} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
              <StatusIcon status={step.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">Step {step.stepNumber}</span>
                  <span className="text-sm text-muted-foreground">{step.name}</span>
                </div>
                {step.timestamp && (
                  <span className="text-xs text-muted-foreground">{new Date(step.timestamp).toLocaleTimeString()}</span>
                )}
                {step.result && (
                  <ScrollArea className="mt-2 max-h-32">
                    <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(step.result, null, 2).slice(0, 500)}
                      {JSON.stringify(step.result, null, 2).length > 500 ? "…" : ""}
                    </pre>
                  </ScrollArea>
                )}
                {step.error && (
                  <p className="text-xs text-destructive mt-1">{step.error}</p>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => runStep(step.stepNumber)}
                disabled={isRunning || step.status === "running"}
              >
                <Play className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Negative Tests */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Negative Path Tests
          </CardTitle>
          <CardDescription>Verify enforcement rules block invalid operations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {steps.filter(s => s.type === "negative").map(step => (
            <div key={step.stepNumber} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
              <StatusIcon status={step.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">NEG-{step.stepNumber - 9}</Badge>
                  <span className="text-sm text-muted-foreground">{step.name}</span>
                </div>
                {step.timestamp && (
                  <span className="text-xs text-muted-foreground">{new Date(step.timestamp).toLocaleTimeString()}</span>
                )}
                {step.result && (
                  <ScrollArea className="mt-2 max-h-32">
                    <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(step.result, null, 2).slice(0, 500)}
                      {JSON.stringify(step.result, null, 2).length > 500 ? "…" : ""}
                    </pre>
                  </ScrollArea>
                )}
                {step.error && (
                  <p className="text-xs text-destructive mt-1">{step.error}</p>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => runStep(step.stepNumber)}
                disabled={isRunning || step.status === "running"}
              >
                <Play className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Reset confirmation */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Demo Data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete all demo tenant organisations and their associated data (KYC, screenings, risk scores, approvals, collapse records). This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={resetDemo}>Reset Demo Data</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
