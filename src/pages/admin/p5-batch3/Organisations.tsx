/**
 * P-5 Batch 3 — Stage 4 funder organisations admin list.
 *
 * All mutations route exclusively through src/lib/p5-batch3/rpc.ts.
 * No direct supabase.from('p5_batch3_*') writes from UI.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { p5b3CreateFunderOrg } from "@/lib/p5-batch3/rpc";

interface OrgRow {
  id: string;
  name: string;
  jurisdiction: string | null;
  status: "active" | "suspended" | "closed";
  user_count: number;
}

const PLACEHOLDER_ORGS: OrgRow[] = [
  { id: "placeholder-1", name: "Example Funder A", jurisdiction: "ZA", status: "active", user_count: 3 },
  { id: "placeholder-2", name: "Example Funder B", jurisdiction: "GB", status: "suspended", user_count: 1 },
];

export default function P5Batch3Organisations() {
  const [orgs] = useState<OrgRow[]>(PLACEHOLDER_ORGS);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    if (name.trim().length < 2) {
      toast.error("Name is required");
      return;
    }
    setBusy(true);
    try {
      await p5b3CreateFunderOrg({
        p_name: name.trim(),
        p_jurisdiction: jurisdiction.trim() || null,
        p_contact_email: contact.trim() || null,
      });
      toast.success("Funder organisation created");
      setOpen(false);
      setName("");
      setJurisdiction("");
      setContact("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Funder Organisations</h1>
          <p className="text-sm text-muted-foreground">
            Create funder organisations and manage their named users.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="p5b3-create-org-trigger">New organisation</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create funder organisation</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="p5b3-org-name">Legal name</Label>
                <Input id="p5b3-org-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="p5b3-org-jx">Jurisdiction</Label>
                <Input id="p5b3-org-jx" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="ISO-3166 alpha-2" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="p5b3-org-contact">Primary contact email</Label>
                <Input id="p5b3-org-contact" value={contact} onChange={(e) => setContact(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button onClick={handleCreate} disabled={busy} data-testid="p5b3-create-org-confirm">
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organisations</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Users</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.name}</TableCell>
                  <TableCell>{o.jurisdiction ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={o.status === "active" ? "default" : "secondary"}>{o.status}</Badge>
                  </TableCell>
                  <TableCell>{o.user_count}</TableCell>
                  <TableCell className="text-right">
                    <Link to={`/admin/p5-batch3/organisations/${o.id}`} className="text-sm underline">
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
