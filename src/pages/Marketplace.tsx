import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Store, CheckCircle2, XCircle, Clock, Building2, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { z } from "zod";

const registrationSchema = z.object({
  company_name: z.string()
    .min(2, "Company name must be at least 2 characters")
    .max(200, "Company name must be less than 200 characters")
    .trim(),
  company_description: z.string()
    .max(2000, "Description must be less than 2000 characters")
    .optional()
    .transform(val => val?.trim() || ""),
  company_website: z.string()
    .url("Please enter a valid URL")
    .max(500, "URL must be less than 500 characters")
    .optional()
    .or(z.literal("")),
  contact_email: z.string()
    .email("Please enter a valid email address")
    .max(255, "Email must be less than 255 characters")
    .trim(),
  contact_phone: z.string()
    .max(50, "Phone number must be less than 50 characters")
    .optional()
    .transform(val => val?.trim() || ""),
  data_source_name: z.string()
    .min(2, "Data source name must be at least 2 characters")
    .max(200, "Data source name must be less than 200 characters")
    .trim(),
  data_source_type: z.enum(["api", "webhook", "scraper", "manual"]),
  endpoint_url: z.string()
    .url("Please enter a valid URL")
    .max(500, "URL must be less than 500 characters")
    .optional()
    .or(z.literal("")),
  api_documentation: z.string()
    .url("Please enter a valid URL")
    .max(500, "URL must be less than 500 characters")
    .optional()
    .or(z.literal("")),
});

type RegistrationFormData = z.infer<typeof registrationSchema>;

