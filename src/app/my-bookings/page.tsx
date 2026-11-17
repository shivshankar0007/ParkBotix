"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Ticket,
  QrCode,
  CreditCard,
  CheckCircle2,
  XCircle,
  Clock,
  Tag,
  Copy,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

interface BookingRow {
  id: number;
  bookingCode: string;
  lotId: number;
  slotId: number;
  lotName: string;
  lotAddress: string;
  slotCode: string;
  slotType: string;
  vehicleNumber: string;
  startTime: string;
  endTime: string;
  actualEntryTime: string | null;
  actualExitTime: string | null;
  durationHours: number;
  finalAmount: number;
  discountAmount: number;
  loyaltyDiscount: number;
  status: string;
  autoExtendEnabled: boolean;
  qrCodePayload: string;
  qrDataUrl: string;
  payment: {
    id: number;
    transactionId: string;
    amount: number;
    status: string;
    verificationCode: string | null;
    upiId: string | null;
  } | null;
}

const statusColors: Record<string, string> = {
  confirmed: "bg-amber-50 text-amber-800 border-amber-200",
  active: "bg-emerald-50 text-emerald-800 border-emerald-200",
  completed: "bg-slate-100 text-slate-700 border-slate-200",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200",
  expired: "bg-rose-50 text-rose-700 border-rose-200",
};

