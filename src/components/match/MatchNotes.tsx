import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

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
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    fetchNotes();
  }, [matchId]);

  const fetchNotes = async () => {
    try {
      const { data, error } = await supabase
        .from("match_notes")
        .select("id, content, user_id, created_at")
        .eq("match_id", matchId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setNotes(data || []);
    } catch (err) {
      console.error("Error fetching notes:", err);
    } finally {
      setLoading(false);
    }
  };

  const handlePost = async () => {
    if (!newNote.trim() || !user) return;
    setPosting(true);
    try {
      const { error } = await supabase
        .from("match_notes")
        .insert({
          match_id: matchId,
          org_id: orgId,
          user_id: user.id,
          content: newNote.trim(),
        });

      if (error) throw error;
      setNewNote("");
      fetchNotes();
    } catch (err: any) {
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
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : notes.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No notes yet. Add the first note to this match.</p>
        ) : (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {notes.map((note) => (
              <div
                key={note.id}
                className={`rounded-lg p-3 text-sm ${
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
          <Button onClick={handlePost} disabled={posting || !newNote.trim()} size="icon" className="shrink-0">
            {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Press ⌘+Enter to send</p>
      </CardContent>
    </Card>
  );
}
