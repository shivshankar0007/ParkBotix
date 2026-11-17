"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { User, Fingerprint, ShieldCheck, CheckCircle2, Award } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

export default function ProfilePage() {
  const { user, loyalty, subscription, loading, refreshAuth } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // VFAP Vehicle Fingerprint state
  const [fpMake, setFpMake] = useState("Tata Nexon EV Max");
  const [fpColor, setFpColor] = useState("Pristine White");
  const [fpResult, setFpResult] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setPhone(user.phone || "");
      setVehicleNumber(user.vehicleNumber || "");
    }
  }, [user]);

  if (loading) {
    return <div className="p-12 text-center text-sm text-slate-500">Loading profile...</div>;
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-slate-900">Sign In Required</h1>
        <p className="mt-2 text-sm text-slate-500">
          Please sign in to manage your profile, vehicle fingerprint, and loyalty points.
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

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSavedMsg(null);
    const res = await fetch("/api/auth/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, vehicleNumber }),
    });
    if (res.ok) {
      await refreshAuth();
      setSavedMsg("Profile updated and audit logged.");
    }
    setSaving(false);
  }

  async function handleRegisterFingerprint(e: React.FormEvent) {
    e.preventDefault();
    setFpResult(null);
    const res = await fetch("/api/vfap/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicleNumber: vehicleNumber || "KA-01-MJ-4821",
        vehicleMake: fpMake,
        vehicleColor: fpColor,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setFpResult(
        `Registered VFAP Hash: ${data.fingerprint.fingerprintHash} (Trust Score ${(
          data.fingerprint.trustScore * 100
        ).toFixed(0)}%)`
      );
    } else {
      setFpResult(data.error || "Failed to register fingerprint");
    }
  }

  async function handleVerifyFingerprint() {
    const res = await fetch("/api/vfap/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicleNumber: vehicleNumber || "KA-01-MJ-4821",
        vehicleMake: fpMake,
        vehicleColor: fpColor,
      }),
    });
    const data = await res.json();
    setFpResult(
      data.verified
        ? `VERIFIED (${data.vehicleNumber}) — Trust Score ${(data.trustScore * 100).toFixed(
            0
          )}% • Verified ${data.verifiedCount}x`
        : `NOT VERIFIED: ${data.reason || "Signature mismatch"}`
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white">
            <User className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">{user.name}</h1>
            <p className="font-mono text-xs text-slate-500">
              {user.email} • ROLE: {user.role.toUpperCase()}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {loyalty && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-right">
              <span className="block font-mono text-lg font-extrabold text-emerald-700">
                {loyalty.pointsBalance} pts
              </span>
              <span className="text-[11px] font-semibold text-emerald-800">
                {loyalty.tier} Tier • ₹{(loyalty.pointsBalance * 0.5).toFixed(2)} value
              </span>
            </div>
          )}
          {subscription && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-right">
              <span className="flex items-center justify-end gap-1 text-xs font-extrabold text-indigo-800">
                <Award className="h-3.5 w-3.5" /> {subscription.planName}
              </span>
              <span className="font-mono text-[11px] text-indigo-600">
                {subscription.hoursRemaining} hrs remaining
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Edit Profile */}
        <form
          onSubmit={handleSaveProfile}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <ShieldCheck className="h-4 w-4 text-indigo-600" />
            Account Details
          </h2>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Full Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">Phone</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">
              Vehicle Registration Plate
            </label>
            <input
              type="text"
              value={vehicleNumber}
              onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-sm uppercase focus:border-indigo-500 focus:outline-none"
            />
          </div>
          {savedMsg && (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> {savedMsg}
            </p>
          )}
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-indigo-700"
          >
            {saving ? "Saving..." : "Save Profile Changes"}
          </button>
        </form>

        {/* VFAP Vehicle Fingerprint */}
        <form
          onSubmit={handleRegisterFingerprint}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <Fingerprint className="h-4 w-4 text-indigo-600" />
            VFAP Vehicle Fingerprint Protocol
          </h2>
          <p className="text-xs text-slate-500">
            Register a SHA-256 vehicle signature for faster ANPR &amp; contactless gate verification.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                Vehicle Make &amp; Model
              </label>
              <input
                type="text"
                value={fpMake}
                onChange={(e) => setFpMake(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Color</label>
              <input
                type="text"
                value={fpColor}
                onChange={(e) => setFpColor(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>
          {fpResult && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 font-mono text-[11px] font-semibold text-indigo-900">
              {fpResult}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white hover:bg-slate-800"
            >
              Register Fingerprint
            </button>
            <button
              type="button"
              onClick={() => void handleVerifyFingerprint()}
              className="flex-1 rounded-xl border border-indigo-200 bg-indigo-50 py-2.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
            >
              Verify VFAP Trust
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
