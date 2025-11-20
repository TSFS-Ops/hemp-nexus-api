import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Shield, Hash, CheckCircle2, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function HashVerifier() {
  const { toast } = useToast();
  const [buyerId, setBuyerId] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [commodity, setCommodity] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("");
  const [terms, setTerms] = useState("");
  
  const [computedHash, setComputedHash] = useState("");
  const [expectedHash, setExpectedHash] = useState("");
  const [isMatch, setIsMatch] = useState<boolean | null>(null);

  const computeHash = async () => {
    if (!buyerId || !sellerId || !commodity || !quantity || !price) {
      toast({
        title: "Missing Fields",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    // Create canonical deal terms string (must match backend logic)
    const dealTerms = JSON.stringify({
      buyer_id: buyerId,
      buyer_name: buyerName,
      seller_id: sellerId,
      seller_name: sellerName,
      commodity: commodity,
      quantity_amount: parseFloat(quantity),
      quantity_unit: unit,
      price_amount: parseFloat(price),
      price_currency: currency,
      terms: terms || null,
    });

    // Compute SHA-256 hash
    const encoder = new TextEncoder();
    const data = encoder.encode(dealTerms);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    setComputedHash(hashHex);

    if (expectedHash) {
      setIsMatch(hashHex === expectedHash.toLowerCase().trim());
    }

    toast({
      title: "Hash Computed",
      description: "SHA-256 hash generated from deal terms",
    });
  };

  const verifyHash = () => {
    if (!computedHash || !expectedHash) {
      toast({
        title: "Missing Data",
        description: "Please compute a hash and enter the expected hash",
        variant: "destructive",
      });
      return;
    }

    const match = computedHash === expectedHash.toLowerCase().trim();
    setIsMatch(match);

    toast({
      title: match ? "Hash Match!" : "Hash Mismatch",
      description: match
        ? "The computed hash matches the audit trail record"
        : "The hashes do not match - deal terms may differ",
      variant: match ? "default" : "destructive",
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Hash Verification Tool
        </CardTitle>
        <CardDescription>
          Regenerate SHA-256 hashes from deal terms to verify against audit trail records.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Hash className="h-4 w-4" />
          <AlertDescription>
            Enter the exact deal terms to compute the SHA-256 hash. This hash should match
            the hash recorded in the audit logs for match.created or match.settled events.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="buyerId">Buyer ID *</Label>
            <Input
              id="buyerId"
              value={buyerId}
              onChange={(e) => setBuyerId(e.target.value)}
              placeholder="buyer-123"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="buyerName">Buyer Name</Label>
            <Input
              id="buyerName"
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              placeholder="Acme Corp"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sellerId">Seller ID *</Label>
            <Input
              id="sellerId"
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
              placeholder="seller-456"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sellerName">Seller Name</Label>
            <Input
              id="sellerName"
              value={sellerName}
              onChange={(e) => setSellerName(e.target.value)}
              placeholder="Widget Inc"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="commodity">Commodity *</Label>
            <Input
              id="commodity"
              value={commodity}
              onChange={(e) => setCommodity(e.target.value)}
              placeholder="Industrial Equipment Parts"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="quantity">Quantity *</Label>
            <Input
              id="quantity"
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="1000"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit">Unit</Label>
            <Input
              id="unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="tablets"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="price">Price *</Label>
            <Input
              id="price"
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="25.50"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="currency">Currency</Label>
            <Input
              id="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              placeholder="ZAR"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="terms">Terms</Label>
            <Input
              id="terms"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="Optional terms text"
            />
          </div>
        </div>

        <Button onClick={computeHash} className="w-full">
          <Hash className="mr-2 h-4 w-4" />
          Compute Hash
        </Button>

        {computedHash && (
          <div className="space-y-4 pt-4 border-t">
            <div className="space-y-2">
              <Label>Computed SHA-256 Hash</Label>
              <div className="p-3 bg-muted rounded-md">
                <code className="text-xs break-all">{computedHash}</code>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="expectedHash">Expected Hash (from Audit Log)</Label>
              <Input
                id="expectedHash"
                value={expectedHash}
                onChange={(e) => setExpectedHash(e.target.value)}
                placeholder="Paste hash from audit log"
              />
            </div>

            <Button onClick={verifyHash} variant="outline" className="w-full">
              <Shield className="mr-2 h-4 w-4" />
              Verify Hash Match
            </Button>

            {isMatch !== null && (
              <Alert variant={isMatch ? "default" : "destructive"}>
                {isMatch ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>
                      <strong>✓ Hash Match Verified</strong>
                      <br />
                      The computed hash matches the audit trail record. Deal terms are authentic.
                    </AlertDescription>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>✗ Hash Mismatch</strong>
                      <br />
                      The hashes do not match. The deal terms may differ from the recorded version.
                    </AlertDescription>
                  </>
                )}
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
