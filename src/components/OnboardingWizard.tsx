import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { 
  CheckCircle2, 
  Circle, 
  Rocket, 
  Key, 
  Play, 
  Trophy,
  Loader2,
  Copy,
  ArrowRight,
  Sparkles,
  Globe,
  Info,
  Search,
  FileText,
  Zap
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { ROUTES } from "@/lib/constants";

const ONBOARDING_STORAGE_KEY = "onboarding_state";

interface OnboardingStep {
  id: number;
  title: string;
  description: string;
  icon: any;
  completed: boolean;
}

interface OnboardingWizardProps {
  open: boolean;
  onClose: () => void;
}

interface SavedOnboardingState {
  currentStep: number;
  apiKeyCreated: boolean;
  testPassed: boolean;
  selectedRegion: string;
}

function saveOnboardingProgress(state: SavedOnboardingState) {
  try {
    sessionStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

function loadOnboardingProgress(): SavedOnboardingState | null {
  try {
    const raw = sessionStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedOnboardingState;
  } catch {
    return null;
  }
}

function clearOnboardingProgress() {
  try { sessionStorage.removeItem(ONBOARDING_STORAGE_KEY); } catch { /* ignore */ }
}

export default function OnboardingWizard({ open, onClose }: OnboardingWizardProps) {
  // Restore saved progress
  const savedState = loadOnboardingProgress();
  
  const [currentStep, setCurrentStep] = useState(savedState?.currentStep ?? 1);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyCreated, setApiKeyCreated] = useState(savedState?.apiKeyCreated ?? false);
  const [keyName, setKeyName] = useState("My First API Key");
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(savedState?.testPassed ? "success" : null);
  const [errorDetails, setErrorDetails] = useState<{
    status?: number;
    statusText?: string;
    message?: string;
    response?: any;
  } | null>(null);
  const [requestDetails, setRequestDetails] = useState<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body: any;
  } | null>(null);
  const [responseDetails, setResponseDetails] = useState<any>(null);
  const [showDebugger, setShowDebugger] = useState(false);

  const [selectedRegion, setSelectedRegion] = useState(savedState?.selectedRegion ?? "za-jnb");
  const navigate = useNavigate();

  // Persist progress on step changes
  useEffect(() => {
    if (open) {
      saveOnboardingProgress({
        currentStep,
        apiKeyCreated,
        testPassed: testResult === "success",
        selectedRegion,
      });
    }
  }, [currentStep, apiKeyCreated, testResult, selectedRegion, open]);

  const DATA_REGIONS = [
    { value: "za-jnb", label: "South Africa (Johannesburg)", flag: "🇿🇦" },
    { value: "eu-west", label: "Europe (Ireland)", flag: "🇪🇺" },
    { value: "us-east", label: "United States (Virginia)", flag: "🇺🇸" },
    { value: "ae-dubai", label: "UAE (Dubai)", flag: "🇦🇪" },
    { value: "sg-sin", label: "Singapore", flag: "🇸🇬" },
  ];

  const steps: OnboardingStep[] = [
    {
      id: 1,
      title: "Welcome",
      description: "Understand how the platform works",
      icon: Rocket,
      completed: currentStep > 1
    },
    {
      id: 2,
      title: "Your Organisation",
      description: "Review your org and data region",
      icon: Globe,
      completed: currentStep > 2
    },
    {
      id: 3,
      title: "Run a Search",
      description: "Find counterparties for your commodity",
      icon: Search,
      completed: currentStep > 3
    },
    {
      id: 4,
      title: "Next Steps",
      description: "What to do after your first search",
      icon: Trophy,
      completed: currentStep > 4
    }
  ];

  const progress = (currentStep / steps.length) * 100;

  const handleCreateApiKey = async () => {
    setCreating(true);
    try {
      const data = await apiFetch<{ key: string }>("api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: keyName,
          scopes: ["signals:write", "signals:read"],
          expires_at: null,
          environment: "sandbox"
        }),
      });
      setApiKey(data.key);
      setApiKeyCreated(true);
      
      try {
        await navigator.clipboard.writeText(data.key);
        toast.success("API key created and copied to clipboard!");
      } catch {
        toast.success("API key created! Copy it from the field below — it won't be shown again.");
      }
      
      const timer = setTimeout(() => {
        if (open) setCurrentStep(4);
      }, 1500);
      return () => clearTimeout(timer);
    } catch (error) {
      console.error("Error creating API key:", error);
      toast.error("Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const handleTestApi = async () => {
    if (!apiKey) {
      toast.error("No API key available");
      return;
    }

    setTesting(true);
    setTestResult(null);
    setErrorDetails(null);
    setRequestDetails(null);
    setResponseDetails(null);

    try {
      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
      const url = `${baseUrl}/signals`;
      const requestBody = {
        product: "Test Product (Onboarding)",
        quantity: 100,
        unit: "units",
        location: "Test Location",
        deliveryWindow: {
          start: "2024-01-01",
          end: "2024-03-31"
        },
        budget: 1000,
        currency: "USD"
      };

      const headers = {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      };

      setRequestDetails({
        url,
        method: "POST",
        headers: {
          "x-api-key": `${apiKey.substring(0, 20)}...`,
          "Content-Type": "application/json",
        },
        body: requestBody
      });
      
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody)
      });

      const responseData = await response.json().catch(() => null);
      setResponseDetails(responseData);

      if (response.ok) {
        setTestResult("success");
        toast.success("API test successful!");
        
        setTimeout(() => {
          if (open) setCurrentStep(5);
        }, 1500);
      } else {
        setTestResult("error");
        setErrorDetails({
          status: response.status,
          statusText: response.statusText,
          message: responseData?.message || responseData?.error || "API request failed",
          response: responseData
        });
        toast.error(`API test failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error("Test error:", error);
      setTestResult("error");
      setErrorDetails({
        message: error instanceof Error ? error.message : "Network error during test",
        response: null
      });
      toast.error("Network error during test");
    } finally {
      setTesting(false);
    }
  };

  const handleCopyKey = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      toast.success("API key copied!");
    } catch {
      // Fallback: select the text for manual copy
      const el = document.querySelector<HTMLElement>("[data-api-key-display]");
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      toast.info("Could not copy automatically. Please select and copy the key manually.");
    }
  };

  const handleComplete = () => {
    localStorage.setItem("onboarding_completed", "true");
    clearOnboardingProgress();
    onClose();
  };

  const handleSkip = () => {
    localStorage.setItem("onboarding_completed", "true");
    clearOnboardingProgress();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleSkip()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Getting Started Wizard
          </DialogTitle>
        </DialogHeader>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Step {currentStep} of {steps.length}</span>
            <span className="font-medium">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Step Indicators */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-2 px-2 lg:justify-between lg:gap-0 lg:mx-0 lg:px-0 lg:overflow-visible">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = currentStep === step.id;
            const isCompleted = step.completed;
            
            return (
              <div key={step.id} className="flex flex-col items-center flex-shrink-0 min-w-[60px] lg:flex-1 lg:min-w-0 relative">
                <div className={`
                  w-8 h-8 lg:w-10 lg:h-10 rounded-full flex items-center justify-center
                  ${isCompleted ? 'bg-green-500 text-white' : 
                    isActive ? 'bg-primary text-primary-foreground' : 
                    'bg-muted text-muted-foreground'}
                  transition-colors
                `}>
                  {isCompleted ? <CheckCircle2 className="h-4 w-4 lg:h-5 lg:w-5" /> : <Icon className="h-4 w-4 lg:h-5 lg:w-5" />}
                </div>
                <span className={`text-[10px] lg:text-xs mt-1 text-center whitespace-nowrap ${isActive ? 'font-medium' : 'text-muted-foreground'}`}>
                  {step.title}
                </span>
                {index < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-4 lg:top-5 h-0.5 bg-muted -z-10" 
                       style={{ left: '60%', width: '80%' }} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step Content */}
        <div className="min-h-[300px] flex flex-col justify-center">
          {/* Step 1: Welcome */}
          {currentStep === 1 && (
            <div className="space-y-6 text-center">
              <div className="flex justify-center">
                <div className="p-4 bg-primary/10 rounded-full">
                  <Rocket className="h-12 w-12 text-primary" />
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-bold">Welcome to the Compliance Matching API! 🎉</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  This quick wizard will help you create your first API key and make your first API call. 
                  It takes less than 2 minutes!
                </p>
              </div>
              <Alert className="text-left">
                <AlertDescription>
                  <strong>What you'll do:</strong>
                  <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
                    <li>Create a sandbox API key (safe for testing)</li>
                    <li>Make your first API call</li>
                    <li>See a successful response</li>
                  </ol>
                </AlertDescription>
              </Alert>
              <Alert className="text-left" variant="default">
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <strong>What is an organisation?</strong> When you signed up, an organisation was created for you automatically.
                  It represents your company or team on the platform. API keys, matches, and compliance records all belong to your organisation.
                  You can manage it later under Account settings.
                </AlertDescription>
              </Alert>
              <Button onClick={() => setCurrentStep(2)} size="lg" className="w-full">
                Let's Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button variant="ghost" onClick={handleSkip} className="w-full">
                Skip for now
              </Button>
            </div>
          )}

          {/* Step 2: Data Region Selection */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-xl font-bold">Data Region Preference</h3>
                <p className="text-muted-foreground">
                  Indicate your preferred data region. This helps us understand your compliance requirements.
                </p>
              </div>

              <div className="space-y-2">
                {DATA_REGIONS.map((region) => (
                  <Card
                    key={region.value}
                    className={`p-4 cursor-pointer transition-colors ${
                      selectedRegion === region.value
                        ? "border-primary bg-primary/5"
                        : "hover:border-muted-foreground/30"
                    }`}
                    onClick={() => setSelectedRegion(region.value)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{region.flag}</span>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{region.label}</p>
                        <p className="text-xs text-muted-foreground">Region: {region.value}</p>
                      </div>
                      {selectedRegion === region.value && (
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                      )}
                    </div>
                  </Card>
                ))}
              </div>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <strong>Advisory only.</strong> Data region selection is recorded as a preference but is not yet enforced. 
                  All data is currently stored in a single region. Multi-region deployment is on our roadmap. 
                  Contact support@izenzo.co.za if you have specific data residency requirements.
                </AlertDescription>
              </Alert>

              <Button onClick={async () => {
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  if (session) {
                    const { data: profile } = await supabase.from("profiles").select("org_id").eq("id", session.user.id).maybeSingle();
                    if (profile?.org_id) {
                      await supabase.from("organizations").update({ data_residency_region: selectedRegion } as any).eq("id", profile.org_id);
                    }
                  }
                } catch (e) {
                  console.error("Failed to save region preference:", e);
                }
                setCurrentStep(3);
              }} size="lg" className="w-full">
                Continue
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Step 3: Create API Key */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-xl font-bold">Create Your First API Key</h3>
                <p className="text-muted-foreground">
                  API keys authenticate your requests. We'll create a sandbox key for safe testing.
                </p>
              </div>

              {/* If key was already created in a previous session but user came back */}
              {apiKeyCreated && !apiKey ? (
                <div className="space-y-4">
                  <Alert>
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <AlertDescription>
                      You already created an API key in a previous session. You can skip this step or create another one.
                    </AlertDescription>
                  </Alert>
                  <Button onClick={() => setCurrentStep(4)} size="lg" className="w-full">
                    Continue to Testing
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              ) : !apiKey ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="key-name">Key Name</Label>
                    <Input
                      id="key-name"
                      value={keyName}
                      onChange={(e) => setKeyName(e.target.value)}
                      placeholder="e.g., My First API Key"
                    />
                    <p className="text-xs text-muted-foreground">
                      Give your key a descriptive name to identify it later
                    </p>
                  </div>

                  <Alert>
                    <AlertDescription>
                      <strong>This key will have:</strong>
                      <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
                        <li>Sandbox environment (safe for testing)</li>
                        <li>Read and write signals permissions</li>
                        <li>No expiry date</li>
                      </ul>
                    </AlertDescription>
                  </Alert>

                  <Button 
                    onClick={handleCreateApiKey} 
                    disabled={creating || !keyName} 
                    className="w-full"
                    size="lg"
                  >
                    {creating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Key className="mr-2 h-4 w-4" />
                        Create API Key
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <AlertDescription className="text-green-800 dark:text-green-200">
                      <strong>API key created successfully!</strong>
                      <p className="text-sm mt-1">It's been copied to your clipboard.</p>
                    </AlertDescription>
                  </Alert>

                  <Card className="p-4">
                    <Label className="text-sm font-medium mb-2 block">Your API Key</Label>
                    <div className="flex gap-2">
                      <code data-api-key-display className="flex-1 p-2 bg-muted rounded text-sm font-mono break-all select-all">
                        {apiKey}
                      </code>
                      <Button variant="outline" size="icon" onClick={handleCopyKey}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      ⚠️ Save this key securely - you won't be able to see it again!
                    </p>
                  </Card>

                  <Button onClick={() => setCurrentStep(4)} size="lg" className="w-full">
                    Continue to Testing
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Step 4: Test API */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-xl font-bold">Test Your API Key</h3>
                <p className="text-muted-foreground">
                  Let's make your first API call to the signals endpoint.
                </p>
              </div>

              <Card className="p-4 bg-muted/30">
                <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap">
{`POST /functions/v1/signals
{
  "product": "Test Product",
  "quantity": 100,
  "unit": "units",
  "location": "Test Location"
}`}
                </pre>
              </Card>

              <Button
                onClick={handleTestApi}
                disabled={testing || !apiKey}
                size="lg"
                className="w-full"
              >
                {testing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Run API Test
                  </>
                )}
              </Button>

              {!apiKey && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    No API key in this session. Go back to create one, or skip this step if you already have a key.
                  </AlertDescription>
                </Alert>
              )}

              {testResult === "success" && (
                <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <AlertDescription className="text-green-800 dark:text-green-200">
                    <strong>API test successful!</strong> Your key is working.
                  </AlertDescription>
                </Alert>
              )}

              {testResult === "error" && errorDetails && (
                <Alert variant="destructive">
                  <AlertDescription>
                    <strong>Test failed:</strong> {errorDetails.message}
                    {errorDetails.status && <span className="ml-1">(HTTP {errorDetails.status})</span>}
                  </AlertDescription>
                </Alert>
              )}

              {!apiKey && (
                <Button variant="outline" onClick={() => setCurrentStep(5)} className="w-full">
                  Skip test — continue to summary
                </Button>
              )}
            </div>
          )}

          {/* Step 5: Complete — Summary */}
          {currentStep === 5 && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="flex justify-center">
                  <div className="p-4 bg-green-100 dark:bg-green-900/30 rounded-full">
                    <Trophy className="h-12 w-12 text-green-600" />
                  </div>
                </div>
                <h3 className="text-2xl font-bold mt-4">Setup Complete 🎉</h3>
                <p className="text-muted-foreground max-w-md mx-auto mt-2">
                  Here's a summary of what was set up and what to do next.
                </p>
              </div>

              {/* Summary */}
              <Card className="p-4 space-y-3">
                <h4 className="font-semibold text-sm">What was completed</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    <span>Data region preference recorded: {DATA_REGIONS.find(r => r.value === selectedRegion)?.label ?? selectedRegion}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {apiKeyCreated ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span>{apiKeyCreated ? "Sandbox API key created" : "API key creation skipped"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {testResult === "success" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span>{testResult === "success" ? "API test passed" : "API test skipped"}</span>
                  </div>
                </div>
              </Card>

              {/* Next steps */}
              <Card className="p-4 space-y-3">
                <h4 className="font-semibold text-sm">Recommended next steps</h4>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-primary shrink-0" />
                    <span>Search for counterparties to find potential matches</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <span>Create a match and add commercial terms</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary shrink-0" />
                    <span>Signal intent to record your interest</span>
                  </div>
                </div>
              </Card>

              <div className="flex flex-col gap-2">
                <Button onClick={() => { handleComplete(); navigate(ROUTES.DASHBOARD_SEARCH); }} size="lg" className="w-full gap-2">
                  <Search className="h-4 w-4" />
                  Search for counterparties
                </Button>
                <Button variant="outline" onClick={handleComplete} className="w-full">
                  Go to Console
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
