/**
 * Batch 24 — Trade Desk keyboard shortcuts cheatsheet.
 *
 * Rendered as a Radix dialog so it gets focus management and Escape-to-close
 * for free. Triggered by the "?" key from anywhere inside the Desk shell.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DeskShortcut } from "./useDeskShortcuts";

export function DeskShortcutsDialog({
  open,
  onOpenChange,
  shortcuts,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  shortcuts: DeskShortcut[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Press <Kbd>g</Kbd> then a key to jump between Trade Desk pages.
            Press <Kbd>?</Kbd> any time to open this list.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 mt-2">
          {shortcuts.map((s) => (
            <li
              key={s.to}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-foreground">{s.label}</span>
              <span className="flex items-center gap-1">
                <Kbd>g</Kbd>
                <span className="text-muted-foreground text-xs">then</span>
                <Kbd>{s.key}</Kbd>
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  );
}
