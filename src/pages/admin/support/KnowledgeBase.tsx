/**
 * Admin — Knowledge base editor.
 * List, create, edit, publish, delete KB articles.
 * Uses direct-table CRUD gated by kb_admin_all RLS.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FullPageLoader } from "@/components/ui/full-page-loader";
import { useToast } from "@/hooks/use-toast";
import {
  adminCreateKb,
  adminDeleteKb,
  adminListKb,
  adminUpdateKb,
  listCategories,
  slugify,
  type AdminKbRow,
  type SupportCategoryRow,
} from "@/lib/support/client";
import { formatDistanceToNow } from "date-fns";

const AUDIENCES: AdminKbRow["audience"][] = [
  "public",
  "authenticated",
  "internal",
];

export default function AdminSupportKnowledgeBase() {
  const { toast } = useToast();
  const [rows, setRows] = useState<AdminKbRow[] | null>(null);
  const [cats, setCats] = useState<SupportCategoryRow[]>([]);
  const [editing, setEditing] = useState<AdminKbRow | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await adminListKb());
    } catch (e) {
      toast({
        title: "Load failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  }, [toast]);

  useEffect(() => {
    load();
    listCategories()
      .then(setCats)
      .catch(() => setCats([]));
  }, [load]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <Link
              to="/admin/support"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Support queue
            </Link>
            <h1 className="text-2xl font-semibold mt-1">Knowledge base</h1>
            <p className="text-sm text-muted-foreground">
              Publish self-service articles for customers. Markdown supported.
            </p>
          </div>
          <Button onClick={() => setEditing("new")}>New article</Button>
        </div>

        {!rows ? (
          <FullPageLoader />
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No articles yet.
            </CardContent>
          </Card>
        ) : (
          rows.map((a) => (
            <Card
              key={a.id}
              className="cursor-pointer hover:border-primary/40"
              onClick={() => setEditing(a)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={a.is_published ? "default" : "outline"}>
                    {a.is_published ? "published" : "draft"}
                  </Badge>
                  <Badge variant="secondary">{a.audience}</Badge>
                  {a.category_key && (
                    <Badge variant="outline">{a.category_key}</Badge>
                  )}
                  <span className="text-xs font-mono text-muted-foreground">
                    /{a.slug}
                  </span>
                </div>
                <CardTitle className="text-base">{a.title}</CardTitle>
                <CardDescription className="text-xs">
                  Updated{" "}
                  {formatDistanceToNow(new Date(a.updated_at), {
                    addSuffix: true,
                  })}
                  {" · "}
                  {a.view_count} views
                </CardDescription>
              </CardHeader>
              {a.summary && (
                <CardContent className="pt-0 text-sm">{a.summary}</CardContent>
              )}
            </Card>
          ))
        )}
      </div>

      {editing && (
        <ArticleEditor
          article={editing === "new" ? null : editing}
          categories={cats}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ArticleEditor({
  article,
  categories,
  onClose,
  onSaved,
}: {
  article: AdminKbRow | null;
  categories: SupportCategoryRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(article?.title ?? "");
  const [slug, setSlug] = useState(article?.slug ?? "");
  const [summary, setSummary] = useState(article?.summary ?? "");
  const [body, setBody] = useState(article?.body_md ?? "");
  const [category, setCategory] = useState<string>(article?.category_key ?? "__none");
  const [audience, setAudience] = useState<AdminKbRow["audience"]>(
    article?.audience ?? "public"
  );
  const [published, setPublished] = useState(article?.is_published ?? false);

  async function save() {
    if (!title.trim() || !body.trim()) {
      toast({ title: "Title and body required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      if (article) {
        await adminUpdateKb(article.id, {
          title: title.trim(),
          slug: slug.trim() || slugify(title),
          summary: summary.trim() || null,
          body_md: body,
          category_key: category === "__none" ? null : category,
          audience,
          is_published: published,
        });
      } else {
        await adminCreateKb({
          title: title.trim(),
          slug: slug.trim() || undefined,
          summary: summary.trim() || null,
          body_md: body,
          category_key: category === "__none" ? null : category,
          audience,
          is_published: published,
        });
      }
      toast({ title: article ? "Article saved" : "Article created" });
      onSaved();
    } catch (e) {
      toast({
        title: "Save failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!article) return;
    if (!confirm("Delete this article? This cannot be undone.")) return;
    setBusy(true);
    try {
      await adminDeleteKb(article.id);
      toast({ title: "Deleted" });
      onSaved();
    } catch (e) {
      toast({
        title: "Delete failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {article ? "Edit article" : "New knowledge base article"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!article && !slug) setSlug(slugify(e.target.value));
              }}
            />
          </div>
          <div>
            <Label>Slug</Label>
            <Input
              value={slug}
              onChange={(e) => setSlug(slugify(e.target.value))}
              placeholder="auto-generated from title"
            />
          </div>
          <div>
            <Label>Summary</Label>
            <Textarea
              rows={2}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>
          <div>
            <Label>Body (Markdown)</Label>
            <Textarea
              rows={14}
              className="font-mono text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— None —</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Audience</Label>
              <Select
                value={audience}
                onValueChange={(v) => setAudience(v as AdminKbRow["audience"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIENCES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Switch checked={published} onCheckedChange={setPublished} />
              <Label>Published</Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          {article && (
            <Button variant="destructive" onClick={del} disabled={busy}>
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : article ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