export default function MyBookingsPage() {
  const { user, loading } = useAuth();
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [fetching, setFetching] = useState(true);
  const [activeQrBooking, setActiveQrBooking] = useState<BookingRow | null>(null);
  const [verifyCodeInput, setVerifyCodeInput] = useState("");
  const [utrInput, setUtrInput] = useState("");
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const loadBookings = useCallback(async () => {
    setFetching(true);
    try {
      const res = await fetch("/api/bookings", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setBookings(data.bookings ?? []);
      }
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    if (user) void loadBookings();
    else setFetching(false);
  }, [user, loadBookings]);

  async function handleCancel(id: number) {
    setFeedbackMsg(null);
    const res = await fetch(`/api/bookings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    const data = await res.json();
    setFeedbackMsg(res.ok ? "Booking cancelled and bay released." : data.error);
    await loadBookings();
  }

  async function handleToggleAutoExtend(b: BookingRow) {
    const res = await fetch(`/api/bookings/${b.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "toggle_auto_extend",
        autoExtendEnabled: !b.autoExtendEnabled,
      }),
    });
    if (res.ok) {
      setFeedbackMsg(
        `Auto-extension ${!b.autoExtendEnabled ? "enabled" : "disabled"} for ${b.bookingCode}.`
      );
      await loadBookings();
    }
  }

  async function handleTrafficShift(b: BookingRow) {
    const res = await fetch("/api/dnlrp/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookingId: b.id,
        trafficDelayMinutes: 15,
        routeNote: "User requested +15m traffic delay shift",
      }),
    });
    const data = await res.json();
    setFeedbackMsg(
      res.ok
        ? `DNLRP shifted ${b.bookingCode} arrival window by +15 minutes.`
        : data.error
    );
    await loadBookings();
  }

  async function handleListOnMarketplace(b: BookingRow) {
    const ask = Math.max(20, Math.round(b.finalAmount * 0.9));
    const res = await fetch("/api/rrm/offer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId: b.id, askingPrice: ask }),
    });
    const data = await res.json();
    setFeedbackMsg(
      res.ok
        ? `Listed ${b.bookingCode} on the Reservation Marketplace for ₹${ask}!`
        : data.error
    );
  }

  async function handleVerifyPayment(b: BookingRow) {
    if (!b.payment) return;
    const code = verifyCodeInput.trim() || b.payment.verificationCode || "";
    const res = await fetch("/api/payments/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactionId: b.payment.transactionId,
        verificationCode: code,
        utrReference: utrInput.trim() || `UPI${Date.now().toString().slice(-8)}`,
      }),
    });
    const data = await res.json();
    setFeedbackMsg(res.ok ? `Payment verified (${b.payment.transactionId})!` : data.error);
    setVerifyCodeInput("");
    setUtrInput("");
    await loadBookings();
  }

  if (loading || fetching) {
    return (
      <div className="p-12 text-center text-sm text-slate-500">
        Loading your bookings &amp; QR gate passes...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <Ticket className="mx-auto h-10 w-10 text-indigo-600" />
        <h1 className="mt-3 text-xl font-extrabold text-slate-900">Sign In to View Bookings</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your active reservations, HMAC-signed QR passes, and UPI receipts live here.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-block rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white"
        >
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">
            My Reservations &amp; Gate QR Passes
          </h1>
          <p className="text-xs text-slate-500">
            Present your cryptographic QR code at any ParkBotix gate terminal or verify pending UPI payments.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void loadBookings()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700"
          >
            + Book New Bay
          </Link>
        </div>
      </div>

      {feedbackMsg && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-xs font-semibold text-indigo-900">
          {feedbackMsg}
        </div>
      )}

      {bookings.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-slate-600">
            You do not have any parking bookings yet.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white"
          >
            Explore Nearby Hubs
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {bookings.map((b) => (
            <div
              key={b.id}
              className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-extrabold text-indigo-700">
                        {b.bookingCode}
                      </span>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                          statusColors[b.status] ?? statusColors.confirmed
                        }`}
                      >
                        {b.status}
                      </span>
                    </div>
                    <h2 className="mt-1 text-base font-bold text-slate-900">{b.lotName}</h2>
                    <p className="text-xs text-slate-500">{b.lotAddress}</p>
                  </div>
                  <div className="text-right">
                    <span className="block rounded-lg bg-slate-900 px-2.5 py-1 font-mono text-xs font-bold text-white">
                      Bay {b.slotCode}
                    </span>
                    <span className="mt-1 block font-mono text-sm font-extrabold text-slate-900">
                      ₹{b.finalAmount}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-[11px]">
                  <div>
                    <span className="block text-slate-400">Vehicle</span>
                    <span className="font-mono font-bold text-slate-800">
                      {b.vehicleNumber}
                    </span>
                  </div>
                  <div>
                    <span className="block text-slate-400">Duration</span>
                    <span className="font-mono font-bold text-slate-800">
                      {b.durationHours}h ({b.slotType.toUpperCase()})
                    </span>
                  </div>
                  <div>
                    <span className="block text-slate-400">Window Start</span>
                    <span className="font-mono text-slate-700">
                      {new Date(b.startTime).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="block text-slate-400">Window End</span>
                    <span className="font-mono text-slate-700">
                      {new Date(b.endTime).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Payment verification section */}
                {b.payment && (
                  <div className="mt-3 rounded-xl border border-slate-200 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 font-bold text-slate-700">
                        <CreditCard className="h-3.5 w-3.5 text-indigo-600" />
                        {b.payment.transactionId}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                          b.payment.status === "verified"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {b.payment.status}
                      </span>
                    </div>

                    {b.payment.status !== "verified" && (
                      <div className="mt-2.5 space-y-2 border-t border-slate-100 pt-2.5">
                        <p className="text-[11px] text-slate-600">
                          UPI VPA: <span className="font-mono font-bold">{b.payment.upiId}</span> •
                          Server Verification Code:{" "}
                          <span className="font-mono font-bold text-indigo-700">
                            {b.payment.verificationCode}
                          </span>
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <input
                            type="text"
                            value={verifyCodeInput}
                            onChange={(e) => setVerifyCodeInput(e.target.value)}
                            placeholder={`Code (${b.payment.verificationCode})`}
                            className="w-32 rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-xs"
                          />
                          <input
                            type="text"
                            value={utrInput}
                            onChange={(e) => setUtrInput(e.target.value)}
                            placeholder="UPI UTR Ref (optional)"
                            className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => void handleVerifyPayment(b)}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Verify UPI
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setActiveQrBooking(b)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
                >
                  <QrCode className="h-3.5 w-3.5" /> Show QR Pass
                </button>

                {(b.status === "confirmed" || b.status === "active") && (
                  <button
                    type="button"
                    onClick={() => void handleToggleAutoExtend(b)}
                    className={`rounded-xl border px-3 py-1.5 text-xs font-bold ${
                      b.autoExtendEnabled
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-600"
                    }`}
                  >
                    Auto-Extend: {b.autoExtendEnabled ? "ON" : "OFF"}
                  </button>
                )}

                {b.status === "confirmed" && (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleTrafficShift(b)}
                      className="inline-flex items-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-100"
                    >
                      <Clock className="h-3.5 w-3.5" /> +15m Traffic Shift
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleListOnMarketplace(b)}
                      className="inline-flex items-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100"
                    >
                      <Tag className="h-3.5 w-3.5" /> Re-Sell Slot
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCancel(b.id)}
                      className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* QR Pass Modal */}
      {activeQrBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xl">
            <span className="font-mono text-[11px] font-bold uppercase text-indigo-600">
              HMAC-SHA256 Signed Gate Pass
            </span>
            <h3 className="mt-1 text-lg font-extrabold text-slate-900">
              {activeQrBooking.lotName}
            </h3>
            <p className="font-mono text-xs text-slate-500">
              {activeQrBooking.bookingCode} • Bay {activeQrBooking.slotCode} •{" "}
              {activeQrBooking.vehicleNumber}
            </p>
            <div className="my-4 inline-block rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <img
                src={activeQrBooking.qrDataUrl}
                alt="Signed QR Gate Pass"
                className="h-56 w-56"
              />
            </div>
            <div className="mb-4 flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-left">
              <span className="flex-1 truncate font-mono text-[10px] text-slate-600">
                {activeQrBooking.qrCodePayload}
              </span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(activeQrBooking.qrCodePayload);
                  setFeedbackMsg("Copied signed QR token for scanner testing.");
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-indigo-700 shadow-sm"
              >
                <Copy className="h-3 w-3" /> Copy Token
              </button>
            </div>
            <button
              type="button"
              onClick={() => setActiveQrBooking(null)}
              className="w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white hover:bg-slate-800"
            >
              Close Gate Pass
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
