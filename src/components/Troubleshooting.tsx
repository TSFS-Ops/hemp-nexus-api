import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  AlertTriangle, 
  Search, 
  CheckCircle2, 
  XCircle, 
  HelpCircle,
  Lock,
  Key,
  Zap,
  Globe,
  Database
} from "lucide-react";

interface ErrorCode {
  code: string;
  status: number;
  title: string;
  description: string;
  causes: string[];
  solutions: string[];
  icon: any;
}

interface FAQ {
  question: string;
  answer: string;
  category: string;
}

export default function Troubleshooting() {
  const [searchQuery, setSearchQuery] = useState("");

  const errorCodes: ErrorCode[] = [
    {
      code: "AUTH_001",
      status: 401,
      title: "Unauthorised - Invalid API Key",
      description: "The API key provided is invalid or has been revoked.",
      causes: [
        "API key was typed incorrectly",
        "API key has been revoked",
        "API key has expired",
        "Wrong API key for the environment (sandbox vs production)"
      ],
      solutions: [
        "Verify your API key is copied correctly with no extra spaces",
        "Check that the API key status is 'active' in the Authentication tab",
        "Create a new API key if the old one was revoked or expired",
        "Ensure you're using the correct key for your environment"
      ],
      icon: Lock
    },
    {
      code: "AUTH_002",
      status: 403,
      title: "Forbidden - Insufficient Permissions",
      description: "Your API key doesn't have the required scopes for this operation.",
      causes: [
        "API key missing required scope (e.g., signals:write)",
        "Attempting to access another organization's resources",
        "API key created with limited permissions"
      ],
      solutions: [
        "Check your API key scopes in the Authentication tab",
        "Create a new API key with the required scopes",
        "For signals, ensure you have 'signals:write' and 'signals:read' scopes",
        "For webhooks, ensure you have 'webhooks:write' and 'webhooks:read' scopes"
      ],
      icon: Key
    },
    {
      code: "VAL_001",
      status: 400,
      title: "Validation Error - Invalid Request Format",
      description: "The request body contains invalid or missing required fields.",
      causes: [
        "Missing required fields (e.g., product, quantity)",
        "Invalid data types (e.g., string instead of number)",
        "Malformed JSON in request body",
        "Invalid enum values"
      ],
      solutions: [
        "Check the API documentation for required fields",
        "Ensure all numbers are sent as numbers, not strings",
        "Validate your JSON syntax using a JSON validator",
        "Review the example requests in the API Playground"
      ],
      icon: AlertTriangle
    },
    {
      code: "RATE_001",
      status: 429,
      title: "Rate Limit Exceeded",
      description: "You've exceeded the allowed number of requests per hour.",
      causes: [
        "Making too many requests in a short period",
        "Retry logic without exponential backoff",
        "Multiple clients using the same API key"
      ],
      solutions: [
        "Wait for the rate limit window to reset (shown in Retry-After header)",
        "Implement exponential backoff in your retry logic",
        "Consider upgrading your plan for higher limits",
        "Batch operations where possible instead of individual requests"
      ],
      icon: Zap
    },
    {
      code: "NET_001",
      status: 0,
      title: "Network Error - Connection Failed",
      description: "Unable to connect to the API server.",
      causes: [
        "Internet connection issues",
        "Firewall or corporate proxy blocking requests",
        "API endpoint URL incorrect",
        "DNS resolution failure"
      ],
      solutions: [
        "Check your internet connection",
        "Verify the API base URL is correct - it should match your project's backend URL under /functions/v1",
        "Check if your network/firewall allows HTTPS requests",
        "Try the request from a different network"
      ],
      icon: Globe
    },
    {
      code: "SRV_001",
      status: 500,
      title: "Internal Server Error",
      description: "An unexpected error occurred on the server.",
      causes: [
        "Temporary server issue",
        "Database connection problem",
        "Unexpected data format causing processing error"
      ],
      solutions: [
        "Wait a few minutes and retry the request",
        "Check the status page for any ongoing incidents",
        "If the issue persists, contact support with your request details",
        "Implement retry logic with exponential backoff"
      ],
      icon: Database
    }
  ];

  const faqs: FAQ[] = [
    {
      category: "Getting Started",
      question: "How do I get started with the API?",
      answer: "Start by creating an API key in the Authentication tab. Then, use the Quick Start guide or API Playground to make your first request. We recommend running the smoke tests to verify your setup."
    },
    {
      category: "Getting Started",
      question: "What are smoke tests and should I run them?",
      answer: "Smoke tests are quick validation tests that check if your API setup is working correctly. They test creating matches, generating hashes, and confirming intent. Running them helps identify any setup issues before you start building your integration."
    },
    {
      category: "Getting Started",
      question: "Do I need separate API keys for testing and production?",
      answer: "Yes, it's recommended to create separate API keys for sandbox/testing and production environments. This allows you to test safely without affecting real data and makes it easier to revoke test keys if needed."
    },
    {
      category: "Authentication",
      question: "Where do I find my API key after creating it?",
      answer: "API keys are only shown once when created and are automatically copied to your clipboard. If you lose it, you cannot recover it - you'll need to create a new API key. Store keys securely in environment variables or a password manager."
    },
    {
      category: "Authentication",
      question: "Why can't I paste my API key in the playground?",
      answer: "You can paste using Ctrl+V (Windows/Linux) or Cmd+V (Mac). Make sure you're clicking in the input field first. The API key field accepts pasting normally - if it's not working, try a different browser or check your clipboard contents."
    },
    {
      category: "Authentication",
      question: "How long are API keys valid?",
      answer: "By default, API keys never expire unless you set an expiry date when creating them. You'll receive a warning email 7 days before an API key expires. You can revoke keys at any time in the Authentication tab."
    },
    {
      category: "API Usage",
      question: "What's the difference between signals and matches?",
      answer: "Signals express intent to trade (I want to buy X or I have Y to sell). Matches are confirmed agreements between a buyer and seller. Signals help discover opportunities, while matches create an immutable audit trail of the agreement."
    },
    {
      category: "API Usage",
      question: "Does 'settling' a match create a binding contract?",
      answer: "No. Settling (confirming intent) only records that both parties are interested. It does not create a legal contract, trigger payment, or create any binding obligation. It's purely an intent confirmation to help the seller prepare final terms."
    },
    {
      category: "API Usage",
      question: "What are scopes and which ones do I need?",
      answer: "Scopes control what your API key can do. For basic testing, you need 'signals:read' and 'signals:write'. Add other scopes (webhooks, data-sources, consents) only if you're using those features. You can always create a new key with different scopes later."
    },
    {
      category: "Errors",
      question: "I'm getting 'Unauthorised' errors. What's wrong?",
      answer: "This usually means your API key is invalid, expired, or copied incorrectly. Check: 1) The key has no extra spaces or characters, 2) The key status is 'active' in your dashboard, 3) You're using the correct key for your environment."
    },
    {
      category: "Errors",
      question: "Why am I getting 'Forbidden' errors even with a valid key?",
      answer: "Your API key lacks the required permissions (scopes). Check which scopes your key has in the Authentication tab. For example, creating signals requires 'signals:write' scope. Create a new key with the necessary scopes."
    },
    {
      category: "Errors",
      question: "The tests show 'Request Failed' - what should I check?",
      answer: "Common causes: 1) Invalid or missing API key, 2) Incorrect API endpoint URL, 3) Network/firewall blocking the request, 4) Missing required fields in the request body. Check the error message for specific details."
    },
    {
      category: "Integration",
      question: "How do I test without affecting production data?",
      answer: "Use the sandbox environment by creating API keys marked as 'sandbox'. Sandbox data is isolated and can be safely deleted. You can also use the sample data generator to populate test data."
    },
    {
      category: "Integration",
      question: "Can I use the API from my localhost during development?",
      answer: "Yes, the API supports CORS and can be called from localhost. Make sure your API key is included in the Authorization header as 'Bearer YOUR_API_KEY'."
    },
    {
      category: "Integration",
      question: "How do I implement webhooks for real-time updates?",
      answer: "Go to the Webhooks tab to create a webhook endpoint. Provide your server URL and select which events you want to receive (e.g., signal.created, match.settled). The webhook will include a signature for verification."
    },
    {
      category: "Security",
      question: "How should I store my API keys?",
      answer: "Never hardcode API keys in your code or commit them to version control. Use environment variables, a password manager, or a secrets management service. Rotate keys regularly and revoke any compromised keys immediately."
    },
    {
      category: "Security",
      question: "Can I share API keys between team members?",
      answer: "It's better to create separate API keys for each team member or service. This provides better audit trails and allows you to revoke access individually. Use descriptive names to identify who or what is using each key."
    }
  ];

  const filteredErrorCodes = errorCodes.filter(error =>
    error.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    error.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    error.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    error.status.toString().includes(searchQuery)
  );

  const filteredFAQs = faqs.filter(faq =>
    faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
    faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const faqsByCategory = filteredFAQs.reduce((acc, faq) => {
    if (!acc[faq.category]) {
      acc[faq.category] = [];
    }
    acc[faq.category].push(faq);
    return acc;
  }, {} as Record<string, FAQ[]>);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Troubleshooting & Support</h1>
        <p className="text-muted-foreground">
          Find solutions to common issues and learn how to resolve API errors
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search for errors, FAQs, or topics..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Quick Links */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="cursor-pointer hover:border-primary transition-colors">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <HelpCircle className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="font-semibold">Getting Started</div>
                <div className="text-sm text-muted-foreground">Setup guides</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-destructive transition-colors">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-destructive/10 rounded-lg">
                <XCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <div className="font-semibold">Error Codes</div>
                <div className="text-sm text-muted-foreground">{errorCodes.length} documented</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-green-500 transition-colors">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <div className="font-semibold">Best Practices</div>
                <div className="text-sm text-muted-foreground">Security & tips</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-blue-500 transition-colors">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Globe className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <div className="font-semibold">Status Page</div>
                <div className="text-sm text-muted-foreground">System health</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="errors" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="errors">Error Codes</TabsTrigger>
          <TabsTrigger value="faqs">FAQs</TabsTrigger>
        </TabsList>

        {/* Error Codes Tab */}
        <TabsContent value="errors" className="space-y-4 mt-6">
          {filteredErrorCodes.length === 0 ? (
            <Alert>
              <AlertDescription>
                No error codes found matching "{searchQuery}". Try different search terms.
              </AlertDescription>
            </Alert>
          ) : (
            filteredErrorCodes.map((error) => {
              const Icon = error.icon;
              return (
                <Card key={error.code}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className="p-2 bg-destructive/10 rounded-lg">
                          <Icon className="h-5 w-5 text-destructive" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <CardTitle className="text-lg">{error.title}</CardTitle>
                            <Badge variant="destructive">{error.code}</Badge>
                            <Badge variant="outline">HTTP {error.status}</Badge>
                          </div>
                          <CardDescription>{error.description}</CardDescription>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" />
                        Common Causes
                      </h4>
                      <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                        {error.causes.map((cause, idx) => (
                          <li key={idx}>{cause}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        Solutions
                      </h4>
                      <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                        {error.solutions.map((solution, idx) => (
                          <li key={idx}>{solution}</li>
                        ))}
                      </ol>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* FAQs Tab */}
        <TabsContent value="faqs" className="space-y-4 mt-6">
          {Object.keys(faqsByCategory).length === 0 ? (
            <Alert>
              <AlertDescription>
                No FAQs found matching "{searchQuery}". Try different search terms.
              </AlertDescription>
            </Alert>
          ) : (
            Object.entries(faqsByCategory).map(([category, questions]) => (
              <Card key={category}>
                <CardHeader>
                  <CardTitle>{category}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Accordion type="single" collapsible className="w-full">
                    {questions.map((faq, idx) => (
                      <AccordionItem key={idx} value={`${category}-${idx}`}>
                        <AccordionTrigger className="text-left">
                          {faq.question}
                        </AccordionTrigger>
                        <AccordionContent className="text-muted-foreground">
                          {faq.answer}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Contact Support */}
      <Alert>
        <HelpCircle className="h-4 w-4" />
        <AlertTitle>Still need help?</AlertTitle>
        <AlertDescription>
          If you can't find a solution here, check the full API documentation or contact our support team with your API request details and error messages.
        </AlertDescription>
      </Alert>
    </div>
  );
}
