/**
 * Public knowledge-base index + article view.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FullPageLoader } from "@/components/ui/full-page-loader";
import {
  listKbArticles,
  getKbArticle,
  type KbArticleSummary,
  type KbArticleFull,
} from "@/lib/support/client";

export function KbIndex() {
  const [rows, setRows] = useState<KbArticleSummary[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    listKbArticles(q || undefined).then(setRows).catch(() => setRows([]));
  }, [q]);
  if (!rows) return <FullPageLoader />;
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <Link
          to="/support"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Support centre
        </Link>
        <h1 className="text-2xl font-semibold">Knowledge base</h1>
        <Input
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No articles match your search.
          </div>
        ) : (
          rows.map((a) => (
            <Card key={a.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  <Link
                    to={`/support/kb/${a.slug}`}
                    className="hover:underline"
                  >
                    {a.title}
                  </Link>
                </CardTitle>
                {a.summary && <CardDescription>{a.summary}</CardDescription>}
              </CardHeader>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

export function KbArticle() {
  const { slug = "" } = useParams();
  const [a, setA] = useState<KbArticleFull | null | undefined>(undefined);
  useEffect(() => {
    getKbArticle(slug).then(setA).catch(() => setA(null));
  }, [slug]);
  if (a === undefined) return <FullPageLoader />;
  if (a === null) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Link to="/support/kb" className="text-sm text-muted-foreground">
          ← Knowledge base
        </Link>
        <Card className="mt-4">
          <CardContent className="pt-6">Article not found.</CardContent>
        </Card>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <Link
          to="/support/kb"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Knowledge base
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>{a.title}</CardTitle>
            {a.summary && <CardDescription>{a.summary}</CardDescription>}
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-6">
              {a.body_md}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
