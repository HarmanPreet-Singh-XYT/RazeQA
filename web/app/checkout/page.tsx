"use client";

import { useState } from "react";
import Link from "next/link";
import { isFieldFilled } from "@/lib/form-validation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Lock,
  Package,
  ShieldCheck,
  Sparkles,
  Truck,
  AlertCircle,
} from "lucide-react";

type CartItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
};

const INITIAL_ITEMS: CartItem[] = [
  {
    id: "item-1",
    name: "Autonomous PR Verification - Team Fleet",
    category: "Developer Tooling",
    price: 149.0,
    quantity: 1,
  },
  {
    id: "item-2",
    name: "Playwright CDP Screencast & Cloud VM Pool",
    category: "Infrastructure",
    price: 89.0,
    quantity: 2,
  },
  {
    id: "item-3",
    name: "Multimodal Gemini Visual Regression Token Pack",
    category: "AI Inference",
    price: 49.0,
    quantity: 1,
  },
  {
    id: "item-4",
    name: "Coding Agent Bridge Daemon Enterprise License",
    category: "Developer Tooling",
    price: 199.0,
    quantity: 1,
  },
  {
    id: "item-5",
    name: "AES-256 Encrypted Credential Vault Addon",
    category: "Security",
    price: 39.0,
    quantity: 1,
  },
];

