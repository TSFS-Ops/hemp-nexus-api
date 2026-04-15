import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, TrendingUp, Package, DollarSign, CheckCircle } from "lucide-react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { Tables } from "@/integrations/supabase/types";

type Match = Tables<"matches">;

interface AnalyticsData {
  totalMatches: number;
  settledMatches: number;
  settlementRate: number;
  totalValue: number;
  topCommodities: { commodity: string; count: number }[];
  topBuyers: { name: string; count: number }[];
  topSellers: { name: string; count: number }[];
  statusDistribution: { name: string; value: number }[];
}

const COLORS = ['hsl(var(--primary))', 'hsl(var(--secondary))', 'hsl(var(--accent))', 'hsl(var(--muted))'];

export function MatchAnalytics() {
  const { data: analytics, isLoading } = useQuery({
    queryKey: ["match-analytics"],
    queryFn: async () => {
      const { data: matches, error } = await supabase
        .from("matches")
        .select("*");

      if (error) throw error;

      const matchesData = matches as Match[];

      // Calculate statistics
      const totalMatches = matchesData.length;
      const settledMatches = matchesData.filter(m => m.status === "settled").length;
      const settlementRate = totalMatches > 0 ? (settledMatches / totalMatches) * 100 : 0;
      
      const totalValue = matchesData.reduce((sum, m) => 
        sum + (m.price_amount * m.quantity_amount), 0
      );

      // Top commodities
      const commodityCounts = matchesData.reduce((acc, m) => {
        acc[m.commodity] = (acc[m.commodity] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const topCommodities = Object.entries(commodityCounts)
        .map(([commodity, count]) => ({ commodity, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Top buyers
      const buyerCounts = matchesData.reduce((acc, m) => {
        acc[m.buyer_name] = (acc[m.buyer_name] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const topBuyers = Object.entries(buyerCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Top sellers
      const sellerCounts = matchesData.reduce((acc, m) => {
        acc[m.seller_name] = (acc[m.seller_name] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const topSellers = Object.entries(sellerCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Status distribution
      const statusDistribution = [
        { name: "Matched", value: matchesData.filter(m => m.status === "matched").length },
        { name: "Settled", value: settledMatches },
      ];

      const analyticsData: AnalyticsData = {
        totalMatches,
        settledMatches,
        settlementRate,
        totalValue,
        topCommodities,
        topBuyers,
        topSellers,
        statusDistribution,
      };

      return analyticsData;
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!analytics || analytics.totalMatches === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <TrendingUp className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
          <h3 className="font-semibold text-lg mb-1">No analytics yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Analytics will appear here once you have active trades. Start a search to find your first trading partner.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Matches</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.totalMatches}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Settled Matches</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.settledMatches}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Settlement Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.settlementRate.toFixed(1)}%</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${analytics.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Status Distribution</CardTitle>
            <CardDescription>Breakdown of match statuses</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={analytics.statusDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {analytics.statusDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Commodities</CardTitle>
            <CardDescription>Most traded commodities</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={analytics.topCommodities}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="commodity" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Buyers</CardTitle>
            <CardDescription>Most active buyers by match count</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={analytics.topBuyers} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={100} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--accent))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Sellers</CardTitle>
            <CardDescription>Most active sellers by match count</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={analytics.topSellers} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={100} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--secondary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
