import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Store, CheckCircle2, XCircle, Clock, Building2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export default function Marketplace() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    company_name: "",
    company_description: "",
    company_website: "",
    contact_email: "",
    contact_phone: "",
    data_source_name: "",
    data_source_type: "api",
    endpoint_url: "",
    api_documentation: "",
    supported_products: [] as string[],
    supported_regions: [] as string[],
  });

  // Fetch registrations
  const { data: registrations, isLoading } = useQuery({
    queryKey: ["data-source-registrations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("data_source_registrations")
        .select("*")
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });

  // Submit registration
  const submitRegistration = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();

      const { error } = await supabase.from("data_source_registrations").insert({
        ...formData,
        org_id: profile?.org_id,
        submitted_by: user.id,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Registration submitted for review" });
      queryClient.invalidateQueries({ queryKey: ["data-source-registrations"] });
      setFormData({
        company_name: "",
        company_description: "",
        company_website: "",
        contact_email: "",
        contact_phone: "",
        data_source_name: "",
        data_source_type: "api",
        endpoint_url: "",
        api_documentation: "",
        supported_products: [],
        supported_regions: [],
      });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Error", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await submitRegistration.mutateAsync();
    setIsSubmitting(false);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "approved":
      case "active":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "rejected":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved":
      case "active":
        return "bg-green-500/10 text-green-500 border-green-500/20";
      case "rejected":
        return "bg-red-500/10 text-red-500 border-red-500/20";
      case "suspended":
        return "bg-orange-500/10 text-orange-500 border-orange-500/20";
      default:
        return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Store className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold">Data Source Marketplace</h1>
          <p className="text-muted-foreground">
            Connect your marketplace or supplier network to expand global trade reach
          </p>
        </div>
      </div>

      <Tabs defaultValue="register" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="register">Register Data Source</TabsTrigger>
          <TabsTrigger value="registrations">My Registrations</TabsTrigger>
        </TabsList>

        <TabsContent value="register" className="space-y-6">
          <Card className="p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Company Information
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="company_name">Company Name *</Label>
                    <Input
                      id="company_name"
                      value={formData.company_name}
                      onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="company_website">Website</Label>
                    <Input
                      id="company_website"
                      type="url"
                      value={formData.company_website}
                      onChange={(e) => setFormData({ ...formData, company_website: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="company_description">Company Description</Label>
                  <Textarea
                    id="company_description"
                    value={formData.company_description}
                    onChange={(e) => setFormData({ ...formData, company_description: e.target.value })}
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="contact_email">Contact Email *</Label>
                    <Input
                      id="contact_email"
                      type="email"
                      value={formData.contact_email}
                      onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="contact_phone">Contact Phone</Label>
                    <Input
                      id="contact_phone"
                      type="tel"
                      value={formData.contact_phone}
                      onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4 border-t pt-4">
                <h3 className="text-lg font-semibold">Data Source Details</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="data_source_name">Data Source Name *</Label>
                    <Input
                      id="data_source_name"
                      value={formData.data_source_name}
                      onChange={(e) => setFormData({ ...formData, data_source_name: e.target.value })}
                      required
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="data_source_type">Type *</Label>
                    <Select
                      value={formData.data_source_type}
                      onValueChange={(value) => setFormData({ ...formData, data_source_type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="api">API</SelectItem>
                        <SelectItem value="webhook">Webhook</SelectItem>
                        <SelectItem value="scraper">Web Scraper</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="endpoint_url">API Endpoint URL</Label>
                  <Input
                    id="endpoint_url"
                    type="url"
                    value={formData.endpoint_url}
                    onChange={(e) => setFormData({ ...formData, endpoint_url: e.target.value })}
                    placeholder="https://api.yourcompany.com/v1/search"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="api_documentation">API Documentation URL</Label>
                  <Input
                    id="api_documentation"
                    type="url"
                    value={formData.api_documentation}
                    onChange={(e) => setFormData({ ...formData, api_documentation: e.target.value })}
                  />
                </div>
              </div>

              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? "Submitting..." : "Submit Registration"}
              </Button>
            </form>
          </Card>
        </TabsContent>

        <TabsContent value="registrations" className="space-y-4">
          {isLoading ? (
            <Card className="p-6 text-center text-muted-foreground">
              Loading registrations...
            </Card>
          ) : registrations && registrations.length > 0 ? (
            <div className="grid gap-4">
              {registrations.map((reg) => (
                <Card key={reg.id} className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold">{reg.company_name}</h3>
                        <Badge className={getStatusColor(reg.status)}>
                          <span className="flex items-center gap-1">
                            {getStatusIcon(reg.status)}
                            {reg.status}
                          </span>
                        </Badge>
                      </div>
                      
                      <p className="text-sm text-muted-foreground">{reg.company_description}</p>
                      
                      <div className="flex flex-wrap gap-4 text-sm">
                        <span><strong>Data Source:</strong> {reg.data_source_name}</span>
                        <span><strong>Type:</strong> {reg.data_source_type}</span>
                        {reg.endpoint_url && (
                          <span className="truncate max-w-xs">
                            <strong>Endpoint:</strong> {reg.endpoint_url}
                          </span>
                        )}
                      </div>
                      
                      <p className="text-xs text-muted-foreground">
                        Submitted {new Date(reg.created_at).toLocaleDateString()}
                      </p>
                      
                      {reg.rejection_reason && (
                        <p className="text-sm text-red-500 mt-2">
                          <strong>Rejection reason:</strong> {reg.rejection_reason}
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-6 text-center text-muted-foreground">
              No registrations yet. Submit your first registration to get started.
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
