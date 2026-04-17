/**
 * ProfileCompletionBanner, Shown on the dashboard when the user's full_name
 * is missing or looks like an email address.
 *
 * This is a soft gate: it prompts but doesn't block navigation.
 * Hard gates exist on BilateralMatchForm (blocks submission without a proper name).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Check, Loader2, User } from "lucide-react";
import { toast } from "sonner";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nameNeedsUpdate(fullName: string | null | undefined): boolean {
  if (!fullName || fullName.trim().length === 0) return true;
  if (EMAIL_REGEX.test(fullName.trim())) return true;
  // Single word with no spaces is suspicious (e.g. just a username)
  if (!fullName.trim().includes(" ") && fullName.trim().length < 4) return true;
  return false;
}

export function ProfileCompletionBanner() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [dismissed, setDismissed] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile-completion-check", session?.user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, org_id")
        .eq("id", session!.user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user?.id,
    staleTime: 60_000,
  });

  const updateName = useMutation({
    mutationFn: async (newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed.length < 2) throw new Error("Please enter your full name.");
      if (EMAIL_REGEX.test(trimmed)) throw new Error("Please enter your real name, not an email address.");
      if (!trimmed.includes(" ")) throw new Error("Please enter both your first and last name.");

      const { error } = await supabase
        .from("profiles")
        .update({ full_name: trimmed })
        .eq("id", session!.user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Name saved successfully.");
      queryClient.invalidateQueries({ queryKey: ["profile-completion-check"] });
      queryClient.invalidateQueries({ queryKey: ["user-profile-org"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  if (isLoading || !profile || dismissed) return null;
  if (!nameNeedsUpdate(profile.full_name)) return null;

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="py-4 px-5">
        <div className="flex items-start gap-3">
          <User className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 space-y-3">
            <div>
              <p className="text-sm font-medium text-foreground">Complete your profile</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your name appears on trade records, Proofs of Intent, and compliance documents. 
                Please enter your full legal name before creating any trades.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <Label htmlFor="profile-name" className="sr-only">Full name</Label>
                <Input
                  id="profile-name"
                  placeholder="e.g. Josh Kruger"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9"
                  disabled={updateName.isPending}
                />
              </div>
              <Button
                size="sm"
                onClick={() => updateName.mutate(name)}
                disabled={updateName.isPending || !name.trim()}
                className="h-9"
              >
                {updateName.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                )}
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDismissed(true)}
                className="h-9 text-xs text-muted-foreground"
              >
                Later
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
