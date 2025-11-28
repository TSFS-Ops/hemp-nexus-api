import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { 
  Play, 
  CheckCircle2, 
  XCircle, 
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronRight
} from "lucide-react";
import { toast } from "sonner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface TestResult {
  name: string;
  category: string;
  status: "passed" | "failed" | "skipped";
  duration: number;
  error?: string;
  details?: any;
}

interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
}

interface CategorySummary {
  name: string;
  total: number;
  passed: number;
  failed: number;
}

interface TestData {
  summary: TestSummary;
  categories: CategorySummary[];
  results: TestResult[];
  timestamp: string;
}

export default function AutomatedTestSuite() {
  const [testData, setTestData] = useState<TestData | null>(null);
  const [running, setRunning] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const runTests = async () => {
    setRunning(true);
    toast.info("Running automated tests...");
    
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-tests`
      );
      
      if (!response.ok) {
        throw new Error(`Test run failed: ${response.status}`);
      }

      const data = await response.json();
      setTestData(data);
      
      if (data.summary.failed === 0) {
        toast.success(`All ${data.summary.passed} tests passed!`);
      } else {
        toast.error(`${data.summary.failed} test(s) failed`);
      }
    } catch (error) {
      console.error("Test run error:", error);
      toast.error("Failed to run tests");
    } finally {
      setRunning(false);
    }
  };

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "passed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "skipped":
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "passed":
        return <Badge className="bg-green-500">Passed</Badge>;
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      case "skipped":
        return <Badge className="bg-yellow-500">Skipped</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const getCategoryTests = (category: string) => {
    return testData?.results.filter(r => r.category === category) || [];
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">Automated Test Suite</h2>
          <p className="text-muted-foreground">
            Comprehensive API endpoint and integration testing
          </p>
        </div>
        <Button onClick={runTests} disabled={running} size="lg">
          <Play className={`h-4 w-4 mr-2 ${running ? "animate-pulse" : ""}`} />
          {running ? "Running Tests..." : "Run All Tests"}
        </Button>
      </div>

      {/* Test Summary */}
      {testData && (
        <Card>
          <CardHeader>
            <CardTitle>Test Results Summary</CardTitle>
            <CardDescription>
              Completed: {new Date(testData.timestamp).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Total Tests</p>
                <p className="text-2xl font-bold">{testData.summary.total}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Passed</p>
                <p className="text-2xl font-bold text-green-500">
                  {testData.summary.passed}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Failed</p>
                <p className="text-2xl font-bold text-red-500">
                  {testData.summary.failed}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Skipped</p>
                <p className="text-2xl font-bold text-yellow-500">
                  {testData.summary.skipped}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Duration</p>
                <p className="text-2xl font-bold">{testData.summary.duration}ms</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Success Rate</span>
                <span className="font-medium">
                  {((testData.summary.passed / testData.summary.total) * 100).toFixed(1)}%
                </span>
              </div>
              <Progress 
                value={(testData.summary.passed / testData.summary.total) * 100} 
                className="h-2"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Test Results by Category */}
      {testData && testData.categories.length > 0 && (
        <div className="space-y-4">
          {testData.categories.map((category) => {
            const categoryTests = getCategoryTests(category.name);
            const isExpanded = expandedCategories.has(category.name);

            return (
              <Card key={category.name}>
                <Collapsible open={isExpanded} onOpenChange={() => toggleCategory(category.name)}>
                  <CardHeader className="cursor-pointer" onClick={() => toggleCategory(category.name)}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CollapsibleTrigger>
                          {isExpanded ? (
                            <ChevronDown className="h-5 w-5" />
                          ) : (
                            <ChevronRight className="h-5 w-5" />
                          )}
                        </CollapsibleTrigger>
                        <div>
                          <CardTitle className="capitalize">{category.name}</CardTitle>
                          <CardDescription>
                            {category.passed} / {category.total} tests passed
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{category.total} tests</Badge>
                        {category.failed > 0 && (
                          <Badge variant="destructive">{category.failed} failed</Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  
                  <CollapsibleContent>
                    <CardContent>
                      <div className="space-y-2">
                        {categoryTests.map((test, index) => (
                          <div
                            key={index}
                            className="flex items-start justify-between p-3 rounded-lg border"
                          >
                            <div className="flex items-start gap-2 flex-1">
                              {getStatusIcon(test.status)}
                              <div className="flex-1">
                                <p className="font-medium text-sm">{test.name}</p>
                                {test.error && (
                                  <Alert variant="destructive" className="mt-2">
                                    <AlertDescription className="text-xs">
                                      {test.error}
                                    </AlertDescription>
                                  </Alert>
                                )}
                                {test.details && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {JSON.stringify(test.details)}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 ml-4">
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                {test.duration}ms
                              </div>
                              {getStatusBadge(test.status)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      )}

      {!testData && !running && (
        <Alert>
          <AlertDescription>
            No test results yet. Click "Run All Tests" to execute the automated test suite.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
