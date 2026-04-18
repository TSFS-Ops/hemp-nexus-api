import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, Copy, Play, Rocket } from "lucide-react";
import { toast } from "sonner";
import { CodeBlock } from "@/components/ui/code-block";
import { useNavigate } from "react-router-dom";

interface SDKExample {
  id: string;
  language: string;
  example_type: string;
  code_snippet: string;
  description: string;
}

interface QuickstartGuideProps {
  onStartWizard?: () => void;
  onSectionChange?: (section: string) => void;
}

export function QuickstartGuide({ onStartWizard, onSectionChange }: QuickstartGuideProps = {}) {
  const [examples, setExamples] = useState<SDKExample[]>([]);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const navigate = useNavigate();

  useEffect(() => {
    fetchExamples();
    checkApiKey();
  }, []);

  const fetchExamples = async () => {
    const { data } = await supabase
      .from("sdk_examples")
      .select("*")
      .order("language", { ascending: true });

    if (data) setExamples(data);
  };

  const checkApiKey = async () => {
    const { data } = await supabase
      .from("api_keys")
      .select("id, name")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (data) {
      setApiKey(data.id);
      markStepComplete(1);
    }
  };

  const markStepComplete = (step: number) => {
    setCompletedSteps(prev => new Set([...prev, step]));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  const getExamplesByType = (type: string) => {
    return examples.filter(ex => ex.example_type === type);
  };

  const steps = [
    {
      number: 1,
      title: "Create API Key",
      description: "Generate your first API key to start making requests",
      action: () => {
        if (onSectionChange) {
          onSectionChange("keys");
        }
      },
      actionLabel: "Create Key",
      completed: apiKey !== null,
    },
    {
      number: 2,
      title: "Run Your First API Call",
      description: "Copy and run the example below to create your first signal",
      completed: completedSteps.has(2),
    },
    {
      number: 3,
      title: "View Your Data",
      description: "Check the dashboard to see your signals and matches",
      action: () => {
        markStepComplete(3);
        if (onSectionChange) {
          onSectionChange("matches");
        }
      },
      actionLabel: "View Dashboard",
      completed: completedSteps.has(3),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Rocket className="h-8 w-8 text-primary" />
            Quick Start Guide
          </h2>
          <p className="text-muted-foreground mt-2">
            Get from zero to your first match in under 10 minutes
          </p>
        </div>
        {onStartWizard && (
          <Button onClick={onStartWizard} variant="outline" className="gap-2">
            <Play className="h-4 w-4" />
            Start Wizard
          </Button>
        )}
      </div>

      {/* Progress Steps */}
      <div className="grid gap-4 md:grid-cols-3">
        {steps.map((step) => (
          <Card key={step.number} className={step.completed ? "border-green-500" : ""}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <Badge variant="outline" className="mb-2">
                    Step {step.number}
                  </Badge>
                  <CardTitle className="text-lg flex items-center gap-2">
                    {step.title}
                    {step.completed && (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    )}
                  </CardTitle>
                </div>
              </div>
              <CardDescription>{step.description}</CardDescription>
            </CardHeader>
            {step.action && !step.completed && (
              <CardContent>
                <Button onClick={step.action} size="sm" className="w-full">
                  <Play className="h-4 w-4 mr-2" />
                  {step.actionLabel}
                </Button>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* Code Examples */}
      <Card>
        <CardHeader>
          <CardTitle>Reference Implementation</CardTitle>
          <CardDescription>
            Select a language to review a sample integration request.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="curl" className="w-full">
            <TabsList className="flex w-full h-auto gap-1 p-1">
              <TabsTrigger value="curl" className="flex-1">cURL</TabsTrigger>
              <TabsTrigger value="typescript" className="flex-1">TypeScript</TabsTrigger>
              <TabsTrigger value="python" className="flex-1">Python</TabsTrigger>
            </TabsList>

            <TabsContent value="curl" className="space-y-4">
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold mb-2">Create a Signal</h4>
                  {getExamplesByType("create_signal")
                    .filter(ex => ex.language === "curl")
                    .map((example) => (
                      <CodeBlock key={example.id} code={example.code_snippet} language="bash" />
                    ))}
                  <Button 
                    onClick={() => markStepComplete(2)}
                    variant="outline"
                    className="w-full mt-4"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Mark as Complete
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="typescript" className="space-y-4">
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold mb-2">Install the SDK</h4>
                  <CodeBlock code="npm install @compliance-matching/sdk" language="bash" />
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Create a Signal</h4>
                  {getExamplesByType("create_signal")
                    .filter(ex => ex.language === "typescript")
                    .map((example) => (
                      <CodeBlock key={example.id} code={example.code_snippet} language="typescript" />
                    ))}
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Create a Match</h4>
                  {getExamplesByType("create_match")
                    .filter(ex => ex.language === "typescript")
                    .map((example) => (
                      <CodeBlock key={example.id} code={example.code_snippet} language="typescript" />
                    ))}
                  <Button 
                    onClick={() => markStepComplete(2)}
                    variant="outline"
                    className="w-full mt-4"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Mark as Complete
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="python" className="space-y-4">
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold mb-2">Install the SDK</h4>
                  <CodeBlock code="pip install compliance-matching" language="bash" />
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Create a Signal</h4>
                  {getExamplesByType("create_signal")
                    .filter(ex => ex.language === "python")
                    .map((example) => (
                      <CodeBlock key={example.id} code={example.code_snippet} language="python" />
                    ))}
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Create a Match</h4>
                  {getExamplesByType("create_match")
                    .filter(ex => ex.language === "python")
                    .map((example) => (
                      <CodeBlock key={example.id} code={example.code_snippet} language="python" />
                    ))}
                  <Button 
                    onClick={() => markStepComplete(2)}
                    variant="outline"
                    className="w-full mt-4"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Mark as Complete
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Next Steps */}
      <Card>
        <CardHeader>
          <CardTitle>Next Steps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <button 
              onClick={() => onSectionChange?.("docs")}
              className="text-primary hover:underline cursor-pointer"
            >
              Read the full API Documentation
            </button>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <button 
              onClick={() => onSectionChange?.("webhooks")}
              className="text-primary hover:underline cursor-pointer"
            >
              Set up Webhooks to receive real-time notifications
            </button>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <button 
              onClick={() => onSectionChange?.("audit-logs")}
              className="text-primary hover:underline cursor-pointer"
            >
              Explore Audit Logs for compliance tracking
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
