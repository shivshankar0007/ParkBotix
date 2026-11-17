"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Plus,
  Trash2,
  Building2,
  Tag,
  CreditCard,
  ShieldAlert,
  Crown,
  Cpu,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

interface OverviewData {
  metrics: {
    totalLots: number;
    totalSlots: number;
    availableSlots: number;
    occupancyPercent: number;
    totalUsers: number;
    activeBookings: number;
    verifiedRevenueInr: number;
    penaltyRevenueInr: number;
    evChargersCount: number;
  };
  lots: Array<{
    id: number;
    name: string;
    address: string;
    city: string;
    baseHourlyRate: number;
    totalSlots: number;
    ownerId: number | null;
  }>;
  slots: Array<{
    id: number;
    lotId: number;
    slotCode: string;
    floor: string;
    slotType: string;
    status: string;
    hourlyRate: number;
  }>;
  coupons: Array<{
    id: number;
    code: string;
    description: string;
    discountType: string;
    discountValue: number;
    usedCount: number;
    usageLimit: number;
    isActive: boolean;
  }>;
  payments: Array<{
    id: number;
    transactionId: string;
    amount: number;
    method: string;
    status: string;
    createdAt: string;
  }>;
  bookings: Array<{
    id: number;
    bookingCode: string;
    vehicleNumber: string;
    finalAmount: number;
    status: string;
    createdAt: string;
  }>;
  users: Array<{ id: number; name: string; role: string }>;
}