export default function Marketplace() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  // Auth check
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        navigate("/auth");
      } else {
        setIsAuthenticated(true);
        setAuthLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate("/auth");
      } else {
        setIsAuthenticated(true);
        setAuthLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  // Form state
  const [formData, setFormData] = useState<RegistrationFormData>({
    company_name: "",
    company_description: "",
    company_website: "",
    contact_email: "",
    contact_phone: "",
    data_source_name: "",
    data_source_type: "api",
    endpoint_url: "",
    api_documentation: "",
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
    enabled: isAuthenticated,
  });

  // Submit registration
  const submitRegistration = useMutation({
    mutationFn: async (validatedData: RegistrationFormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();

      const { error } = await supabase.from("data_source_registrations").insert({
        company_name: validatedData.company_name,
        company_description: validatedData.company_description || null,
        company_website: validatedData.company_website || null,
        contact_email: validatedData.contact_email,
        contact_phone: validatedData.contact_phone || null,
        data_source_name: validatedData.data_source_name,
        data_source_type: validatedData.data_source_type,
        endpoint_url: validatedData.endpoint_url || null,
        api_documentation: validatedData.api_documentation || null,
        org_id: profile?.org_id,
        submitted_by: user.id,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Registration submitted for review");
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
      });
      setValidationErrors({});
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationErrors({});
    
    const result = registrationSchema.safeParse(formData);
    
    if (!result.success) {
      const errors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          errors[err.path[0] as string] = err.message;
        }
      });
      setValidationErrors(errors);
      toast.error("Please fix the errors in the form");
      return;
    }

    setIsSubmitting(true);
    try {
      await submitRegistration.mutateAsync(result.data);
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = (field: keyof RegistrationFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (validationErrors[field]) {
      setValidationErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
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

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

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
                      onChange={(e) => updateField("company_name", e.target.value)}
                      className={validationErrors.company_name ? "border-destructive" : ""}
                      required
                    />
                    {validationErrors.company_name && (
                      <p className="text-sm text-destructive">{validationErrors.company_name}</p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="company_website">Website</Label>
                    <Input
                      id="company_website"
                      type="url"
                      placeholder="https://example.com"
                      value={formData.company_website}
                      onChange={(e) => updateField("company_website", e.target.value)}
                      className={validationErrors.company_website ? "border-destructive" : ""}
                    />
                    {validationErrors.company_website && (
                      <p className="text-sm text-destructive">{validationErrors.company_website}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="company_description">Company Description</Label>
                  <Textarea
                    id="company_description"
                    value={formData.company_description}
                    onChange={(e) => updateField("company_description", e.target.value)}
                    className={validationErrors.company_description ? "border-destructive" : ""}
                    rows={3}
                    maxLength={2000}
                  />
                  {validationErrors.company_description && (
                    <p className="text-sm text-destructive">{validationErrors.company_description}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="contact_email">Contact Email *</Label>
                    <Input
                      id="contact_email"
                      type="email"
                      value={formData.contact_email}
                      onChange={(e) => updateField("contact_email", e.target.value)}
                      className={validationErrors.contact_email ? "border-destructive" : ""}
                      required
                    />
                    {validationErrors.contact_email && (
                      <p className="text-sm text-destructive">{validationErrors.contact_email}</p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="contact_phone">Contact Phone</Label>
                    <Input
                      id="contact_phone"
                      type="tel"
                      value={formData.contact_phone}
                      onChange={(e) => updateField("contact_phone", e.target.value)}
                      className={validationErrors.contact_phone ? "border-destructive" : ""}
                    />
                    {validationErrors.contact_phone && (
                      <p className="text-sm text-destructive">{validationErrors.contact_phone}</p>
                    )}
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
                      onChange={(e) => updateField("data_source_name", e.target.value)}
                      className={validationErrors.data_source_name ? "border-destructive" : ""}
                      required
                    />
                    {validationErrors.data_source_name && (
                      <p className="text-sm text-destructive">{validationErrors.data_source_name}</p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="data_source_type">Type *</Label>
                    <Select
                      value={formData.data_source_type}
                      onValueChange={(value) => updateField("data_source_type", value)}
                    >
                      <SelectTrigger className={validationErrors.data_source_type ? "border-destructive" : ""}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="api">API</SelectItem>
                        <SelectItem value="webhook">Webhook</SelectItem>
                        <SelectItem value="scraper">Web Scraper</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
                      </SelectContent>
                    </Select>
                    {validationErrors.data_source_type && (
                      <p className="text-sm text-destructive">{validationErrors.data_source_type}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="endpoint_url">API Endpoint URL</Label>
                  <Input
                    id="endpoint_url"
                    type="url"
                    value={formData.endpoint_url}
                    onChange={(e) => updateField("endpoint_url", e.target.value)}
                    placeholder="https://api.yourcompany.com/v1/search"
                    className={validationErrors.endpoint_url ? "border-destructive" : ""}
                  />
                  {validationErrors.endpoint_url && (
                    <p className="text-sm text-destructive">{validationErrors.endpoint_url}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="api_documentation">API Documentation URL</Label>
                  <Input
                    id="api_documentation"
                    type="url"
                    value={formData.api_documentation}
                    onChange={(e) => updateField("api_documentation", e.target.value)}
                    placeholder="https://docs.yourcompany.com"
                    className={validationErrors.api_documentation ? "border-destructive" : ""}
                  />
                  {validationErrors.api_documentation && (
                    <p className="text-sm text-destructive">{validationErrors.api_documentation}</p>
                  )}
                </div>
              </div>

              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit Registration"
                )}
              </Button>
            </form>
          </Card>
        </TabsContent>

        <TabsContent value="registrations" className="space-y-4">
          {isLoading ? (
            <Card className="p-6 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading registrations...</span>
            </Card>
          ) : registrations && registrations.length > 0 ? (
            <div className="grid gap-4">
              {registrations.map((reg) => (
                <Card key={reg.id} className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(reg.status)}
                        <h3 className="font-semibold">{reg.data_source_name}</h3>
                        <Badge className={getStatusColor(reg.status)}>
                          {reg.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {reg.company_name} • {reg.data_source_type.toUpperCase()}
                      </p>
                      {reg.endpoint_url && (
                        <p className="text-xs text-muted-foreground font-mono">
                          {reg.endpoint_url}
                        </p>
                      )}
                      {reg.rejection_reason && (
                        <p className="text-sm text-destructive mt-2">
                          Rejection reason: {reg.rejection_reason}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(reg.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-6">
              <div className="text-center py-8">
                <Store className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No registrations yet</h3>
                <p className="text-muted-foreground">
                  Register your data source to get started
                </p>
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
