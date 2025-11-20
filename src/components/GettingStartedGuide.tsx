import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function GettingStartedGuide() {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/docs/getting-started.md")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to load guide");
        }
        return response.text();
      })
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Unable to load the getting started guide. Please contact support.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          <CardTitle>Getting Started Tutorial</CardTitle>
        </div>
        <CardDescription>
          Step-by-step guide to integrate with the Compliance Matching API
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <ReactMarkdown
            components={{
              h1: ({ children }) => (
                <h1 className="text-3xl font-bold mb-4 text-foreground">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-2xl font-semibold mb-3 mt-6 text-foreground">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-xl font-semibold mb-2 mt-4 text-foreground">{children}</h3>
              ),
              h4: ({ children }) => (
                <h4 className="text-lg font-medium mb-2 mt-3 text-foreground">{children}</h4>
              ),
              p: ({ children }) => (
                <p className="mb-4 text-muted-foreground leading-relaxed">{children}</p>
              ),
              ul: ({ children }) => (
                <ul className="list-disc pl-6 mb-4 space-y-2 text-muted-foreground">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal pl-6 mb-4 space-y-2 text-muted-foreground">{children}</ol>
              ),
              li: ({ children }) => (
                <li className="text-muted-foreground">{children}</li>
              ),
              code: ({ children, className }) => {
                const isBlock = className?.includes("language-");
                if (isBlock) {
                  return (
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto mb-4">
                      <code className="text-sm">{children}</code>
                    </pre>
                  );
                }
                return (
                  <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => (
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto mb-4">
                  {children}
                </pre>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-border pl-4 italic my-4 text-muted-foreground">
                  {children}
                </blockquote>
              ),
              a: ({ children, href }) => (
                <a
                  href={href}
                  className="text-primary hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              ),
              hr: () => <hr className="my-6 border-border" />,
              table: ({ children }) => (
                <div className="overflow-x-auto mb-4">
                  <table className="min-w-full border-collapse border border-border">
                    {children}
                  </table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-border px-4 py-2 bg-muted font-semibold text-left">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-border px-4 py-2 text-muted-foreground">
                  {children}
                </td>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </CardContent>
    </Card>
  );
}
