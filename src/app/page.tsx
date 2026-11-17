"use client";

import React, { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Search,
  Navigation,
  Zap,
  Star,
  Clock,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  Ticket,
  Car,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { AiAssistantWidget } from "@/components/AiAssistantWidget";

const ParkingMap = dynamic(
  () => import("@/components/ParkingMap").then((m) => m.ParkingMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[360px] items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-xs font-semibold text-slate-500 lg:h-[420px]">
        Loading OpenStreetMap Hub Telemetry...
      </div>
    ),
  }
);

interface LotSummary {
  id: number;
  name: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  baseHourlyRate: number;
  evRateMultiplier: number;
  operatingHours: string;
  amenities: string[] | null;
  totalSlotCount: number;
  availableSlots: number;
  reservedSlots: number;
  occupiedSlots: number;
  evSlots: number;
  evAvailable: number;
  occupancyPercent: number;
  avgRating: number;
  reviewCount: number;
  distanceKm: number | null;
}

interface SlotItem {
  id: number;
  lotId: number;
  slotCode: string;
  floor: string;
  slotType: string;
  status: string;
  hourlyRate: number;
  isEvEnabled: boolean;
  evCharger?: {
    chargerType: string;
    powerKw: number;
    ratePerKwh: number;
  } | null;
}

interface CreatedBookingState {
  bookingCode: string;
  slotCode: string;
  finalAmount: number;
  qrDataUrl: string;
  earnedPoints: number;
  payment: {
    transactionId: string;
    verificationCode: string;
    status: string;
  };
}

