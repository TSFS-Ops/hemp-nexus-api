import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { InlineLoader } from "@/components/ui/inline-loader";
import { LoadingButton } from "@/components/ui/loading-button";
import { useDataFetch } from "@/hooks/use-data-fetch";
import { useDraftPersistence } from "@/hooks/use-draft-persistence";

interface Note {
  id: string;
  content: string;
  user_id: string;
  created_at: string;
}

interface MatchNotesProps {
  matchId: string;
  orgId: string;
}

export function MatchNotes({ matchId, orgId }: MatchNotesProps) {
  const { user } = useAuth();
  const [newNote, setNewNote] = useState("");
  const [posting, setPosting] = useState(false);

  const getCurrentDraft = useCallback(() => {
    if (!newNote.trim()) return null;
    return { content: newNote };
  }, [newNote]);

  const { restoreDraft, clearDraft, hasRestoredDraft } = useDraftPersistence<{ content: string }>(
    `match-note-${matchId}`,
    getCurrentDraft
  );

  useEffect(() => {
    if (hasRestoredDraft) {
      const draft = restoreDraft();
      if (draft?.content) {
        setNewNote(draft.content);
        toast.info("Your unsaved note has been restored.");
      }
    }
  }, [hasRestoredDraft]);

  const { data: notes, loading, refetch } = useDataFetch(
    async () => {
      const { data, error } = await supabase
        .from("match_notes")
        .select("id, content, user_id, created_at")
        .eq("match_id", matchId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as Note[];
    },
    { deps: [matchId], errorMessage: false }
  );

  const handlePost = async () => {
    if (!newNote.trim() || !user) return;
    const noteContent = newNote.trim();
    setPosting(true);
    try {
      const { error } = await supabase
        .from("match_notes")
        .insert({
          match_id: matchId,
          org_id: orgId,
          user_id: user.id,
          content: noteContent,
        });

      if (error) throw error;
      setNewNote("");
      clearDraft();
      toast.success("Note added");
      refetch();
    } catch (err: any) {
      // Preserve user input on failure so nothing is lost
      setNewNote(noteContent);
      toast.error("Failed to post note", { description: err.message });
    } finally {
      setPosting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Notes & Comments
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <InlineLoader />
        ) : !notes || notes.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No notes yet. Add the first note to this match.</p>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {notes.map((note) => (
              <div
                key={note.id}
                className={`rounded-md p-3 text-sm ${
                  note.user_id === user?.id
                    ? "bg-primary/10 ml-4"
                    : "bg-muted mr-4"
                }`}
              >
                <p className="whitespace-pre-wrap">{note.content}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {note.user_id === user?.id ? "You" : "Team member"} · {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note..."
            className="min-h-[60px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handlePost();
            }}
            aria-label="Add a note"
          />
          <LoadingButton onClick={handlePost} loading={posting} disabled={!newNote.trim()} size="icon" className="shrink-0">
            <Send className="h-4 w-4" />
          </LoadingButton>
        </div>
        <p className="text-xs text-muted-foreground">Press ⌘+Enter to send</p>
      </CardContent>
    </Card>
  );
}
