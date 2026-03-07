/**
 * CodeBlock — Lightweight syntax-highlighted code block.
 *
 * Uses prism-react-renderer (~12KB) instead of react-syntax-highlighter (~500KB).
 */

import { useState } from "react";
import { Highlight, themes } from "prism-react-renderer";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CodeBlockProps {
  code: string;
  language?: string;
  className?: string;
  showCopyButton?: boolean;
}

export function CodeBlock({ code, language = "bash", className, showCopyButton = true }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("relative group", className)}>
      <Highlight theme={themes.vsDark} code={code.trim()} language={language}>
        {({ className: hlClassName, style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className={cn(hlClassName, "rounded-lg p-4 overflow-x-auto text-sm")}
            style={style}
          >
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
      {showCopyButton && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8"
          onClick={copyToClipboard}
        >
          {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </Button>
      )}
    </div>
  );
}