export default function HomePage() {
  const { user, loyalty, refreshAuth } = useAuth();
  const [lots, setLots] = useState<LotSummary[]>([]);
  const [loadingLots, setLoadingLots] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [evOnly, setEvOnly] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  const [selectedLotId, setSelectedLotId] = useState<number | null>(null);
  const [slots, setSlots] = useState<SlotItem[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<SlotItem | null>(null);

  // Booking Form State
  const [durationHours, setDurationHours] = useState(2);
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [loyaltyPointsToRedeem, setLoyaltyPointsToRedeem] = useState(0);
  const [autoExtendEnabled, setAutoExtendEnabled] = useState(true);
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [createdBooking, setCreatedBooking] = useState<CreatedBookingState | null>(null);

  // AI Smart Advice banner
  const [aiAdvice, setAiAdvice] = useState<{
    advice: string;
    provider: string;
  } | null>(null);
  const [loadingAdvice, setLoadingAdvice] = useState(false);

  useEffect(() => {
    if (user?.vehicleNumber && !vehicleNumber) {
      setVehicleNumber(user.vehicleNumber);
    }
  }, [user, vehicleNumber]);

  const fetchLots = useCallback(async () => {
    setLoadingLots(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (evOnly) params.set("evOnly", "true");
      if (userCoords) {
        params.set("lat", String(userCoords.lat));
        params.set("lng", String(userCoords.lng));
      }
      const res = await fetch(`/api/lots?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      const list: LotSummary[] = data.lots ?? [];
      setLots(list);
      if (list.length > 0 && !selectedLotId) {
        setSelectedLotId(list[0].id);
      }
    } finally {
      setLoadingLots(false);
    }
  }, [searchQuery, evOnly, userCoords, selectedLotId]);

  useEffect(() => {
    void fetchLots();
  }, [fetchLots]);

  const fetchSlots = useCallback(async (lotId: number) => {
    setLoadingSlots(true);
    setSelectedSlot(null);
    setCouponDiscount(0);
    setCouponMessage(null);
    try {
      const res = await fetch(`/api/lots/${lotId}`, { cache: "no-store" });
      const data = await res.json();
      const slotList: SlotItem[] = data.slots ?? [];
      setSlots(slotList);
      const firstAvail = slotList.find((s) => s.status === "available") ?? null;
      setSelectedSlot(firstAvail);
    } finally {
      setLoadingSlots(false);
    }
  }, []);

  useEffect(() => {
    if (selectedLotId) {
      void fetchSlots(selectedLotId);
    }
  }, [selectedLotId, fetchSlots]);

  function handleLocateMe() {
    if (!navigator.geolocation) {
      alert("Browser geolocation is not supported on this device.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        // Fallback to Bengaluru CBD coordinates if user denies browser GPS permission
        setUserCoords({ lat: 12.9716, lng: 77.5946 });
        setLocating(false);
      },
      { timeout: 6000 }
    );
  }

  async function handleAskAiAdvice() {
    setLoadingAdvice(true);
    try {
      const res = await fetch("/api/ai/advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: userCoords?.lat,
          lng: userCoords?.lng,
          preferEv: evOnly,
          durationHours,
        }),
      });
      const data = await res.json();
      setAiAdvice({ advice: data.advice, provider: data.provider });
      if (data.recommendedLot?.lotId) {
        setSelectedLotId(data.recommendedLot.lotId);
      }
    } finally {
      setLoadingAdvice(false);
    }
  }

  const baseAmount = selectedSlot
    ? Math.round(selectedSlot.hourlyRate * durationHours * 100) / 100
    : 0;
  const maxLoyaltyPointsUsable = loyalty
    ? Math.min(
        loyalty.pointsBalance,
        Math.floor(Math.max(0, baseAmount - couponDiscount) / 0.5)
      )
    : 0;
  const safeLoyaltyPoints = Math.min(loyaltyPointsToRedeem, maxLoyaltyPointsUsable);
  const loyaltyDiscount = Math.round(safeLoyaltyPoints * 0.5 * 100) / 100;
  const finalAmount = Math.max(
    0,
    Math.round((baseAmount - couponDiscount - loyaltyDiscount) * 100) / 100
  );

  async function handleValidateCoupon() {
    if (!couponCode.trim() || baseAmount <= 0) return;
    setCouponMessage(null);
    const res = await fetch("/api/coupons/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: couponCode.trim(), bookingAmount: baseAmount }),
    });
    const data = await res.json();
    if (res.ok && data.valid) {
      setCouponDiscount(data.discountAmount);
      setCouponMessage(`Applied ${data.coupon.code}: -₹${data.discountAmount}`);
    } else {
      setCouponDiscount(0);
      setCouponMessage(data.error || "Invalid coupon");
    }
  }

  async function handleBookNow(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLotId || !selectedSlot) return;
    setBookingError(null);
    setBookingSubmitting(true);

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lotId: selectedLotId,
          slotId: selectedSlot.id,
          vehicleNumber: vehicleNumber.trim() || "KA-01-MJ-4821",
          durationHours,
          couponCode: couponDiscount > 0 ? couponCode.trim() : null,
          loyaltyPointsToRedeem: safeLoyaltyPoints,
          autoExtendEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBookingError(data.error || "Booking failed");
        return;
      }

      setCreatedBooking({
        bookingCode: data.booking.bookingCode,
        slotCode: data.booking.slotCode,
        finalAmount: data.booking.finalAmount,
        qrDataUrl: data.booking.qrDataUrl,
        earnedPoints: data.earnedPoints,
        payment: data.payment,
      });

      await Promise.all([fetchLots(), fetchSlots(selectedLotId), refreshAuth()]);
    } finally {
      setBookingSubmitting(false);
    }
  }

  const selectedLot = lots.find((l) => l.id === selectedLotId) ?? null;
  const totalOpenAcrossCity = lots.reduce((s, l) => s + l.availableSlots, 0);
  const totalEvOpen = lots.reduce((s, l) => s + l.evAvailable, 0);

  return (
    <div className="pb-16">
      {/* Compact Hero Command Banner */}
      <section className="relative overflow-hidden border-b border-slate-800 bg-[#0F172A] text-white">
        <img
          src="/images/smart-parking-hero.jpg"
          alt="ParkBotix Smart Parking Facility"
          className="absolute inset-0 h-full w-full object-cover opacity-20"
        />
        <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 font-mono text-[11px] font-semibold text-emerald-300">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                LIVE TELEMETRY • {totalOpenAcrossCity} OPEN BAYS • {totalEvOpen} EV FAST CHARGERS
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                Find, Reserve &amp; Scan into Smart Parking in Seconds.
              </h1>
              <p className="mt-2 text-sm text-slate-300">
                Explore live OpenStreetMap parking hubs without logging in. Lock an exact bay with
                PostgreSQL concurrency protection, redeem loyalty points (1 pt = ₹0.50), and enter
                with an HMAC-signed QR Gate Pass.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleLocateMe}
                disabled={locating}
                className="inline-flex items-center gap-2 rounded-xl border border-sky-400/40 bg-sky-500/15 px-4 py-2.5 text-xs font-bold text-sky-200 transition hover:bg-sky-500/25"
              >
                <Navigation className="h-4 w-4" />
                {locating ? "Locating..." : userCoords ? "GPS Active" : "Use My GPS"}
              </button>
              <button
                type="button"
                onClick={() => void handleAskAiAdvice()}
                disabled={loadingAdvice}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-500"
              >
                <Sparkles className="h-4 w-4" />
                {loadingAdvice ? "Analyzing..." : "AI Best Hub Advice"}
              </button>
            </div>
          </div>

          {/* Search & Filter Row */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by hub name, locality, or city (e.g. MG Road, Indiranagar, Electronic City)..."
                className="w-full rounded-xl border border-slate-700 bg-slate-900/90 py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setEvOnly((prev) => !prev)}
              className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold transition ${
                evOnly
                  ? "border-sky-400 bg-sky-500/20 text-sky-200"
                  : "border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-500"
              }`}
            >
              <Zap className="h-4 w-4 text-sky-400" />
              EV Charging Only
            </button>
            <button
              type="button"
              onClick={() => void fetchLots()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-800"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>

          {aiAdvice && (
            <div className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-indigo-400/30 bg-indigo-950/60 p-3.5 text-xs text-indigo-100">
              <div className="flex items-start gap-2.5">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
                <div>
                  <span className="font-bold text-white">AI Recommendation: </span>
                  {aiAdvice.advice}
                  <span className="ml-2 rounded bg-indigo-500/30 px-1.5 py-0.5 font-mono text-[10px] uppercase text-indigo-200">
                    {aiAdvice.provider}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAiAdvice(null)}
                className="text-indigo-300 hover:text-white"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Main Split Map + Hub Cards + Live Bay Picker */}
      <section className="mx-auto mt-6 max-w-7xl px-4 sm:px-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Column: Map + Lots List */}
          <div className="space-y-5 lg:col-span-7">
            <ParkingMap
              lots={lots}
              selectedLotId={selectedLotId}
              userCoords={userCoords}
              onSelectLot={(id) => setSelectedLotId(id)}
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-900">
                  Nearby Smart Parking Hubs ({lots.length})
                </h2>
                <span className="font-mono text-xs text-slate-500">
                  Click a hub to inspect live 2D bay layout
                </span>
              </div>

              {loadingLots ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                  Loading live parking hubs...
                </div>
              ) : lots.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                  No parking hubs match your current filter.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {lots.map((lot) => {
                    const isSelected = lot.id === selectedLotId;
                    return (
                      <button
                        key={lot.id}
                        type="button"
                        onClick={() => setSelectedLotId(lot.id)}
                        className={`rounded-2xl border p-4 text-left transition ${
                          isSelected
                            ? "border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-600/20"
                            : "border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-bold text-slate-900">{lot.name}</h3>
                            <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">
                              {lot.address}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-lg bg-slate-900 px-2 py-1 font-mono text-xs font-bold text-white">
                            ₹{lot.baseHourlyRate}/hr
                          </span>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono ${
                              lot.availableSlots > 3
                                ? "bg-emerald-50 text-emerald-700"
                                : lot.availableSlots > 0
                                ? "bg-amber-50 text-amber-700"
                                : "bg-rose-50 text-rose-700"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                lot.availableSlots > 3
                                  ? "bg-emerald-500"
                                  : lot.availableSlots > 0
                                  ? "bg-amber-500"
                                  : "bg-rose-500"
                              }`}
                            />
                            {lot.availableSlots}/{lot.totalSlotCount} Open
                          </span>

                          {lot.evSlots > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 font-mono text-sky-700">
                              <Zap className="h-3 w-3" />
                              {lot.evAvailable} EV
                            </span>
                          )}

                          <span className="inline-flex items-center gap-1 text-slate-600">
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                            {lot.avgRating}
                          </span>

                          {lot.distanceKm !== null && (
                            <span className="ml-auto font-mono text-indigo-600">
                              {lot.distanceKm} km
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Live 2D Slot Picker & Transactional Checkout */}
          <div className="lg:col-span-5">
            <div className="sticky top-20 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              {selectedLot ? (
                <>
                  <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                    <div>
                      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                        Live Bay Matrix • Hub #{selectedLot.id}
                      </span>
                      <h2 className="text-lg font-extrabold text-slate-900">
                        {selectedLot.name}
                      </h2>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                        <Clock className="h-3.5 w-3.5" />
                        {selectedLot.operatingHours}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="block font-mono text-xl font-extrabold text-emerald-600">
                        {selectedLot.availableSlots}
                      </span>
                      <span className="text-[10px] font-semibold uppercase text-slate-500">
                        Available
                      </span>
                    </div>
                  </div>

                  {/* Interactive 2D Bay Grid */}
                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-600">
                      <span>Select a Parking Bay</span>
                      <div className="flex items-center gap-2.5">
                        <span className="flex items-center gap-1">
                          <span className="h-2.5 w-2.5 rounded bg-emerald-500" /> Free
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="h-2.5 w-2.5 rounded bg-amber-400" /> Rsvd
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="h-2.5 w-2.5 rounded bg-rose-500" /> Busy
                        </span>
                      </div>
                    </div>

                    {loadingSlots ? (
                      <div className="py-8 text-center text-xs text-slate-500">
                        Loading bay telemetry...
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 gap-2">
                        {slots.map((slot) => {
                          const isAvail = slot.status === "available";
                          const isPicked = selectedSlot?.id === slot.id;
                          return (
                            <button
                              key={slot.id}
                              type="button"
                              disabled={!isAvail}
                              onClick={() => setSelectedSlot(slot)}
                              className={`relative flex flex-col items-center justify-center rounded-xl border p-2 text-center transition ${
                                isPicked
                                  ? "border-indigo-600 bg-indigo-600 text-white shadow-md shadow-indigo-600/25"
                                  : isAvail
                                  ? slot.isEvEnabled
                                    ? "border-sky-300 bg-sky-50/70 text-slate-800 hover:border-indigo-500"
                                    : "border-emerald-200 bg-emerald-50/60 text-slate-800 hover:border-indigo-500"
                                  : slot.status === "reserved"
                                  ? "cursor-not-allowed border-amber-200 bg-amber-50 text-amber-700 opacity-75"
                                  : "cursor-not-allowed border-rose-200 bg-rose-50 text-rose-700 opacity-65"
                              }`}
                            >
                              {slot.isEvEnabled && (
                                <Zap
                                  className={`absolute right-1 top-1 h-3 w-3 ${
                                    isPicked ? "text-sky-200" : "text-sky-500"
                                  }`}
                                />
                              )}
                              <span className="font-mono text-xs font-bold">
                                {slot.slotCode}
                              </span>
                              <span
                                className={`font-mono text-[10px] ${
                                  isPicked ? "text-indigo-100" : "text-slate-500"
                                }`}
                              >
                                ₹{slot.hourlyRate}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Booking Form or Instant QR Receipt */}
                  {createdBooking ? (
                    <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-center">
                      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white">
                        <CheckCircle2 className="h-5 w-5" />
                      </div>
                      <h3 className="text-sm font-extrabold text-emerald-900">
                        Bay {createdBooking.slotCode} Reserved!
                      </h3>
                      <p className="mt-0.5 font-mono text-xs font-bold text-slate-700">
                        {createdBooking.bookingCode} • Final ₹{createdBooking.finalAmount}
                      </p>
                      <p className="mt-1 text-[11px] font-semibold text-emerald-700">
                        +{createdBooking.earnedPoints} Loyalty Points Credited!
                      </p>
                      <div className="my-3 inline-block rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                        <img
                          src={createdBooking.qrDataUrl}
                          alt="Signed Booking QR Code"
                          className="h-44 w-44"
                        />
                      </div>
                      <p className="text-[11px] text-slate-600">
                        Present this HMAC-signed QR code at the ParkBotix Gate Scanner.
                        Verification OTP for UPI:{" "}
                        <span className="font-mono font-bold text-indigo-700">
                          {createdBooking.payment.verificationCode}
                        </span>
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Link
                          href="/my-bookings"
                          className="flex-1 rounded-xl bg-indigo-600 py-2 text-xs font-bold text-white hover:bg-indigo-700"
                        >
                          Open My Bookings &amp; Pay UPI
                        </Link>
                        <button
                          type="button"
                          onClick={() => setCreatedBooking(null)}
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                        >
                          Book Another
                        </button>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={handleBookNow} className="mt-5 space-y-3.5 border-t border-slate-100 pt-4">
                      {selectedSlot ? (
                        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
                          <div>
                            <span className="font-semibold text-slate-600">Selected Bay: </span>
                            <span className="font-mono font-bold text-indigo-700">
                              {selectedSlot.slotCode} ({selectedSlot.floor} •{" "}
                              {selectedSlot.slotType.toUpperCase()})
                            </span>
                            {selectedSlot.evCharger && (
                              <span className="ml-2 font-mono text-[10px] text-sky-600">
                                {selectedSlot.evCharger.chargerType} ({selectedSlot.evCharger.powerKw}kW)
                              </span>
                            )}
                          </div>
                          <span className="font-mono font-bold text-slate-900">
                            ₹{selectedSlot.hourlyRate}/hr
                          </span>
                        </div>
                      ) : (
                        <div className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                          No available bays in this hub right now. Select another hub!
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-[11px] font-bold text-slate-700">
                            Duration (Hours)
                          </label>
                          <select
                            value={durationHours}
                            onChange={(e) => {
                              setDurationHours(Number(e.target.value));
                              setCouponDiscount(0);
                            }}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold focus:border-indigo-500 focus:outline-none"
                          >
                            {[1, 2, 3, 4, 6, 8, 12].map((h) => (
                              <option key={h} value={h}>
                                {h} {h === 1 ? "Hour" : "Hours"}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-bold text-slate-700">
                            Vehicle Plate
                          </label>
                          <div className="relative">
                            <Car className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                            <input
                              type="text"
                              required
                              value={vehicleNumber}
                              onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                              placeholder="KA-01-MJ-4821"
                              className="w-full rounded-xl border border-slate-200 py-2 pl-8 pr-2 font-mono text-xs font-semibold uppercase focus:border-indigo-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Coupon Validation */}
                      <div>
                        <label className="mb-1 block text-[11px] font-bold text-slate-700">
                          Coupon Code (try PARK20, FIRST50, EVGREEN)
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={couponCode}
                            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                            placeholder="Enter promo code"
                            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs uppercase focus:border-indigo-500 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => void handleValidateCoupon()}
                            className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
                          >
                            Apply
                          </button>
                        </div>
                        {couponMessage && (
                          <p
                            className={`mt-1 text-[11px] font-semibold ${
                              couponDiscount > 0 ? "text-emerald-600" : "text-rose-600"
                            }`}
                          >
                            {couponMessage}
                          </p>
                        )}
                      </div>

                      {/* Loyalty Points Redemption (1 pt = ₹0.50) */}
                      {user && loyalty && loyalty.pointsBalance > 0 && (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                          <div className="flex items-center justify-between text-[11px] font-bold text-emerald-900">
                            <span>Redeem Loyalty Points (1 pt = ₹0.50)</span>
                            <span className="font-mono">
                              Bal: {loyalty.pointsBalance} pts
                            </span>
                          </div>
                          <div className="mt-2 flex items-center gap-3">
                            <input
                              type="range"
                              min={0}
                              max={maxLoyaltyPointsUsable}
                              step={10}
                              value={safeLoyaltyPoints}
                              onChange={(e) =>
                                setLoyaltyPointsToRedeem(Number(e.target.value))
                              }
                              className="flex-1 accent-emerald-600"
                            />
                            <span className="font-mono text-xs font-bold text-emerald-700">
                              {safeLoyaltyPoints} pts (-₹{loyaltyDiscount})
                            </span>
                          </div>
                        </div>
                      )}

                      <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                        <input
                          type="checkbox"
                          checked={autoExtendEnabled}
                          onChange={(e) => setAutoExtendEnabled(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
                        />
                        Enable Auto-Extension (adds 30m automatically if bay is free)
                      </label>

                      {/* Price Summary */}
                      <div className="space-y-1 rounded-xl bg-slate-900 p-3.5 text-xs text-slate-200">
                        <div className="flex justify-between">
                          <span>
                            Base Parking ({durationHours}h × ₹{selectedSlot?.hourlyRate ?? 0})
                          </span>
                          <span className="font-mono">₹{baseAmount.toFixed(2)}</span>
                        </div>
                        {couponDiscount > 0 && (
                          <div className="flex justify-between text-emerald-400">
                            <span>Coupon Discount</span>
                            <span className="font-mono">-₹{couponDiscount.toFixed(2)}</span>
                          </div>
                        )}
                        {loyaltyDiscount > 0 && (
                          <div className="flex justify-between text-emerald-400">
                            <span>Loyalty Redemption</span>
                            <span className="font-mono">-₹{loyaltyDiscount.toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between border-t border-slate-700 pt-2 text-sm font-extrabold text-white">
                          <span>Total Payable</span>
                          <span className="font-mono text-emerald-400">
                            ₹{finalAmount.toFixed(2)}
                          </span>
                        </div>
                      </div>

                      {bookingError && (
                        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          {bookingError}
                        </div>
                      )}

                      {user ? (
                        <button
                          type="submit"
                          disabled={!selectedSlot || bookingSubmitting}
                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-md shadow-indigo-600/25 transition hover:bg-indigo-700 disabled:opacity-50"
                        >
                          <Ticket className="h-4 w-4" />
                          {bookingSubmitting
                            ? "Locking Bay & Signing QR..."
                            : `Confirm Bay ${selectedSlot?.slotCode ?? ""} • ₹${finalAmount}`}
                        </button>
                      ) : (
                        <div className="space-y-2">
                          <Link
                            href="/login"
                            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-md transition hover:bg-indigo-700"
                          >
                            <ShieldCheck className="h-4 w-4" />
                            Sign In to Reserve Bay {selectedSlot?.slotCode ?? ""}
                          </Link>
                          <p className="text-center text-[11px] text-slate-500">
                            Browsing is public. Sign in or{" "}
                            <Link href="/register" className="font-bold text-indigo-600 underline">
                              register free
                            </Link>{" "}
                            (100 bonus loyalty points) to confirm a bay.
                          </p>
                        </div>
                      )}
                    </form>
                  )}
                </>
              ) : (
                <div className="py-12 text-center text-sm text-slate-500">
                  Select a parking hub from the map or list to inspect live bays.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <AiAssistantWidget />
    </div>
  );
}
