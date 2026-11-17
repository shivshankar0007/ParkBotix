"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Gift, Tag, Award, Repeat, Copy, CheckCircle2, Zap } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

interface CouponItem {
  id: number;
  code: string;
  description: string;
  discountType: string;
  discountValue: number;
  minBookingAmount: number;
  maxDiscount: number;
  validUntil: string;
}

interface MarketplaceOfferItem {
  id: number;
  bookingId: number;
  sellerId: number;
  lotName: string;
  slotCode: string;
  askingPrice: number;
  originalPrice: number;
  expiresAt: string;
}

interface PlanItem {
  id: number;
  name: string;
  description: string;
  monthlyPrice: number;
  includedHours: number;
  discountPercent: number;
  evBonus: boolean;
}

export default function RewardsPage() {
  const { user, refreshAuth } = useAuth();
  const [loyalty, setLoyalty] = useState<{
    pointsBalance: number;
    totalEarned: number;
    totalRedeemed: number;
    tier: string;
    lastTransactionNote: string | null;
  } | null>(null);
  const [coupons, setCoupons] = useState<CouponItem[]>([]);
  const [offers, setOffers] = useState<MarketplaceOfferItem[]>([]);
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [activeSubPlanId, setActiveSubPlanId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [loyRes, subRes] = await Promise.all([
      fetch("/api/loyalty", { cache: "no-store" }),
      fetch("/api/subscriptions", { cache: "no-store" }),
    ]);
    if (loyRes.ok) {
      const ld = await loyRes.json();
      setLoyalty(ld.loyalty);
      setCoupons(ld.coupons ?? []);
      setOffers(ld.marketplaceOffers ?? []);
    }
    if (subRes.ok) {
      const sd = await subRes.json();
      setPlans(sd.plans ?? []);
      setActiveSubPlanId(sd.activeSubscription?.planId ?? null);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSubscribe(planId: number) {
    setNotice(null);
    const res = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });
    const data = await res.json();
    if (res.ok) {
      setNotice(`Enrolled in ${data.plan.name}! Monthly hours are now active.`);
      await Promise.all([loadData(), refreshAuth()]);
    } else {
      setNotice(data.error || "Please sign in to enroll in a plan.");
    }
  }

  async function handleClaimOffer(offerId: number) {
    setNotice(null);
    const res = await fetch("/api/rrm/take", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offerId }),
    });
    const data = await res.json();
    setNotice(res.ok ? data.message : data.error);
    await loadData();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      {/* Loyalty Wallet Header */}
      <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-6 text-white shadow-sm">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 font-mono text-[11px] font-bold text-emerald-300">
              <Gift className="h-3.5 w-3.5" /> PARKBOTIX LOYALTY POLICY: 1 POINT = ₹0.50
            </span>
            <h1 className="mt-3 text-2xl font-extrabold">
              Rewards, Coupons &amp; Mobility Passes
            </h1>
            <p className="mt-1 text-xs text-slate-300">
              Earn points automatically on every reservation and redeem directly during bay checkout.
            </p>
          </div>

          {loyalty ? (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-3 text-center">
                <span className="block font-mono text-2xl font-extrabold text-emerald-400">
                  {loyalty.pointsBalance}
                </span>
                <span className="text-[10px] font-semibold uppercase text-slate-400">
                  Balance (₹{(loyalty.pointsBalance * 0.5).toFixed(0)})
                </span>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-3 text-center">
                <span className="block font-mono text-2xl font-extrabold text-indigo-300">
                  {loyalty.totalEarned}
                </span>
                <span className="text-[10px] font-semibold uppercase text-slate-400">
                  Lifetime Earned
                </span>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-3 text-center">
                <span className="block font-mono text-xl font-extrabold text-amber-300">
                  {loyalty.tier}
                </span>
                <span className="text-[10px] font-semibold uppercase text-slate-400">
                  Member Tier
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-xs text-slate-300">
              Sign in to view your live points wallet &amp; tier progress.
            </div>
          )}
        </div>
        {loyalty?.lastTransactionNote && (
          <p className="mt-4 border-t border-slate-800 pt-3 font-mono text-[11px] text-slate-400">
            Last Ledger Activity: {loyalty.lastTransactionNote}
          </p>
        )}
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {notice}
        </div>
      )}

      {/* Active Coupons */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold text-slate-900">
          <Tag className="h-5 w-5 text-indigo-600" />
          Active Promo Coupons
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {coupons.map((c) => (
            <div
              key={c.id}
              className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 font-mono text-sm font-extrabold text-indigo-700">
                    {c.code}
                  </span>
                  <span className="font-mono text-xs font-bold text-emerald-600">
                    {c.discountType === "percentage"
                      ? `${c.discountValue}% OFF`
                      : `₹${c.discountValue} OFF`}
                  </span>
                </div>
                <p className="mt-3 text-xs text-slate-600">{c.description}</p>
                <p className="mt-2 font-mono text-[11px] text-slate-400">
                  Min ₹{c.minBookingAmount} • Max Save ₹{c.maxDiscount}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(c.code);
                  setNotice(`Copied coupon code ${c.code} to clipboard!`);
                }}
                className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                <Copy className="h-3.5 w-3.5" /> Copy Code
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Subscription Plans */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold text-slate-900">
          <Award className="h-5 w-5 text-indigo-600" />
          Monthly Parking &amp; EV Subscription Passes
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {plans.map((p) => {
            const isCurrent = activeSubPlanId === p.id;
            return (
              <div
                key={p.id}
                className={`flex flex-col justify-between rounded-2xl border p-5 shadow-sm ${
                  isCurrent
                    ? "border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-600/20"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-extrabold text-slate-900">{p.name}</h3>
                    {p.evBonus && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 font-mono text-[10px] font-bold text-sky-700">
                        <Zap className="h-3 w-3" /> EV Pro
                      </span>
                    )}
                  </div>
                  <p className="mt-2 font-mono text-2xl font-extrabold text-slate-900">
                    ₹{p.monthlyPrice}
                    <span className="text-xs font-normal text-slate-500"> / month</span>
                  </p>
                  <p className="mt-2 text-xs text-slate-600">{p.description}</p>
                  <ul className="mt-3 space-y-1 font-mono text-[11px] text-slate-600">
                    <li>• {p.includedHours} included parking hours</li>
                    <li>• {p.discountPercent}% instant off extra hours</li>
                  </ul>
                </div>
                <button
                  type="button"
                  disabled={isCurrent}
                  onClick={() => void handleSubscribe(p.id)}
                  className={`mt-5 w-full rounded-xl py-2.5 text-xs font-bold transition ${
                    isCurrent
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-900 text-white hover:bg-indigo-600"
                  }`}
                >
                  {isCurrent ? "Active Plan" : "Enroll Now"}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* RRM Reservation Marketplace */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold text-slate-900">
          <Repeat className="h-5 w-5 text-indigo-600" />
          RRM Reservation Re-Allocation Marketplace ({offers.length} Open)
        </h2>
        {offers.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
            No open reservation transfers right now. You can list any confirmed booking from My Bookings!
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {offers.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div>
                  <span className="font-mono text-xs font-bold text-indigo-700">
                    {o.lotName} • Bay {o.slotCode}
                  </span>
                  <p className="mt-1 text-xs text-slate-500">
                    Original ₹{o.originalPrice} → Marketplace Price{" "}
                    <strong className="font-mono text-emerald-700">₹{o.askingPrice}</strong>
                  </p>
                  <p className="font-mono text-[10px] text-slate-400">
                    Valid until {new Date(o.expiresAt).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!user || user.id === o.sellerId}
                  onClick={() => void handleClaimOffer(o.id)}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-500"
                >
                  {user?.id === o.sellerId ? "Your Listing" : "Claim Bay"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
