"use client";

/**
 * CANONICAL DEMO FIXTURE: This page serves as the intentional customer application target
 * evaluated and repaired by the AutoQA test runner (agent/src/agent/runner/baseline.py,
 * analyzer/quality_dimensions.py, and remediation/fix_synthesizer.py). It is intentionally
 * unlinked from the main dashboard navigation. Do not delete or rename.
 */

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
  Plus,
  Minus,
  Trash2,
  ShieldCheck,
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

const STATE_TAX_RATES: Record<string, number> = {
  CA: 0.0825,
  NY: 0.08875,
  WA: 0.092,
  TX: 0.0825,
  IL: 0.0875,
  MA: 0.0625,
  FL: 0.07,
  CO: 0.0775,
  NJ: 0.06625,
};

function getTaxRate(state: string): number {
  const clean = state.trim().toUpperCase();
  return STATE_TAX_RATES[clean] ?? 0.0725;
}

export default function CheckoutPage() {
  const [items, setItems] = useState<CartItem[]>(INITIAL_ITEMS);
  const [address, setAddress] = useState({
    street: "",
    city: "",
    state: "",
    zip: "",
    country: "US",
  });
  const [promo, setPromo] = useState("");
  const [discount, setDiscount] = useState(0);
  const [promoAppliedMsg, setPromoAppliedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderConfirmation, setOrderConfirmation] = useState<any | null>(null);

  const subtotal = items.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const taxableAmount = Math.max(0, subtotal - discount);
  const taxRate = getTaxRate(address.state);
  const tax = taxableAmount > 0 ? Math.round(taxableAmount * taxRate * 100) / 100 : 0;
  const total = Math.round((taxableAmount + tax) * 100) / 100;

  const updateQuantity = (id: string, delta: number) => {
    setItems((prev) =>
      prev
        .map((item) => {
          if (item.id === id) {
            const nextQty = item.quantity + delta;
            return nextQty > 0 ? { ...item, quantity: nextQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleApplyPromo = async () => {
    if (!promo.trim()) {
      setErrorMsg("Please enter a promotional code.");
      return;
    }
    try {
      const res = await fetch(
        `/api/charge?promo=${encodeURIComponent(promo.trim())}&subtotal=${subtotal}&state=${encodeURIComponent(
          address.state || "CA"
        )}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.promo?.valid) {
          setDiscount(data.promo.discount);
          setPromoAppliedMsg(data.promo.description || `${data.promo.code} applied`);
          setErrorMsg(null);
        } else {
          setErrorMsg(data.promo?.error || "Invalid promotional code.");
        }
      } else {
        // Fallback local check if offline
        const code = promo.trim().toUpperCase();
        if (code === "DEVPROMO" || code === "AUTOQA50") {
          setDiscount(50);
          setPromoAppliedMsg("$50 discount applied");
          setErrorMsg(null);
        } else if (code === "WELCOME20") {
          setDiscount(Math.round(subtotal * 0.2 * 100) / 100);
          setPromoAppliedMsg("20% welcome discount applied");
          setErrorMsg(null);
        } else {
          setErrorMsg("Invalid promotional code.");
        }
      }
    } catch {
      setErrorMsg("Failed to validate promo code. Please try again.");
    }
  };

  const processPayment = async (paymentMethod: "apple_pay" | "card") => {
    if (!isFieldFilled(address.street) || !isFieldFilled(address.zip)) {
      setErrorMsg("Address verification error: customer_address is required for invoice creation.");
      return;
    }
    if (paymentMethod === "card" && !isFieldFilled(address.city)) {
      setErrorMsg("Please provide all required address fields.");
      return;
    }

    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          customer_address: address,
          payment_method: paymentMethod,
          promo_code: discount > 0 ? promo : undefined,
          subtotal,
          discount,
          tax,
          total,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.message || data.error || `Payment failed with status ${res.status}`);
        return;
      }

      setOrderConfirmation(data);
      setIsSuccess(true);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to submit payment request to backend.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApplePay = () => {
    processPayment("apple_pay");
  };

  const handleSubmitOrder = (e: React.FormEvent) => {
    e.preventDefault();
    processPayment("card");
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
          <Card className="border-emerald-200 bg-emerald-50/50 p-8 text-center max-w-lg mx-auto shadow-sm">
            <CheckCircle2 className="h-12 w-12 text-emerald-600 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-900">Order Confirmed!</h2>
            <p className="text-sm text-slate-600 mt-2">
              Your test sandbox VM pool and verification quota have been provisioned successfully.
            </p>
            {orderConfirmation && (
              <div className="mt-5 p-4 rounded-xl bg-white border border-emerald-200 text-left text-xs space-y-2 font-mono">
                <div className="flex justify-between text-slate-600">
                  <span>Order ID:</span>
                  <span className="font-bold text-slate-900">{orderConfirmation.order_id}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Transaction:</span>
                  <span className="text-slate-900">{orderConfirmation.transaction_id}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Method:</span>
                  <span className="text-slate-900 capitalize">{orderConfirmation.payment_method?.replace("_", " ")}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Tax Paid:</span>
                  <span className="text-slate-900">${orderConfirmation.financials?.tax?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-600 pt-1 border-t border-slate-100">
                  <span className="font-semibold text-slate-900">Total Charged:</span>
                  <span className="font-bold text-emerald-700">${orderConfirmation.financials?.total?.toFixed(2)}</span>
                </div>
              </div>
            )}
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
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-black text-white font-medium py-3 px-4 hover:bg-slate-800 transition-colors shadow-xs active:scale-[0.99] disabled:opacity-50 cursor-pointer"
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
                          onChange={(e) => setAddress({ ...address, state: e.target.value.toUpperCase() })}
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
                      disabled={isSubmitting || items.length === 0}
                      className="w-full mt-4 bg-slate-950 hover:bg-slate-800 text-white font-semibold py-2.5 shadow-xs cursor-pointer"
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      <span>{isSubmitting ? "Processing..." : `Complete Purchase ($${total.toFixed(2)})`}</span>
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Cart Container */}
            <div className="lg:col-span-5 space-y-6">
              <Card className="border-slate-200 bg-white shadow-xs">
                <CardHeader className="pb-3 border-b border-slate-100">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-semibold">Order Summary</CardTitle>
                    <span className="text-xs font-mono text-slate-500">{items.reduce((sum, i) => sum + i.quantity, 0)} items</span>
                  </div>
                </CardHeader>

                <CardContent className="pt-4 space-y-4">
                  <div
                    id="cart-items-scroll"
                    className="overflow-y-auto max-h-[280px] pr-2 space-y-3 border border-slate-100 rounded-lg p-3 bg-slate-50/50"
                  >
                    {items.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-4">Your cart is empty.</p>
                    ) : (
                      items.map((item) => (
                        <div key={item.id} className="flex items-center justify-between border-b border-slate-100 pb-2.5 last:border-b-0 last:pb-0 gap-2">
                          <div className="space-y-0.5 flex-1 min-w-0">
                            <p className="text-xs font-medium text-slate-900 truncate">{item.name}</p>
                            <p className="text-[11px] text-slate-500">{item.category} × {item.quantity}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <div className="flex items-center border border-slate-200 rounded bg-white">
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.id, -1)}
                                className="px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 text-[10px]"
                                title="Decrease"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="px-1.5 text-[11px] font-mono">{item.quantity}</span>
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.id, 1)}
                                className="px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 text-[10px]"
                                title="Increase"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                            <span className="text-xs font-mono font-semibold text-slate-900 w-16 text-right">
                              ${(item.price * item.quantity).toFixed(2)}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeItem(item.id)}
                              className="text-slate-400 hover:text-red-600 p-0.5"
                              title="Remove item"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Promo Code Input */}
                  <div className="space-y-1.5 pt-2">
                    <div className="flex gap-2">
                      <Input
                        id="promo-code"
                        placeholder="Promo code (e.g. DEVPROMO, AUTOQA50)"
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
                    {promoAppliedMsg && (
                      <p className="text-[11px] text-emerald-600 font-medium">✓ {promoAppliedMsg}</p>
                    )}
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
                      <span>
                        Estimated Tax {address.state ? `(${address.state} ${(taxRate * 100).toFixed(2)}%)` : "(Standard 7.25%)"}
                      </span>
                      <span className="font-mono">${tax.toFixed(2)}</span>
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
