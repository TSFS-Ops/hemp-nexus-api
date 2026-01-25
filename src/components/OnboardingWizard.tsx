import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
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
  Sparkles
} from "lucide-react";
import { toast } from "sonner";

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

export default function OnboardingWizard({ open, onClose }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyName, setKeyName] = useState("My First API Key");
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
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

  const steps: OnboardingStep[] = [
    {
      id: 1,
      title: "Welcome",
      description: "Let's get you started with the API",
      icon: Rocket,
      completed: currentStep > 1
    },
    {
      id: 2,
      title: "Create API Key",
      description: "Generate your first API key",
      icon: Key,
      completed: currentStep > 2 || !!apiKey
    },
    {
      id: 3,
      title: "Test API",
      description: "Make your first API call",
      icon: Play,
      completed: currentStep > 3 || testResult === "success"
    },
    {
      id: 4,
      title: "You're Ready!",
      description: "Start building amazing things",
      icon: Trophy,
      completed: currentStep > 4
    }
  ];

  const progress = (currentStep / steps.length) * 100;

  const handleCreateApiKey = async () => {
    setCreating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Please log in to create an API key");
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-keys`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            name: keyName,
            scopes: ["signals:write", "signals:read"],
            expires_at: null,
            environment: "sandbox"
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to create API key");
      }

      const data = await response.json();
      setApiKey(data.key);
      
      // Auto-copy to clipboard
      await navigator.clipboard.writeText(data.key);
      
      toast.success("API key created and copied to clipboard!");
      
      // Auto-advance after a short delay
      setTimeout(() => {
        setCurrentStep(3);
      }, 1500);
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

      // Store request details
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
        
        // Auto-advance after a short delay
        setTimeout(() => {
          setCurrentStep(4);
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

  const handleCopyKey = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      toast.success("API key copied!");
    }
  };

  const handleComplete = () => {
    // Mark onboarding as complete in localStorage
    localStorage.setItem("onboarding_completed", "true");
    onClose();
    toast.success("You're all set! Happy building!");
  };

  const handleSkip = () => {
    localStorage.setItem("onboarding_completed", "true");
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

        {/* Step Indicators - scrollable on mobile, flex on desktop */}
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
                {/* Connector line - only visible on desktop */}
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
              <Button onClick={() => setCurrentStep(2)} size="lg" className="w-full">
                Let's Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button variant="ghost" onClick={handleSkip} className="w-full">
                Skip for now
              </Button>
            </div>
          )}

          {/* Step 2: Create API Key */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-xl font-bold">Create Your First API Key</h3>
                <p className="text-muted-foreground">
                  API keys authenticate your requests. We'll create a sandbox key for safe testing.
                </p>
              </div>

              {!apiKey ? (
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
                      <code className="flex-1 p-2 bg-muted rounded text-sm font-mono break-all">
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

                  <Button onClick={() => setCurrentStep(3)} size="lg" className="w-full">
                    Continue to Testing
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Test API */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-xl font-bold">Test Your API Connection</h3>
                <p className="text-muted-foreground">
                  Let's make sure everything is working by creating a test signal.
                </p>
              </div>

              {!testResult ? (
                <div className="space-y-4">
                  <Alert>
                    <AlertDescription>
                      <strong>What we'll do:</strong>
                      <p className="text-sm mt-1">
                        Send a POST request to /signals to create a test buyer signal for "Test Product". 
                        This is a safe sandbox request that won't affect real data.
                      </p>
                    </AlertDescription>
                  </Alert>

                  <Card className="p-4 bg-muted">
                    <div className="text-xs font-mono space-y-1">
                      <div><span className="text-green-600">POST</span> /signals</div>
                      <div className="text-muted-foreground">x-api-key: {apiKey?.substring(0, 20)}...</div>
                      <div className="mt-2 text-muted-foreground">
                        {`{ product: "Test Product", quantity: 100, unit: "units"... }`}
                      </div>
                    </div>
                  </Card>

                  <Button 
                    onClick={handleTestApi} 
                    disabled={testing || !apiKey} 
                    className="w-full"
                    size="lg"
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

                  <Button 
                    onClick={() => setCurrentStep(4)} 
                    variant="ghost" 
                    size="sm" 
                    className="w-full"
                  >
                    Skip Test (Not Recommended)
                  </Button>
                </div>
              ) : testResult === "success" ? (
                <div className="space-y-4">
                  <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <AlertDescription className="text-green-800 dark:text-green-200">
                      <strong>API test successful! 🎉</strong>
                      <p className="text-sm mt-1">
                        Your signal was created successfully. Your API setup is working perfectly!
                      </p>
                    </AlertDescription>
                  </Alert>

                  <Card className="p-4">
                    <div className="text-sm space-y-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <span className="font-medium">Status: 200 OK</span>
                      </div>
                      <div className="text-muted-foreground">
                        Response: Signal created with ID and matched options returned
                      </div>
                    </div>
                  </Card>

                  {/* Debug Toggle Button */}
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setShowDebugger(!showDebugger)}
                    className="w-full"
                  >
                    {showDebugger ? "Hide" : "Show"} Request/Response Details
                  </Button>

                  {/* Debug Panel for Success */}
                  {showDebugger && (
                    <Card className="p-4 bg-muted">
                      <div className="space-y-4">
                        {/* Request Details */}
                        {requestDetails && (
                          <div className="space-y-2">
                            <h4 className="text-sm font-semibold">Request</h4>
                            <div className="text-xs font-mono space-y-1 bg-background p-3 rounded border">
                              <div className="text-green-600 font-bold">
                                {requestDetails.method} {requestDetails.url}
                              </div>
                              <div className="text-muted-foreground mt-2">Headers:</div>
                              {Object.entries(requestDetails.headers).map(([key, value]) => (
                                <div key={key} className="ml-2">
                                  <span className="text-blue-600">{key}:</span> {value}
                                </div>
                              ))}
                              <div className="text-muted-foreground mt-2">Body:</div>
                              <pre className="ml-2 text-xs overflow-x-auto">
                                {JSON.stringify(requestDetails.body, null, 2)}
                              </pre>
                            </div>
                          </div>
                        )}

                        {/* Response Details */}
                        {responseDetails && (
                          <div className="space-y-2">
                            <h4 className="text-sm font-semibold">Response</h4>
                            <div className="text-xs font-mono bg-background p-3 rounded border">
                              <div className="text-green-600 font-bold mb-2">
                                Status: 200 OK
                              </div>
                              <pre className="text-xs overflow-x-auto">
                                {JSON.stringify(responseDetails, null, 2)}
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    </Card>
                  )}

                  <Button onClick={() => setCurrentStep(4)} size="lg" className="w-full">
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <Alert variant="destructive">
                    <AlertDescription>
                      <strong>Test failed</strong>
                      {errorDetails?.status && (
                        <p className="text-sm mt-1 font-mono">
                          Status: {errorDetails.status} {errorDetails.statusText}
                        </p>
                      )}
                      <p className="text-sm mt-1">
                        {errorDetails?.message || "The API test did not complete successfully."}
                      </p>
                    </AlertDescription>
                  </Alert>

                  {/* Error Details Card */}
                  {errorDetails && (
                    <Card className="p-4 border-destructive">
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold">Error Details</h4>
                        <div className="text-xs space-y-1">
                          {errorDetails.status && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">HTTP Status:</span>
                              <span className="font-mono">{errorDetails.status}</span>
                            </div>
                          )}
                          {errorDetails.message && (
                            <div className="flex flex-col gap-1">
                              <span className="text-muted-foreground">Error Message:</span>
                              <code className="text-xs bg-muted p-2 rounded block break-all">
                                {errorDetails.message}
                              </code>
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  )}

                  {/* Debug Toggle Button */}
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setShowDebugger(!showDebugger)}
                    className="w-full"
                  >
                    {showDebugger ? "Hide" : "Show"} Request/Response Details
                  </Button>

                  {/* Debug Panel */}
                  {showDebugger && (
                    <Card className="p-4 bg-muted">
                      <div className="space-y-4">
                        {/* Request Details */}
                        {requestDetails && (
                          <div className="space-y-2">
                            <h4 className="text-sm font-semibold">Request</h4>
                            <div className="text-xs font-mono space-y-1 bg-background p-3 rounded border">
                              <div className="text-green-600 font-bold">
                                {requestDetails.method} {requestDetails.url}
                              </div>
                              <div className="text-muted-foreground mt-2">Headers:</div>
                              {Object.entries(requestDetails.headers).map(([key, value]) => (
                                <div key={key} className="ml-2">
                                  <span className="text-blue-600">{key}:</span> {value}
                                </div>
                              ))}
                              <div className="text-muted-foreground mt-2">Body:</div>
                              <pre className="ml-2 text-xs overflow-x-auto">
                                {JSON.stringify(requestDetails.body, null, 2)}
                              </pre>
                            </div>
                          </div>
                        )}

                        {/* Response Details */}
                        {responseDetails && (
                          <div className="space-y-2">
                            <h4 className="text-sm font-semibold">Response</h4>
                            <div className="text-xs font-mono bg-background p-3 rounded border">
                              {errorDetails?.status && (
                                <div className="text-red-600 font-bold mb-2">
                                  Status: {errorDetails.status} {errorDetails.statusText}
                                </div>
                              )}
                              <pre className="text-xs overflow-x-auto">
                                {JSON.stringify(responseDetails, null, 2)}
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    </Card>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2">
                    <Button onClick={handleTestApi} variant="outline" className="flex-1">
                      Try Again
                    </Button>
                    <Button onClick={() => setCurrentStep(4)} variant="secondary" className="flex-1">
                      Skip Test
                    </Button>
                  </div>

                  <Alert>
                    <AlertDescription className="text-xs">
                      <strong>Need help?</strong> If the test continues to fail, you can skip it and access 
                      the Troubleshooting page from the dashboard to diagnose the issue.
                    </AlertDescription>
                  </Alert>
                </div>
              )}
            </div>
          )}

          {/* Step 4: Complete */}
          {currentStep === 4 && (
            <div className="space-y-6 text-center">
              <div className="flex justify-center">
                <div className="p-4 bg-green-500/10 rounded-full">
                  <Trophy className="h-12 w-12 text-green-500" />
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-bold">You're All Set! 🚀</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Congratulations! You've created your API key and made your first successful API call.
                </p>
              </div>
              <Alert className="text-left">
                <AlertDescription>
                  <strong>What's next?</strong>
                  <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
                    <li>Explore the API Playground to test more endpoints</li>
                    <li>Check out the documentation for detailed guides</li>
                    <li>Set up webhooks for real-time notifications</li>
                    <li>Review the troubleshooting page for common issues</li>
                  </ul>
                </AlertDescription>
              </Alert>
              <Button onClick={handleComplete} size="lg" className="w-full">
                Go to Dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
