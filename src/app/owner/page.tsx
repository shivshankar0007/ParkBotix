"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  IndianRupee,
  Gauge,
  MessageSquare,
  ShieldAlert,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

interface OwnerLot {
  id: number;
  name: string;
  address: string;
  city: string;
  baseHourlyRate: number;
  availableSlots: number;
  occupancyPercent: number;
  slots: Array<{
    id: number;
    slotCode: string;
    slotType: string;
    status: string;
    hourlyRate: number;
  }>;
}

interface OwnerSummary {
  lots: OwnerLot[];
  metrics: {
    lotCount: number;
    totalSlots: number;
    occupiedOrReserved: number;
    occupancyPercent: number;
    verifiedRevenueInr: number;
    ownerPenaltyShareInr: number;
    totalBookings: number;
  };
  bookings: Array<{
    id: number;
    bookingCode: string;
    lotName: string;
    slotCode: string;
    customerName: string;
    vehicleNumber: string;
    finalAmount: number;
    status: string;
    createdAt: string;
  }>;
  feedback: Array<{
    id: number;
    lotName: string;
    authorName: string;
    rating: number;
    comment: string;
    adminResponse: string | null;
    status: string;
  }>;
}

export default function OwnerPage() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<OwnerSummary | null>(null);
  const [replyText, setReplyText] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const authorized = user && (user.role === "owner" || user.role === "superadmin");

  const loadSummary = useCallback(async () => {
    const res = await fetch("/api/owner/summary", { cache: "no-store" });
    if (res.ok) {
      setData(await res.json());
    }
  }, []);

  useEffect(() => {
    if (authorized) void loadSummary();
  }, [authorized, loadSummary]);

  async function handleSlotStatus(slotId: number, status: string) {
    const res = await fetch(`/api/slots/${slotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setNotice(`Slot #${slotId} status updated to ${status}.`);
      await loadSummary();
    }
  }

  async function handleReplyFeedback(fbId: number) {
    const msg = replyText[fbId]?.trim();
    if (!msg) return;
    const res = await fetch(`/api/feedback/${fbId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminResponse: msg, status: "resolved" }),
    });
    if (res.ok) {
      setReplyText((prev) => ({ ...prev, [fbId]: "" }));
      setNotice("Feedback response saved.");
      await loadSummary();
    }
  }

  if (loading) {
    return <div className="p-12 text-center text-sm text-slate-500">Loading owner telemetry...</div>;
  }

  if (!authorized) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <ShieldAlert className="mx-auto h-12 w-12 text-amber-500" />
        <h1 className="mt-3 text-xl font-extrabold text-slate-900">
          Parking Lot Owner Portal
        </h1>
        <p className="mt-2 text-xs text-slate-500">
          Sign in with a Parking Lot Owner account (e.g. owner1@parkbotix.local or owner2@parkbotix.local)
          to access your isolated facility metrics and revenue.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-block rounded-xl bg-indigo-600 px-6 py-2.5 text-xs font-bold text-white"
        >
          Sign In as Owner
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <span className="font-mono text-[11px] font-bold uppercase text-amber-600">
            STRICT TENANT ISOLATION • OWNER: {user.name}
          </span>
          <h1 className="text-2xl font-extrabold text-slate-900">
            Parking Lot Owner Operations Hub
          </h1>
          <p className="text-xs text-slate-500">
            Real-time performance, verified UPI revenue, penalty share ledger, and bay status strictly for your assigned hubs.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSummary()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh Data
        </button>
      </div>

      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-800">
          {notice}
        </div>
      )}

      {data && (
        <>
          {/* KPI Strip */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <Building2 className="h-5 w-5 text-indigo-600" />
              <p className="mt-2 font-mono text-2xl font-extrabold text-slate-900">
                {data.metrics.lotCount}
              </p>
              <p className="text-xs font-semibold text-slate-500">Assigned Parking Hubs</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <Gauge className="h-5 w-5 text-amber-500" />
              <p className="mt-2 font-mono text-2xl font-extrabold text-slate-900">
                {data.metrics.occupancyPercent}%
              </p>
              <p className="text-xs font-semibold text-slate-500">
                Live Occupancy ({data.metrics.occupiedOrReserved}/{data.metrics.totalSlots} bays)
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <IndianRupee className="h-5 w-5 text-emerald-600" />
              <p className="mt-2 font-mono text-2xl font-extrabold text-emerald-700">
                ₹{data.metrics.verifiedRevenueInr}
              </p>
              <p className="text-xs font-semibold text-slate-500">Verified Booking Revenue</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <IndianRupee className="h-5 w-5 text-sky-600" />
              <p className="mt-2 font-mono text-2xl font-extrabold text-slate-900">
                ₹{data.metrics.ownerPenaltyShareInr}
              </p>
              <p className="text-xs font-semibold text-slate-500">Owner Penalty Share (80%)</p>
            </div>
          </div>

          {/* Assigned Lots & Live Bay Overrides */}
          <div className="space-y-4">
            {data.lots.map((lot) => (
              <div
                key={lot.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-extrabold text-slate-900">{lot.name}</h2>
                    <p className="text-xs text-slate-500">{lot.address}</p>
                  </div>
                  <span className="rounded-lg bg-slate-900 px-3 py-1 font-mono text-xs font-bold text-white">
                    {lot.availableSlots}/{lot.slots.length} Open • ₹{lot.baseHourlyRate}/hr
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8">
                  {lot.slots.map((s) => (
                    <div
                      key={s.id}
                      className={`rounded-xl border p-2 text-center text-[11px] ${
                        s.status === "available"
                          ? "border-emerald-200 bg-emerald-50"
                          : s.status === "reserved"
                          ? "border-amber-200 bg-amber-50"
                          : s.status === "maintenance"
                          ? "border-slate-300 bg-slate-100"
                          : "border-rose-200 bg-rose-50"
                      }`}
                    >
                      <span className="block font-mono font-bold text-slate-900">
                        {s.slotCode}
                      </span>
                      <span className="block font-mono text-[9px] uppercase text-slate-500">
                        {s.status}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void handleSlotStatus(
                            s.id,
                            s.status === "available" ? "maintenance" : "available"
                          )
                        }
                        className="mt-1 rounded bg-white px-1.5 py-0.5 text-[9px] font-bold text-indigo-700 shadow-sm hover:bg-indigo-50"
                      >
                        {s.status === "available" ? "Maint" : "Free"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Owner Bookings & Feedback */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-extrabold text-slate-900">
                Hub Bookings ({data.bookings.length})
              </h2>
              <div className="max-h-[340px] space-y-2 overflow-y-auto">
                {data.bookings.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs"
                  >
                    <div>
                      <span className="font-mono font-bold text-indigo-700">
                        {b.bookingCode}
                      </span>{" "}
                      <span className="font-semibold text-slate-700">({b.slotCode})</span>
                      <p className="text-[11px] text-slate-500">
                        {b.lotName} • {b.vehicleNumber}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="block font-mono font-bold text-slate-900">
                        ₹{b.finalAmount}
                      </span>
                      <span className="font-mono text-[10px] uppercase text-slate-500">
                        {b.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-900">
                <MessageSquare className="h-4 w-4 text-indigo-600" />
                Customer Feedback for Your Hubs ({data.feedback.length})
              </h2>
              <div className="max-h-[340px] space-y-3 overflow-y-auto">
                {data.feedback.map((f) => (
                  <div
                    key={f.id}
                    className="rounded-xl border border-slate-200 p-3 text-xs"
                  >
                    <div className="flex justify-between font-bold text-slate-800">
                      <span>{f.lotName}</span>
                      <span className="font-mono text-amber-600">{f.rating}/5 ★</span>
                    </div>
                    <p className="mt-1 text-slate-600">{f.comment}</p>
                    {f.adminResponse ? (
                      <p className="mt-2 rounded-lg bg-indigo-50 p-2 text-[11px] text-indigo-900">
                        <strong>Reply:</strong> {f.adminResponse}
                      </p>
                    ) : (
                      <div className="mt-2 flex gap-2">
                        <input
                          type="text"
                          value={replyText[f.id] ?? ""}
                          onChange={(e) =>
                            setReplyText((prev) => ({ ...prev, [f.id]: e.target.value }))
                          }
                          placeholder="Write owner response..."
                          className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => void handleReplyFeedback(f.id)}
                          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white"
                        >
                          Reply
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
