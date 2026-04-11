import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { 
  AlertTriangle, 
  CheckCircle, 
  Plus, 
  Loader2,
  Shield,
  Clock
} from "lucide-react";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface RiskItem {
  id: string;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  resolved_at: string | null;
  created_at: string;
}

export function AdminRiskPanel() {
  const [riskItems, setRiskItems] = useState<RiskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newRisk, setNewRisk] = useState({ title: "", description: "", severity: "medium" });

  useEffect(() => {
    fetchRiskItems();
  }, []);

  const fetchRiskItems = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("admin_risk_items")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setRiskItems(data || []);
    } catch (error) {
      console.error("Error fetching risk items:", error);
      toast.error("Failed to load risk items");
    } finally {
      setLoading(false);
    }
  };

  const [addingRisk, setAddingRisk] = useState(false);
  const resolvingRef = useRef(false);
  const reopeningRef = useRef(false);

  const handleAddRisk = async () => {
    if (!newRisk.title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (addingRisk) return;
    setAddingRisk(true);
    try {
      const { error } = await supabase
        .from("admin_risk_items")
        .insert({
          title: newRisk.title,
          description: newRisk.description || null,
          severity: newRisk.severity,
        });

      if (error) throw error;

      toast.success("Risk item added");
      setNewRisk({ title: "", description: "", severity: "medium" });
      setShowAddDialog(false);
      fetchRiskItems();
    } catch (error) {
      console.error("Error adding risk:", error);
      toast.error("Failed to add risk item");
    } finally {
      setAddingRisk(false);
    }
  };

  const handleResolve = async (id: string) => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from("admin_risk_items")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id,
        })
        .eq("id", id);

      if (error) throw error;

      toast.success("Risk item resolved");
      fetchRiskItems();
    } catch (error) {
      console.error("Error resolving risk:", error);
      toast.error("Failed to resolve risk item");
    } finally {
      resolvingRef.current = false;
    }
  };

  const handleReopen = async (id: string) => {
    if (reopeningRef.current) return;
    reopeningRef.current = true;
    try {
      const { error } = await supabase
        .from("admin_risk_items")
        .update({
          status: "open",
          resolved_at: null,
          resolved_by: null,
        })
        .eq("id", id);

      if (error) throw error;

      toast.success("Risk item reopened");
      fetchRiskItems();
    } catch (error) {
      console.error("Error reopening risk:", error);
      toast.error("Failed to reopen risk item");
    } finally {
      reopeningRef.current = false;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "high": return "destructive";
      case "medium": return "secondary";
      case "low": return "outline";
      default: return "secondary";
    }
  };

  const openItems = riskItems.filter(item => item.status === "open");
  const resolvedItems = riskItems.filter(item => item.status === "resolved");

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Risk Management
            </CardTitle>
            <CardDescription>Track and manage security risks and compliance issues</CardDescription>
          </div>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Risk
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Risk Item</DialogTitle>
                <DialogDescription>Create a new risk item to track</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <Input
                    placeholder="Risk title"
                    value={newRisk.title}
                    onChange={(e) => setNewRisk({ ...newRisk, title: e.target.value })}
                  />
                </div>
                <div>
                  <Textarea
                    placeholder="Description (optional)"
                    value={newRisk.description}
                    onChange={(e) => setNewRisk({ ...newRisk, description: e.target.value })}
                  />
                </div>
                <div>
                  <Select
                    value={newRisk.severity}
                    onValueChange={(value) => setNewRisk({ ...newRisk, severity: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select severity" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                <Button onClick={handleAddRisk} disabled={addingRisk}>{addingRisk ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Add Risk</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Open Risks ({openItems.length})
            </h3>
            {openItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No open risk items</p>
            ) : (
              <div className="space-y-2">
                {openItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.title}</span>
                        <Badge variant={getSeverityColor(item.severity)}>{item.severity}</Badge>
                      </div>
                      {item.description && (
                        <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        Created: {new Date(item.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Button size="sm" onClick={() => handleResolve(item.id)}>
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Resolve
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4 mt-8">
            <h3 className="font-semibold flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              Resolved ({resolvedItems.length})
            </h3>
            {resolvedItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No resolved items</p>
            ) : (
              <div className="space-y-2">
                {resolvedItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-muted-foreground line-through">{item.title}</span>
                        <Badge variant="outline">{item.severity}</Badge>
                      </div>
                      {item.resolved_at && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Resolved: {new Date(item.resolved_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => handleReopen(item.id)}>
                      Reopen
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
