import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, CheckCircle, Shield, Lock, Hash, Calendar, FileText } from "lucide-react";

interface DemoConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  queryContext?: {
    product?: string;
    location?: string;
    role?: string;
  };
}

export function DemoConfirmDialog({ open, onOpenChange, selectedCount, queryContext }: DemoConfirmDialogProps) {
  // Generate fake evidence data for the demo
  const demoMatchId = `demo-match-${Date.now().toString(36)}`;
  const demoHash = `sha256:${Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}...`;
  const demoTimestamp = new Date().toISOString();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Preview Only
          </DialogTitle>
          <DialogDescription>
            This is a preview of what a real proof-of-intent record would look like.
            Sign in to create real matches and evidence records.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Preview Notice Banner */}
          <div className="p-4 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div className="flex items-start gap-3">
              <Lock className="h-5 w-5 text-amber-600 mt-0.5" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  No record created
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  This is a preview. Create an account to generate real proof-of-intent records that are cryptographically signed and stored on the compliance ledger.
                </p>
              </div>
            </div>
          </div>

          {/* Sample Evidence Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Sample Evidence Summary
                <Badge variant="secondary" className="ml-auto">Preview</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Match ID</span>
                  <p className="font-mono text-xs mt-1">{demoMatchId}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Timestamp</span>
                  <p className="font-mono text-xs mt-1">{demoTimestamp}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Counterparties Selected</span>
                  <p className="font-semibold mt-1">{selectedCount}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Intent Type</span>
                  <p className="font-semibold mt-1 capitalize">{queryContext?.role || "Buyer"} Interest</p>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Hash className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Payload Hash:</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded">{demoHash}</code>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Evidence Chain:</span>
                  <span className="text-xs">Would link to previous event hash</span>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <p className="text-sm font-medium">What would be recorded:</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-3 w-3 text-green-500" />
                    Cryptographic hash of your intent
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-3 w-3 text-green-500" />
                    Timestamp with millisecond precision
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-3 w-3 text-green-500" />
                    Chain link to previous events (tamper-evident)
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-3 w-3 text-green-500" />
                    Webhook delivery to your registered endpoints
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Continue Exploring
          </Button>
          <Link to="/auth" className="w-full sm:w-auto">
            <Button className="w-full">
              <Shield className="h-4 w-4 mr-2" />
              Sign Up for Real Proofs
            </Button>
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
