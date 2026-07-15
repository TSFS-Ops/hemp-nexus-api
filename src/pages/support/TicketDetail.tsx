/**
 * Ticket detail (customer view).
 * - Read-only header (status, priority, SLA)
 * - Customer <-> staff conversation
 * - Attachment upload with 20 MB / MIME allow-list
 * - Reply and cancel actions
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { FullPageLoader } from "@/components/ui/full-page-loader";
import { BackButton } from "@/components/BackButton";
import { useToast } from "@/hooks/use-toast";
import {
  getTicket,
  listCustomerMessages,
  postCustomerMessage,
  updateStatus,
  listAttachments,
  uploadAttachment,
  attachmentDownloadUrl,
  type SupportTicketDetail,
  type SupportMessage,
  type SupportAttachment,
} from "@/lib/support/client";
import { formatDistanceToNow } from "date-fns";
import { Paperclip, Loader2 } from "lucide-react";

export default function TicketDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { toast } = useToast();
  const [t, setT] = useState<SupportTicketDetail | null>(null);
  const [msgs, setMsgs] = useState<SupportMessage[]>([]);
  const [atts, setAtts] = useState<SupportAttachment[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [ticket, m, a] = await Promise.all([
        getTicket(id),
        listCustomerMessages(id),
        listAttachments(id),
      ]);
      setT(ticket);
      setMsgs(m);
      setAtts(a);
    } catch (e) {
      toast({
        title: "Could not load ticket",
        description: (e as Error).message,
        variant: "destructive",
      });
      nav("/support");
    }
  }, [id, nav, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function onReply() {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await postCustomerMessage(id, reply.trim());
      setReply("");
      await load();
    } catch (e) {
      toast({
        title: "Reply failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    setBusy(true);
    try {
      await updateStatus(id, "cancelled", "Cancelled by requester");
      await load();
      toast({ title: "Request cancelled" });
    } catch (e) {
      toast({
        title: "Could not cancel",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        await uploadAttachment(id, f);
      }
      await load();
      toast({ title: "Attachment uploaded" });
    } catch (e) {
      toast({
        title: "Upload failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function download(a: SupportAttachment) {
    try {
      const url = await attachmentDownloadUrl(a.storage_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast({
        title: "Download failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  }

  if (!t) return <FullPageLoader />;

  const canReply = !["closed", "cancelled"].includes(t.status);
  const canCancel = !["resolved", "closed", "cancelled"].includes(t.status);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <BackButton />

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-muted-foreground">
                    {t.ticket_number}
                  </span>
                  <Badge>{t.status.replaceAll("_", " ")}</Badge>
                  <Badge variant="outline">{t.priority}</Badge>
                </div>
                <CardTitle className="text-xl">{t.subject}</CardTitle>
                <CardDescription className="mt-1">
                  Opened{" "}
                  {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
                  {t.first_response_at
                    ? ` · first response ${formatDistanceToNow(new Date(t.first_response_at), { addSuffix: true })}`
                    : t.sla_first_response_due_at
                      ? ` · first response due ${formatDistanceToNow(new Date(t.sla_first_response_due_at), { addSuffix: true })}`
                      : ""}
                </CardDescription>
              </div>
              {canCancel && (
                <Button variant="outline" onClick={onCancel} disabled={busy}>
                  Cancel request
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {t.intended_action && (
              <div>
                <div className="font-medium">What was intended</div>
                <p className="text-muted-foreground whitespace-pre-wrap">
                  {t.intended_action}
                </p>
              </div>
            )}
            {t.actual_result && (
              <div>
                <div className="font-medium">What actually happened</div>
                <p className="text-muted-foreground whitespace-pre-wrap">
                  {t.actual_result}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conversation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {msgs.length === 0 && (
              <div className="text-sm text-muted-foreground">
                No messages yet.
              </div>
            )}
            {msgs.map((m) => (
              <div
                key={m.id}
                className="rounded-md border p-3 bg-muted/30 space-y-1"
              >
                <div className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(m.created_at), {
                    addSuffix: true,
                  })}
                </div>
                <div className="text-sm whitespace-pre-wrap">{m.body}</div>
              </div>
            ))}
            {canReply && (
              <div className="pt-2 border-t space-y-2">
                <Textarea
                  rows={3}
                  placeholder="Write a reply…"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  maxLength={4000}
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileRef}
                      type="file"
                      className="hidden"
                      multiple
                      onChange={(e) => onUpload(e.target.files)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <Paperclip className="h-4 w-4 mr-1" />
                      )}
                      Attach file
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Max 20 MB — PDF, images, docs, csv, zip
                    </span>
                  </div>
                  <Button onClick={onReply} disabled={busy || !reply.trim()}>
                    Send reply
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {atts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Attachments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {atts.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between border rounded-md p-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{a.filename}</div>
                    <div className="text-xs text-muted-foreground">
                      {(a.size_bytes / 1024).toFixed(1)} KB · scan: {a.scan_status}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => download(a)}
                    disabled={a.scan_status === "infected"}
                  >
                    {a.scan_status === "infected" ? "Blocked" : "Download"}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
