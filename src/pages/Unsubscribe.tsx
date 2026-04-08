import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, XCircle, Loader2, MailX } from "lucide-react";

type Status = "loading" | "valid" | "already" | "invalid" | "confirming" | "done" | "error";

export default function Unsubscribe() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    fetch(`${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`, {
      headers: { apikey: anonKey },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.valid === false && data.reason === "already_unsubscribed") {
          setStatus("already");
        } else if (data.valid) {
          setStatus("valid");
        } else {
          setStatus("invalid");
        }
      })
      .catch(() => setStatus("error"));
  }, [token]);

  const handleConfirm = async () => {
    if (!token) return;
    setStatus("confirming");
    try {
      const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", {
        body: { token },
      });
      if (error) throw error;
      if (data?.success) {
        setStatus("done");
      } else if (data?.reason === "already_unsubscribed") {
        setStatus("already");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2 text-foreground">
            <MailX className="h-5 w-5" />
            Email Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {status === "loading" && (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-muted-foreground">Validating your request...</p>
            </div>
          )}

          {status === "valid" && (
            <>
              <p className="text-muted-foreground">
                Click below to unsubscribe from future emails. You will no longer receive
                transactional notifications from Izenzo.
              </p>
              <Button onClick={handleConfirm} variant="destructive" className="w-full">
                Confirm Unsubscribe
              </Button>
            </>
          )}

          {status === "confirming" && (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-muted-foreground">Processing...</p>
            </div>
          )}

          {status === "done" && (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle className="h-10 w-10 text-green-600" />
              <p className="text-foreground font-medium">You have been unsubscribed.</p>
              <p className="text-sm text-muted-foreground">
                You will no longer receive emails from this service.
              </p>
            </div>
          )}

          {status === "already" && (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle className="h-10 w-10 text-muted-foreground" />
              <p className="text-foreground font-medium">Already unsubscribed.</p>
              <p className="text-sm text-muted-foreground">
                This email address was previously removed from our mailing list.
              </p>
            </div>
          )}

          {status === "invalid" && (
            <div className="flex flex-col items-center gap-2">
              <XCircle className="h-10 w-10 text-destructive" />
              <p className="text-foreground font-medium">Invalid or expired link.</p>
              <p className="text-sm text-muted-foreground">
                This unsubscribe link is no longer valid. Contact support@izenzo.co.za if you need help.
              </p>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-2">
              <XCircle className="h-10 w-10 text-destructive" />
              <p className="text-foreground font-medium">Something went wrong.</p>
              <p className="text-sm text-muted-foreground">
                Please try again later or contact support@izenzo.co.za.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
