import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { 
  Lock, 
  Users, 
  Share2, 
  Loader2, 
  AlertTriangle,
  Eye,
  EyeOff
} from "lucide-react";

interface DocumentSharingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: {
    id: string;
    filename: string;
    visibility: string;
    match_id: string;
    status: string;
  };
  onVisibilityChanged: () => void;
}

export function DocumentSharingDialog({
  open,
  onOpenChange,
  document,
  onVisibilityChanged,
}: DocumentSharingDialogProps) {
  const [visibility, setVisibility] = useState(document.visibility);
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);

  const handleSave = async () => {
    if (visibility === document.visibility) {
      onOpenChange(false);
      return;
    }

    try {
      setSaving(true);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("You must be logged in to change visibility");
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/document-share/${document.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ visibility }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update visibility");
      }

      toast.success("Document visibility updated");
      onVisibilityChanged();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error updating visibility:", error);
      toast.error(error.message || "Failed to update visibility");
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async () => {
    try {
      setRevoking(true);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("You must be logged in to revoke access");
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/document-revoke/${document.id}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ 
            action: "revoke_document",
            reason: revokeReason || undefined,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to revoke access");
      }

      toast.success("Document access has been revoked");
      onVisibilityChanged();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error revoking access:", error);
      toast.error(error.message || "Failed to revoke access");
    } finally {
      setRevoking(false);
      setShowRevokeConfirm(false);
    }
  };

  const isRevoked = document.status === "revoked";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Document Sharing Settings</DialogTitle>
          <DialogDescription>
            Control who can access "{document.filename}"
          </DialogDescription>
        </DialogHeader>

        {isRevoked ? (
          <div className="py-4">
            <div className="flex items-center gap-2 text-destructive mb-4">
              <EyeOff className="h-5 w-5" />
              <span className="font-medium">This document has been revoked</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Access to this document has been revoked. The file is retained for compliance purposes but is no longer accessible to counterparties.
            </p>
          </div>
        ) : showRevokeConfirm ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-medium">Confirm Revocation</span>
            </div>
            <p className="text-sm text-muted-foreground">
              This will immediately remove access for all counterparties. The file will remain stored for compliance but will no longer be visible to others.
            </p>
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea
                placeholder="Enter reason for revocation..."
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowRevokeConfirm(false)}
                disabled={revoking}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleRevoke}
                disabled={revoking}
              >
                {revoking ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Revoking...
                  </>
                ) : (
                  "Confirm Revoke"
                )}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <RadioGroup value={visibility} onValueChange={setVisibility}>
                <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted/50">
                  <RadioGroupItem value="private" id="private" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="private" className="flex items-center gap-2 cursor-pointer">
                      <Lock className="h-4 w-4" />
                      Private
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Only your organization can view this document
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted/50">
                  <RadioGroupItem value="share_with_counterparty" id="counterparty" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="counterparty" className="flex items-center gap-2 cursor-pointer">
                      <Users className="h-4 w-4" />
                      Share with Counterparty
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Both buyer and seller organizations can view this document
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted/50">
                  <RadioGroupItem value="share_with_roles" id="roles" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="roles" className="flex items-center gap-2 cursor-pointer">
                      <Share2 className="h-4 w-4" />
                      Share with Specific Roles
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Manually grant access to specific users or organizations
                    </p>
                    {visibility === "share_with_roles" && (
                      <Badge variant="secondary" className="mt-2">
                        Advanced sharing coming soon
                      </Badge>
                    )}
                  </div>
                </div>
              </RadioGroup>

              <div className="border-t pt-4">
                <Button
                  variant="outline"
                  className="w-full text-destructive hover:text-destructive"
                  onClick={() => setShowRevokeConfirm(true)}
                >
                  <EyeOff className="h-4 w-4 mr-2" />
                  Revoke Access
                </Button>
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  Revoking will remove all access immediately
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4 mr-2" />
                    Save Changes
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
