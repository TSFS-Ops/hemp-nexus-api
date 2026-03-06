import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Globe, Users, Target, Award, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Analytics() {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch match analytics
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ["match-analytics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("match_analytics")
        .select("*")
        .order("period_start", { ascending: false })
        .limit(100);
      
      if (error) throw error;
      return data;
    },
    enabled: isAuthenticated,
  });

  // Fetch data source performance
  const { data: performance, isLoading: perfLoading } = useQuery({
    queryKey: ["data-source-performance"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("data_source_performance")
        .select(`
          *,
          data_sources(name, type)
        `)
        .order("created_at", { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data;
    },
    enabled: isAuthenticated,
  });

  // Calculate cross-border stats
  const crossBorderStats = analytics?.reduce((acc, record) => {
    if (record.is_cross_border) {
      acc.crossBorderMatches += record.total_matches || 0;
    }
    acc.totalMatches += record.total_matches || 0;
    return acc;
  }, { crossBorderMatches: 0, totalMatches: 0 });

  const crossBorderRate = crossBorderStats && crossBorderStats.totalMatches > 0
    ? ((crossBorderStats.crossBorderMatches / crossBorderStats.totalMatches) * 100).toFixed(1)
    : "0";

  // Calculate geographic coverage
  const countries = new Set(
    analytics?.flatMap(a => [a.source_country, a.target_country].filter(Boolean))
  );

  // Calculate provider performance
  const providerStats = performance?.reduce((acc, record) => {
    const sourceName = record.data_sources?.name || "Unknown";
    if (!acc[sourceName]) {
      acc[sourceName] = {
        totalQueries: 0,
        totalOptions: 0,
        totalSelected: 0,
        avgResponseTime: 0,
        successCount: 0,
      };
    }
    acc[sourceName].totalQueries++;
    acc[sourceName].totalOptions += record.options_returned || 0;
    acc[sourceName].totalSelected += record.options_selected || 0;
    acc[sourceName].avgResponseTime += record.response_time_ms || 0;
    if (record.search_success) acc[sourceName].successCount++;
    return acc;
  }, {} as Record<string, any>);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Please sign in to view analytics.</p>
        <Button onClick={() => navigate("/auth")}>Sign In</Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <TrendingUp className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold">Match Analytics</h1>
          <p className="text-muted-foreground">
            Global coverage, cross-border connections, and provider performance
          </p>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Countries Reached</p>
              <p className="text-3xl font-bold">{countries.size}</p>
            </div>
            <Globe className="h-8 w-8 text-blue-500" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Cross-Border Rate</p>
              <p className="text-3xl font-bold">{crossBorderRate}%</p>
            </div>
            <Target className="h-8 w-8 text-green-500" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Matches</p>
              <p className="text-3xl font-bold">
                {crossBorderStats?.totalMatches || 0}
              </p>
            </div>
            <Users className="h-8 w-8 text-purple-500" />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Active Providers</p>
              <p className="text-3xl font-bold">
                {providerStats ? Object.keys(providerStats).length : 0}
              </p>
            </div>
            <Award className="h-8 w-8 text-orange-500" />
          </div>
        </Card>
      </div>

      <Tabs defaultValue="geographic" className="w-full">
        <TabsList>
          <TabsTrigger value="geographic">Geographic Coverage</TabsTrigger>
          <TabsTrigger value="providers">Provider Performance</TabsTrigger>
          <TabsTrigger value="products">Product Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="geographic" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Geographic Heatmap</h3>
            {analyticsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : analytics && analytics.length > 0 ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4">
                  {Array.from(countries).slice(0, 10).map((country) => {
                    const countryMatches = analytics.filter(
                      a => a.source_country === country || a.target_country === country
                    );
                    const totalMatches = countryMatches.reduce(
                      (sum, a) => sum + (a.total_matches || 0), 0
                    );
                    
                    return (
                      <div key={country as string} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <Globe className="h-5 w-5 text-primary" />
                          <span className="font-medium">{country}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <Badge variant="secondary">{totalMatches} matches</Badge>
                          <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-primary"
                              style={{ width: `${Math.min(100, (totalMatches / 10) * 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">No geographic data yet</p>
            )}
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Cross-Border Connections</h3>
            {analytics && analytics.filter(a => a.is_cross_border).length > 0 ? (
              <div className="space-y-3">
                {analytics
                  .filter(a => a.is_cross_border && a.source_country && a.target_country)
                  .slice(0, 10)
                  .map((connection, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 border rounded">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{connection.source_country}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-medium">{connection.target_country}</span>
                      </div>
                      <Badge>{connection.total_matches} matches</Badge>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No cross-border connections yet
              </p>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="providers" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Provider Performance Metrics</h3>
            {perfLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : providerStats && Object.keys(providerStats).length > 0 ? (
              <div className="space-y-4">
                {Object.entries(providerStats).map(([name, stats]: [string, any]) => {
                  const successRate = ((stats.successCount / stats.totalQueries) * 100).toFixed(1);
                  const avgResponseTime = (stats.avgResponseTime / stats.totalQueries).toFixed(0);
                  const selectionRate = stats.totalOptions > 0
                    ? ((stats.totalSelected / stats.totalOptions) * 100).toFixed(1)
                    : "0";

                  return (
                    <div key={name} className="p-4 border rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold">{name}</h4>
                        <Badge variant="secondary">{stats.totalQueries} queries</Badge>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Success Rate</p>
                          <p className="text-lg font-semibold text-green-500">{successRate}%</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Avg Response</p>
                          <p className="text-lg font-semibold">{avgResponseTime}ms</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Options</p>
                          <p className="text-lg font-semibold">{stats.totalOptions}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Selection Rate</p>
                          <p className="text-lg font-semibold text-blue-500">{selectionRate}%</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No provider data yet
              </p>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="products" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Product Category Performance</h3>
            {analytics && analytics.filter(a => a.product_category).length > 0 ? (
              <div className="space-y-3">
                {(() => {
                  const categoryStats = analytics
                    .filter(a => a.product_category)
                    .reduce((acc, record) => {
                      const cat = record.product_category!;
                      if (!acc[cat]) {
                        acc[cat] = { signals: 0, matches: 0 };
                      }
                      acc[cat].signals += record.total_signals || 0;
                      acc[cat].matches += record.total_matches || 0;
                      return acc;
                    }, {} as Record<string, any>);
                  
                  return Object.entries(categoryStats).slice(0, 10).map(([category, stats]) => {
                    const matchRate = stats.signals > 0
                      ? ((stats.matches / stats.signals) * 100).toFixed(1)
                      : "0";
                    
                    return (
                      <div key={category} className="flex items-center justify-between p-3 border rounded">
                        <span className="font-medium">{category}</span>
                        <div className="flex items-center gap-4">
                          <Badge variant="secondary">{stats.signals} signals</Badge>
                          <Badge>{stats.matches} matches</Badge>
                          <span className="text-sm text-muted-foreground">{matchRate}% rate</span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No product category data yet
              </p>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