export default function AdminDashboardPage() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<OverviewData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Create Lot form
  const [lotName, setLotName] = useState("");
  const [lotAddress, setLotAddress] = useState("");
  const [lotCity, setLotCity] = useState("Bengaluru");
  const [lotLat, setLotLat] = useState("12.9698");
  const [lotLng, setLotLng] = useState("77.7500");
  const [lotRate, setLotRate] = useState("55");
  const [lotSlotsCount, setLotSlotsCount] = useState("10");

  // Create Coupon form
  const [cCode, setCCode] = useState("");
  const [cDesc, setCDesc] = useState("");
  const [cType, setCType] = useState<"percentage" | "fixed">("percentage");
  const [cVal, setCVal] = useState("15");

  const authorized = user && (user.role === "admin" || user.role === "superadmin");

  const loadOverview = useCallback(async () => {
    const res = await fetch("/api/admin/overview", { cache: "no-store" });
    if (res.ok) {
      setData(await res.json());
    }
  }, []);

  useEffect(() => {
    if (authorized) void loadOverview();
  }, [authorized, loadOverview]);

  async function handleCreateLot(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    const res = await fetch("/api/lots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: lotName,
        address: lotAddress,
        city: lotCity,
        latitude: Number(lotLat),
        longitude: Number(lotLng),
        baseHourlyRate: Number(lotRate),
        totalSlots: Number(lotSlotsCount),
        autoGenerateSlots: true,
        evSlotsCount: 2,
      }),
    });
    const out = await res.json();
    if (res.ok) {
      setLotName("");
      setLotAddress("");
      setNotice(`Created parking hub "${out.lot.name}" with ${lotSlotsCount} live bays.`);
      await loadOverview();
    } else {
      setNotice(out.error || "Failed to create lot");
    }
  }

  async function handleDeleteLot(id: number) {
    const res = await fetch(`/api/lots/${id}`, { method: "DELETE" });
    if (res.ok) {
      setNotice(`Deleted parking lot #${id}.`);
      await loadOverview();
    }
  }

  async function handleCreateCoupon(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    const res = await fetch("/api/coupons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: cCode,
        description: cDesc,
        discountType: cType,
        discountValue: Number(cVal),
        minBookingAmount: 50,
        maxDiscount: 200,
        usageLimit: 200,
        validUntil: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });
    const out = await res.json();
    if (res.ok) {
      setCCode("");
      setCDesc("");
      setNotice(`Created promo coupon ${out.coupon.code}.`);
      await loadOverview();
    } else {
      setNotice(out.error || "Failed to create coupon");
    }
  }

  async function handleToggleCoupon(id: number, current: boolean) {
    const res = await fetch(`/api/coupons/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !current }),
    });
    if (res.ok) await loadOverview();
  }

  if (loading) {
    return <div className="p-12 text-center text-sm text-slate-500">Checking admin session...</div>;
  }

  if (!authorized) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <ShieldAlert className="mx-auto h-12 w-12 text-rose-500" />
        <h1 className="mt-3 text-xl font-extrabold text-slate-900">Admin Access Required</h1>
        <p className="mt-2 text-xs text-slate-500">
          This dashboard requires Admin or SuperAdmin authorization enforced server-side.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-block rounded-xl bg-indigo-600 px-6 py-2.5 text-xs font-bold text-white"
        >
          Sign In as Admin
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase text-indigo-600">
            <ShieldCheck className="h-3.5 w-3.5" /> PARKBOTIX OPERATIONS ADMIN
          </span>
          <h1 className="text-2xl font-extrabold text-slate-900">
            Hubs, Bays, Coupons &amp; Payment Operations
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/full"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <Crown className="h-3.5 w-3.5 text-indigo-600" /> Users, Keys &amp; Audit
          </Link>
          <Link
            href="/admin/advanced"
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-indigo-700"
          >
            <Cpu className="h-3.5 w-3.5" /> AI Suite &amp; Worker
          </Link>
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">
          {notice}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[
              { label: "Parking Hubs", val: data.metrics.totalLots },
              {
                label: "Live Occupancy",
                val: `${data.metrics.occupancyPercent}% (${data.metrics.availableSlots} free)`,
              },
              { label: "Active Bookings", val: data.metrics.activeBookings },
              { label: "Verified Revenue", val: `₹${data.metrics.verifiedRevenueInr}` },
              { label: "EV Fast Bays", val: data.metrics.evChargersCount },
            ].map((k) => (
              <div
                key={k.label}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <span className="block font-mono text-xl font-extrabold text-slate-900">
                  {k.val}
                </span>
                <span className="text-[11px] font-semibold text-slate-500">{k.label}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Create & Manage Parking Lots */}
            <div className="space-y-4 lg:col-span-7">
              <form
                onSubmit={handleCreateLot}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-900">
                  <Building2 className="h-4 w-4 text-indigo-600" />
                  Add New Smart Parking Hub
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input
                    required
                    value={lotName}
                    onChange={(e) => setLotName(e.target.value)}
                    placeholder="Hub Name (e.g. Whitefield ITPL Deck)"
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                  />
                  <input
                    required
                    value={lotAddress}
                    onChange={(e) => setLotAddress(e.target.value)}
                    placeholder="Street Address"
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                  />
                  <input
                    value={lotCity}
                    onChange={(e) => setLotCity(e.target.value)}
                    placeholder="City"
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={lotLat}
                      onChange={(e) => setLotLat(e.target.value)}
                      placeholder="Lat"
                      className="rounded-xl border border-slate-200 px-2.5 py-2 font-mono text-xs"
                    />
                    <input
                      value={lotLng}
                      onChange={(e) => setLotLng(e.target.value)}
                      placeholder="Lng"
                      className="rounded-xl border border-slate-200 px-2.5 py-2 font-mono text-xs"
                    />
                  </div>
                  <input
                    type="number"
                    value={lotRate}
                    onChange={(e) => setLotRate(e.target.value)}
                    placeholder="Base ₹/hr"
                    className="rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs"
                  />
                  <input
                    type="number"
                    value={lotSlotsCount}
                    onChange={(e) => setLotSlotsCount(e.target.value)}
                    placeholder="Total Slots"
                    className="rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs"
                  />
                </div>
                <button
                  type="submit"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700"
                >
                  <Plus className="h-3.5 w-3.5" /> Create Hub &amp; Auto-Generate Bays
                </button>
              </form>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="mb-3 text-sm font-extrabold text-slate-900">
                  Active Parking Hubs ({data.lots.length})
                </h2>
                <div className="space-y-2.5">
                  {data.lots.map((l) => (
                    <div
                      key={l.id}
                      className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs"
                    >
                      <div>
                        <p className="font-bold text-slate-900">
                          #{l.id} {l.name}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {l.address} • {l.totalSlots} slots • ₹{l.baseHourlyRate}/hr
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeleteLot(l.id)}
                        className="rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100"
                        title="Delete Parking Hub"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: Coupons & Payments */}
            <div className="space-y-4 lg:col-span-5">
              <form
                onSubmit={handleCreateCoupon}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-900">
                  <Tag className="h-4 w-4 text-indigo-600" />
                  Create Promo Coupon
                </h2>
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      required
                      value={cCode}
                      onChange={(e) => setCCode(e.target.value.toUpperCase())}
                      placeholder="CODE (e.g. METRO15)"
                      className="rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs uppercase"
                    />
                    <select
                      value={cType}
                      onChange={(e) => setCType(e.target.value as "percentage" | "fixed")}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    >
                      <option value="percentage">Percentage (%)</option>
                      <option value="fixed">Fixed (₹)</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="number"
                      required
                      value={cVal}
                      onChange={(e) => setCVal(e.target.value)}
                      placeholder="Value"
                      className="rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs"
                    />
                    <input
                      required
                      value={cDesc}
                      onChange={(e) => setCDesc(e.target.value)}
                      placeholder="Description"
                      className="col-span-2 rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full rounded-xl bg-slate-900 py-2 text-xs font-bold text-white hover:bg-indigo-600"
                  >
                    + Save Coupon
                  </button>
                </div>

                <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                  {data.coupons.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs"
                    >
                      <div>
                        <span className="font-mono font-bold text-indigo-700">{c.code}</span>
                        <span className="ml-2 text-[11px] text-slate-500">
                          ({c.usedCount}/{c.usageLimit} used)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleToggleCoupon(c.id, c.isActive)}
                        className={`rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold uppercase ${
                          c.isActive
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {c.isActive ? "Active" : "Paused"}
                      </button>
                    </div>
                  ))}
                </div>
              </form>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-900">
                  <CreditCard className="h-4 w-4 text-emerald-600" />
                  Recent Payment Ledger ({data.payments.length})
                </h2>
                <div className="max-h-[240px] space-y-2 overflow-y-auto">
                  {data.payments.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                    >
                      <div>
                        <span className="font-mono font-bold text-slate-800">
                          {p.transactionId}
                        </span>
                        <span className="ml-2 font-mono text-[10px] uppercase text-slate-500">
                          {p.method}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-bold text-slate-900">₹{p.amount}</span>
                        <span
                          className={`ml-2 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                            p.status === "verified"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {p.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
