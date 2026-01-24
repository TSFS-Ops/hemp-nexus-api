import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Send, Inbox, CheckCircle2, XCircle, Clock, 
  RefreshCw, ExternalLink, Building2, MapPin, Loader2 
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";

interface Invite {
  id: string;
  created_at: string;
  from_org_id: string;
  to_org_id: string | null;
  to_email: string | null;
  search_query: string | null;
  selected_result_id: string;
  selected_result_data: {
    id: string;
    title: string;
    description?: string;
    source?: string;
    enrichment?: {
      location?: string;
      companyType?: string;
    };
  };
  status: "pending" | "accepted" | "declined" | "expired";
  accepted_at: string | null;
  declined_at: string | null;
  declined_reason: string | null;
  match_id: string | null;
  expires_at: string | null;
}

export default function Invites() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  
  const [activeTab, setActiveTab] = useState("received");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  
  const [declineDialogOpen, setDeclineDialogOpen] = useState(false);
  const [selectedInvite, setSelectedInvite] = useState<Invite | null>(null);
  const [declineReason, setDeclineReason] = useState("");

  const fetchInvites = useCallback(async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const type = activeTab === "received" ? "received" : "sent";
      
      const response = await fetch(
        `${supabaseUrl}/functions/v1/invites?type=${type}&limit=50`,
        {
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch invites: ${response.status}`);
      }

      const data = await response.json();
      setInvites(data.items || []);
    } catch (error) {
      console.error("Failed to fetch invites:", error);
      toast({
        variant: "destructive",
        title: "Failed to load invites",
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setLoading(false);
    }
  }, [user, activeTab, toast]);

  useEffect(() => {
    if (!authLoading && user) {
      fetchInvites();
    }
  }, [authLoading, user, fetchInvites]);

  const handleAccept = async (invite: Invite) => {
    setActionLoading(invite.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(
        `${supabaseUrl}/functions/v1/invites/${invite.id}/accept`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `Failed: ${response.status}`);
      }

      toast({
        title: "Invite accepted",
        description: "The sender can now confirm intent for this match.",
      });

      fetchInvites();
    } catch (error) {
      console.error("Accept error:", error);
      toast({
        variant: "destructive",
        title: "Failed to accept invite",
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const openDeclineDialog = (invite: Invite) => {
    setSelectedInvite(invite);
    setDeclineReason("");
    setDeclineDialogOpen(true);
  };

  const handleDecline = async () => {
    if (!selectedInvite) return;
    
    setActionLoading(selectedInvite.id);
    setDeclineDialogOpen(false);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(
        `${supabaseUrl}/functions/v1/invites/${selectedInvite.id}/decline`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reason: declineReason || null }),
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `Failed: ${response.status}`);
      }

      toast({
        title: "Invite declined",
        description: "The sender has been notified.",
      });

      fetchInvites();
    } catch (error) {
      console.error("Decline error:", error);
      toast({
        variant: "destructive",
        title: "Failed to decline invite",
        description: error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setActionLoading(null);
      setSelectedInvite(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary" className="flex items-center gap-1"><Clock className="h-3 w-3" /> Pending</Badge>;
      case "accepted":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Accepted</Badge>;
      case "declined":
        return <Badge variant="destructive" className="flex items-center gap-1"><XCircle className="h-3 w-3" /> Declined</Badge>;
      case "expired":
        return <Badge variant="outline" className="text-muted-foreground">Expired</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <h1 className="text-xl font-semibold">Sign in required</h1>
        <p className="text-muted-foreground">Please sign in to view your invites.</p>
        <Button onClick={() => navigate("/auth")}>Sign In</Button>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Invites</h1>
          <p className="text-muted-foreground">
            Manage counterparty invitations for intent confirmation
          </p>
        </div>
        <Button variant="outline" onClick={fetchInvites} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="received" className="flex items-center gap-2">
            <Inbox className="h-4 w-4" />
            Received
          </TabsTrigger>
          <TabsTrigger value="sent" className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            Sent
          </TabsTrigger>
        </TabsList>

        <TabsContent value="received">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : invites.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Inbox className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No invites received</h3>
                <p className="text-muted-foreground text-center">
                  When someone invites you to confirm intent, it will appear here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {invites.map((invite) => (
                <Card key={invite.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Building2 className="h-5 w-5 text-muted-foreground" />
                          {invite.selected_result_data?.title || "Unknown Counterparty"}
                        </CardTitle>
                        <CardDescription className="mt-1">
                          {invite.selected_result_data?.description?.slice(0, 100) || "No description"}
                          {(invite.selected_result_data?.description?.length || 0) > 100 && "..."}
                        </CardDescription>
                      </div>
                      {getStatusBadge(invite.status)}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                      {invite.selected_result_data?.enrichment?.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-4 w-4" />
                          {invite.selected_result_data.enrichment.location}
                        </span>
                      )}
                      <span>Received: {formatDate(invite.created_at)}</span>
                      {invite.search_query && (
                        <span>Query: "{invite.search_query}"</span>
                      )}
                    </div>

                    {invite.status === "pending" && (
                      <div className="flex items-center gap-2">
                        <Button 
                          onClick={() => handleAccept(invite)}
                          disabled={actionLoading === invite.id}
                        >
                          {actionLoading === invite.id ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                          )}
                          Accept
                        </Button>
                        <Button 
                          variant="outline"
                          onClick={() => openDeclineDialog(invite)}
                          disabled={actionLoading === invite.id}
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Decline
                        </Button>
                      </div>
                    )}

                    {invite.status === "accepted" && invite.match_id && (
                      <Link to={`/dashboard/matches/${invite.match_id}`}>
                        <Button variant="outline">
                          <ExternalLink className="h-4 w-4 mr-2" />
                          View Proof
                        </Button>
                      </Link>
                    )}

                    {invite.status === "declined" && invite.declined_reason && (
                      <p className="text-sm text-muted-foreground">
                        Reason: {invite.declined_reason}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="sent">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : invites.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Send className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No invites sent</h3>
                <p className="text-muted-foreground text-center">
                  Search for counterparties and send invites to start.
                </p>
                <Button className="mt-4" onClick={() => navigate("/dashboard")}>
                  Go to Search
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {invites.map((invite) => (
                <Card key={invite.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Building2 className="h-5 w-5 text-muted-foreground" />
                          {invite.selected_result_data?.title || "Unknown Counterparty"}
                        </CardTitle>
                        <CardDescription className="mt-1">
                          {invite.to_email ? `Sent to: ${invite.to_email}` : "Sent to counterparty"}
                        </CardDescription>
                      </div>
                      {getStatusBadge(invite.status)}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                      <span>Sent: {formatDate(invite.created_at)}</span>
                      {invite.search_query && (
                        <span>Query: "{invite.search_query}"</span>
                      )}
                      {invite.expires_at && invite.status === "pending" && (
                        <span>Expires: {formatDate(invite.expires_at)}</span>
                      )}
                    </div>

                    {invite.status === "accepted" && (
                      <div className="flex items-center gap-2">
                        {invite.match_id ? (
                          <Link to={`/dashboard/matches/${invite.match_id}`}>
                            <Button variant="outline">
                              <ExternalLink className="h-4 w-4 mr-2" />
                              View Proof
                            </Button>
                          </Link>
                        ) : (
                          <Link to="/dashboard">
                            <Button>
                              <CheckCircle2 className="h-4 w-4 mr-2" />
                              Confirm Intent
                            </Button>
                          </Link>
                        )}
                      </div>
                    )}

                    {invite.status === "declined" && invite.declined_reason && (
                      <p className="text-sm text-muted-foreground">
                        Reason: {invite.declined_reason}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Decline Dialog */}
      <AlertDialog open={declineDialogOpen} onOpenChange={setDeclineDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Decline Invite</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to decline this invite? The sender will be notified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Textarea
              placeholder="Optional: Add a reason for declining..."
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDecline}>
              Decline Invite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
