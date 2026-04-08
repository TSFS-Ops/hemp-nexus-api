/**
 * ResponsiveAlertDialog - AlertDialog on desktop, bottom Drawer on mobile.
 * Drop-in replacement for AlertDialog + AlertDialogContent.
 */

import * as React from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function ResponsiveAlertDialog({ open, onOpenChange, children }: Props) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        {children}
      </Drawer>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {children}
    </AlertDialog>
  );
}

export function ResponsiveAlertDialogContent({ children, className }: { children: React.ReactNode; className?: string }) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <DrawerContent className={cn("max-h-[85vh]", className)}>
        <div className="overflow-y-auto px-4 pb-4">{children}</div>
      </DrawerContent>
    );
  }

  return <AlertDialogContent className={className}>{children}</AlertDialogContent>;
}

export function ResponsiveAlertDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useIsMobile();
  if (isMobile) return <DrawerHeader className={className} {...props} />;
  return <AlertDialogHeader className={className} {...props} />;
}

export function ResponsiveAlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useIsMobile();
  if (isMobile) return <DrawerFooter className={cn("safe-area-bottom", className)} {...props} />;
  return <AlertDialogFooter className={className} {...props} />;
}

export function ResponsiveAlertDialogTitle({ className, ...props }: React.ComponentPropsWithoutRef<typeof AlertDialogTitle>) {
  const isMobile = useIsMobile();
  if (isMobile) return <DrawerTitle className={className} {...props} />;
  return <AlertDialogTitle className={className} {...props} />;
}

export function ResponsiveAlertDialogDescription({ className, ...props }: React.ComponentPropsWithoutRef<typeof AlertDialogDescription>) {
  const isMobile = useIsMobile();
  if (isMobile) return <DrawerDescription className={className} {...props} />;
  return <AlertDialogDescription className={className} {...props} />;
}

// Re-export Action/Cancel with mobile-friendly sizes
export function ResponsiveAlertDialogAction({ className, ...props }: React.ComponentPropsWithoutRef<typeof AlertDialogAction>) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return <Button className={cn("w-full touch-target", className)} {...props} />;
  }
  return <AlertDialogAction className={className} {...props} />;
}

export function ResponsiveAlertDialogCancel({ className, ...props }: React.ComponentPropsWithoutRef<typeof AlertDialogCancel>) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return <Button variant="outline" className={cn("w-full touch-target", className)} {...props} />;
  }
  return <AlertDialogCancel className={className} {...props} />;
}