export default function CheckoutPage() {
  const [items] = useState<CartItem[]>(INITIAL_ITEMS);
  const [address, setAddress] = useState({
    street: "",
    city: "",
    state: "",
    zip: "",
    country: "US",
  });
  const [promo, setPromo] = useState("");
  const [discount, setDiscount] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const subtotal = items.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const total = Math.max(0, subtotal - discount);

  const handleApplyPromo = () => {
    if (promo.trim().toUpperCase() === "DEVPROMO") {
      setDiscount(50);
      setErrorMsg(null);
    } else {
      setErrorMsg("Invalid promotional code.");
    }
  };

  const handleApplePay = () => {
    // Demonstration flow: Apple Pay requires customer address verification
    if (!isFieldFilled(address.street) || !isFieldFilled(address.zip)) {
      setErrorMsg("Address verification error: customer_address is required for invoice creation.");
      return;
    }
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setIsSuccess(true);
    }, 600);
  };

  const handleSubmitOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFieldFilled(address.street) || !isFieldFilled(address.city) || !isFieldFilled(address.zip)) {
      setErrorMsg("Please provide all required address fields.");
      return;
    }
    setErrorMsg(null);
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setIsSuccess(true);
    }, 700);
  };

  return (
    <div className="min-h-screen bg-[#fafaf9] text-slate-900 font-sans antialiased selection:bg-slate-200">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors">
              <ArrowLeft className="h-4 w-4" />
              <span>Back to Dashboard</span>
            </Link>
            <span className="text-slate-300">/</span>
            <span className="text-xs font-semibold text-slate-900">Secure Checkout</span>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-600">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>256-bit Encrypted Checkout</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">Complete Your Order</h1>
          <p className="text-sm text-slate-600 mt-1">Review your plan allocation and confirm payment details.</p>
        </div>

        {errorMsg && (
          <div id="checkout-error" className="mb-6 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50/80 p-4 text-sm text-red-900 shadow-xs animate-in fade-in-50">
            <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
            <div className="flex-1 font-medium">{errorMsg}</div>
          </div>
        )}

        {isSuccess ? (
          <Card className="border-emerald-200 bg-emerald-50/50 p-8 text-center max-w-lg mx-auto">
            <CheckCircle2 className="h-12 w-12 text-emerald-600 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-900">Order Confirmed!</h2>
            <p className="text-sm text-slate-600 mt-2">
              Your test sandbox VM pool and verification quota have been provisioned successfully.
            </p>
            <div className="mt-6">
              <Link href="/dashboard">
                <Button className="bg-slate-900 text-white hover:bg-slate-800">Return to Dashboard</Button>
              </Link>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            {/* Left Column: Express Pay + Address Details */}
            <div className="lg:col-span-7 space-y-6">
              {/* Express 1-Tap Checkout */}
              <Card className="border-slate-200 bg-white shadow-xs">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Express 1-Tap Checkout</CardTitle>
                  <CardDescription className="text-xs">Bypass manual form filling with saved credentials</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <button
                    type="button"
                    id="apple-pay-button"
                    onClick={handleApplePay}
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-black text-white font-medium py-3 px-4 hover:bg-slate-800 transition-colors shadow-xs active:scale-[0.99] disabled:opacity-50"
                  >
                    <span>Pay</span>
                    <span className="text-xs text-slate-300">| Instant Order</span>
                  </button>
                  <div className="relative my-4 text-center">
                    <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-200" /></div>
                    <span className="relative bg-white px-3 text-xs uppercase tracking-wider text-slate-400 font-medium">Or enter billing address</span>
                  </div>
                </CardContent>
              </Card>

              {/* Standard Address Form */}
              <Card className="border-slate-200 bg-white shadow-xs">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Billing Address</CardTitle>
                  <CardDescription className="text-xs">Required for invoicing and tax compliance</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmitOrder} className="space-y-4">
                    <div>
                      <Label htmlFor="street" className="text-xs font-medium text-slate-700">Street Address</Label>
                      <Input
                        id="street"
                        placeholder="100 Innovation Way"
                        value={address.street}
                        onChange={(e) => setAddress({ ...address, street: e.target.value })}
                        className="mt-1 text-sm bg-white"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="city" className="text-xs font-medium text-slate-700">City</Label>
                        <Input
                          id="city"
                          placeholder="San Francisco"
                          value={address.city}
                          onChange={(e) => setAddress({ ...address, city: e.target.value })}
                          className="mt-1 text-sm bg-white"
                        />
                      </div>
                      <div>
                        <Label htmlFor="state" className="text-xs font-medium text-slate-700">State / Region</Label>
                        <Input
                          id="state"
                          placeholder="CA"
                          value={address.state}
                          onChange={(e) => setAddress({ ...address, state: e.target.value })}
                          className="mt-1 text-sm bg-white"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="zip" className="text-xs font-medium text-slate-700">Postal / Zip Code</Label>
                        <Input
                          id="zip"
                          placeholder="94105"
                          value={address.zip}
                          onChange={(e) => setAddress({ ...address, zip: e.target.value })}
                          className="mt-1 text-sm bg-white"
                        />
                      </div>
                      <div>
                        <Label htmlFor="country" className="text-xs font-medium text-slate-700">Country</Label>
                        <Input
                          id="country"
                          value={address.country}
                          disabled
                          className="mt-1 text-sm bg-slate-50 text-slate-500"
                        />
                      </div>
                    </div>

                    <Button
                      type="submit"
                      id="submit-order"
                      disabled={isSubmitting}
                      className="w-full mt-4 bg-slate-950 hover:bg-slate-800 text-white font-semibold py-2.5 shadow-xs"
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      <span>{isSubmitting ? "Processing..." : `Complete Purchase ($${total.toFixed(2)})`}</span>
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Independently Scrollable Cart Container */}
            <div className="lg:col-span-5 space-y-6">
              <Card className="border-slate-200 bg-white shadow-xs">
                <CardHeader className="pb-3 border-b border-slate-100">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold">Order Summary</CardTitle>
                    <span className="text-xs font-mono text-slate-500">{items.length} items</span>
                  </div>
                </CardHeader>

                <CardContent className="pt-4 space-y-4">
                  {/* Nested independently scrollable container for element-targeted scroll testing */}
                  <div
                    id="cart-items-scroll"
                    className="overflow-y-auto max-h-[280px] pr-2 space-y-3 border border-slate-100 rounded-lg p-3 bg-slate-50/50"
                  >
                    {items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between border-b border-slate-100 pb-2.5 last:border-b-0 last:pb-0">
                        <div className="space-y-0.5">
                          <p className="text-xs font-medium text-slate-900 line-clamp-1">{item.name}</p>
                          <p className="text-[11px] text-slate-500">{item.category} × {item.quantity}</p>
                        </div>
                        <span className="text-xs font-mono font-semibold text-slate-900 shrink-0">
                          ${(item.price * item.quantity).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Promo Code Input */}
                  <div className="flex gap-2 pt-2">
                    <Input
                      id="promo-code"
                      placeholder="Promo code (e.g. DEVPROMO)"
                      value={promo}
                      onChange={(e) => setPromo(e.target.value)}
                      className="text-xs bg-white"
                    />
                    <Button
                      type="button"
                      id="apply-promo"
                      onClick={handleApplyPromo}
                      variant="outline"
                      className="text-xs shrink-0 font-medium"
                    >
                      Apply
                    </Button>
                  </div>

                  {/* Financial Breakdown */}
                  <div className="space-y-2 pt-3 border-t border-slate-100 text-xs text-slate-600">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span className="font-mono">${subtotal.toFixed(2)}</span>
                    </div>
                    {discount > 0 && (
                      <div className="flex justify-between text-emerald-600 font-medium">
                        <span>Discount</span>
                        <span className="font-mono">-${discount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Estimated Tax</span>
                      <span className="font-mono">$0.00</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-slate-200 text-sm font-bold text-slate-950">
                      <span>Total Due</span>
                      <span className="font-mono">${total.toFixed(2)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Security Callout */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <Lock className="h-4 w-4 text-slate-700" />
                  <span>Verified Sandbox Guarantee</span>
                </div>
                <p>
                  All preview container resources and automated Playwright journeys run within ephemeral, isolated environments.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
