/**
 * New support ticket form.
 * - Client-side Zod validation
 * - Live subcategory fetch
 * - Impact + category drive server-side priority
 * - Redirect to detail on success
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { BackButton } from "@/components/BackButton";
import {
  createTicket,
  listCategories,
  listSubcategories,
  type SupportCategoryRow,
  type SupportSubcategoryRow,
} from "@/lib/support/client";

const schema = z.object({
  category_key: z.string().min(1, "Choose a category"),
  subcategory_key: z.string().optional().nullable(),
  customer_impact: z.enum([
    "affects_me",
    "affects_organisation",
    "blocks_transaction_or_deadline",
  ]),
  subject: z.string().trim().min(6).max(200),
  intended_action: z.string().trim().max(2000).optional(),
  actual_result: z.string().trim().max(2000).optional(),
  affected_users_count: z.coerce.number().int().min(0).max(1_000_000).optional(),
  workaround_available: z.boolean().optional(),
  contact_name: z.string().trim().max(120).optional(),
  contact_email: z.string().trim().email().max(255).optional().or(z.literal("")),
});

export default function NewTicket() {
  const nav = useNavigate();
  const { toast } = useToast();
  const [categories, setCategories] = useState<SupportCategoryRow[]>([]);
  const [subs, setSubs] = useState<SupportSubcategoryRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    category_key: "",
    subcategory_key: "",
    customer_impact: "affects_me" as const,
    subject: "",
    intended_action: "",
    actual_result: "",
    affected_users_count: "",
    workaround_available: false,
    contact_name: "",
    contact_email: "",
  });

  useEffect(() => {
    listCategories()
      .then(setCategories)
      .catch((e) =>
        toast({
          title: "Could not load categories",
          description: (e as Error).message,
          variant: "destructive",
        })
      );
  }, [toast]);

  useEffect(() => {
    if (!form.category_key) {
      setSubs([]);
      return;
    }
    listSubcategories(form.category_key).then(setSubs).catch(() => setSubs([]));
  }, [form.category_key]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const parsed = schema.safeParse(form);
      if (!parsed.success) {
        const first = parsed.error.errors[0];
        throw new Error(first?.message ?? "Please fill the required fields.");
      }
      const affected =
        form.affected_users_count === ""
          ? null
          : Number(form.affected_users_count);
      const id = await createTicket({
        category_key: form.category_key,
        subcategory_key: form.subcategory_key || null,
        customer_impact: form.customer_impact,
        subject: form.subject.trim(),
        intended_action: form.intended_action.trim() || null,
        actual_result: form.actual_result.trim() || null,
        affected_users_count: affected,
        workaround_available: form.workaround_available,
        contact_name: form.contact_name.trim() || null,
        contact_email: form.contact_email.trim() || null,
      });
      toast({ title: "Request submitted", description: "We'll be in touch shortly." });
      nav(`/support/tickets/${id}`);
    } catch (err) {
      toast({
        title: "Could not submit request",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <BackButton />
        <Card>
          <CardHeader>
            <CardTitle>New support request</CardTitle>
            <CardDescription>
              Give us the who, what and when. All fields marked required are
              enforced on the server; free-text is limited to 2000 characters.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Category *</Label>
                  <Select
                    value={form.category_key}
                    onValueChange={(v) =>
                      setForm({ ...form, category_key: v, subcategory_key: "" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose…" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.key} value={c.key}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Sub-category</Label>
                  <Select
                    value={form.subcategory_key}
                    onValueChange={(v) =>
                      setForm({ ...form, subcategory_key: v })
                    }
                    disabled={!subs.length}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Optional…" />
                    </SelectTrigger>
                    <SelectContent>
                      {subs.map((s) => (
                        <SelectItem key={s.key} value={s.key}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Impact *</Label>
                <Select
                  value={form.customer_impact}
                  onValueChange={(v) =>
                    setForm({ ...form, customer_impact: v as typeof form.customer_impact })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="affects_me">Affects me only</SelectItem>
                    <SelectItem value="affects_organisation">
                      Affects my organisation
                    </SelectItem>
                    <SelectItem value="blocks_transaction_or_deadline">
                      Blocks a transaction or deadline
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Subject *</Label>
                <Input
                  value={form.subject}
                  maxLength={200}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                />
              </div>

              <div>
                <Label>What were you trying to do?</Label>
                <Textarea
                  rows={3}
                  maxLength={2000}
                  value={form.intended_action}
                  onChange={(e) =>
                    setForm({ ...form, intended_action: e.target.value })
                  }
                />
              </div>

              <div>
                <Label>What happened instead?</Label>
                <Textarea
                  rows={3}
                  maxLength={2000}
                  value={form.actual_result}
                  onChange={(e) =>
                    setForm({ ...form, actual_result: e.target.value })
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Users affected (approx.)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.affected_users_count}
                    onChange={(e) =>
                      setForm({ ...form, affected_users_count: e.target.value })
                    }
                  />
                </div>
                <label className="flex items-end gap-2 pb-2">
                  <Checkbox
                    checked={form.workaround_available}
                    onCheckedChange={(v) =>
                      setForm({ ...form, workaround_available: v === true })
                    }
                  />
                  <span className="text-sm">A workaround exists</span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Preferred contact name</Label>
                  <Input
                    value={form.contact_name}
                    maxLength={120}
                    onChange={(e) =>
                      setForm({ ...form, contact_name: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Preferred contact email</Label>
                  <Input
                    type="email"
                    value={form.contact_email}
                    maxLength={255}
                    onChange={(e) =>
                      setForm({ ...form, contact_email: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => nav("/support")}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Submitting…" : "Submit request"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
