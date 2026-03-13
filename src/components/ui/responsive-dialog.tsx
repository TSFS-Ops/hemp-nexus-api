/**
 * ResponsiveDialog — renders as a bottom Drawer on mobile (<md) and a centered Dialog on desktop.
 * Drop-in replacement for Dialog + DialogContent in any component.
 *
 * Usage:
 *   <ResponsiveDialog open={open} onOpenChange={setOpen}>
 *     <ResponsiveDialogContent>
 *       <ResponsiveDialogHeader>
 *         <ResponsiveDialogTitle>Title</ResponsiveDialogTitle>
 *         <ResponsiveDialogDescription>Desc</ResponsiveDialogDescription>
 *       </ResponsiveDialogHeader>
 *       {children}
 *       <ResponsiveDialogFooter>
 *         <Button>Action</Button>
 *       </ResponsiveDialogFooter>
 *     </ResponsiveDialogContent>
 *   </ResponsiveDialog>
 */

import * as React from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function ResponsiveDialog({ open, onOpenChange, children }: ResponsiveDialogProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        {children}
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children}
    </Dialog>
  );
}

interface ResponsiveDialogContentProps {
  children: React.ReactNode;
  className?: string;
}

export function ResponsiveDialogContent({ children, className }: ResponsiveDialogContentProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <DrawerContent className={cn("max-h-[85vh]", className)}>
        <div className="overflow-y-auto px-4 pb-4">{children}</div>
      </DrawerContent>
    );
  }

  return (
    <DialogContent className={cn("sm:max-w-lg", className)}>
      {children}
    </DialogContent>
  );
}

export function ResponsiveDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useIsMobile();
  const Component = isMobile ? DrawerHeader : DialogHeader;
  return <Component className={className} {...props} />;
}

export function ResponsiveDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return <DrawerFooter className={cn("safe-area-bottom", className)} {...props} />;
  }
  return <DialogFooter className={className} {...props} />;
}

export function ResponsiveDialogTitle({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogTitle>) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return <DrawerTitle className={className} {...props} />;
  }
  return <DialogTitle className={className} {...props} />;
}

export function ResponsiveDialogDescription({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogDescription>) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return <DrawerDescription className={className} {...props} />;
  }
  return <DialogDescription className={className} {...props} />;
}

export function ResponsiveDialogClose(props: React.ComponentPropsWithoutRef<typeof DialogClose>) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return <DrawerClose {...props} />;
  }
  return <DialogClose {...props} />;
}
