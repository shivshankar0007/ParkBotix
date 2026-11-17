"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, Mail, ArrowRight, ShieldCheck, AlertCircle } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

const ROLE_PRESETS = [
  { label: "Customer (Driver)", email: "driver@parkbotix.local", pass: "Driver@1234", badge: "Customer" },
  { label: "Gate Scanner Officer", email: "scanner@parkbotix.local", pass: "Scanner@1234", badge: "Employee" },
  { label: "Lot Owner #1 (MG Road)", email: "owner1@parkbotix.local", pass: "Owner@1234", badge: "Owner" },
  { label: "Lot Owner #2 (E-City)", email: "owner2@parkbotix.local", pass: "Owner@1234", badge: "Owner" },
  { label: "Operations Admin", email: "admin@parkbotix.local", pass: "Admin@1234", badge: "Admin" },
  { label: "Platform SuperAdmin", email: "superadmin@parkbotix.local", pass: "ParkBotix@Super2026!", badge: "SuperAdmin" },
];

export default function LoginPage() {
  const router = useRouter();
  const { refreshAuth } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid credentials");
        return;
      }
      await refreshAuth();
      const role = data.user?.role;
      if (role === "employee") router.push("/scanner");
      else if (role === "owner") router.push("/owner");
      else if (role === "admin" || role === "superadmin") router.push("/admin");
      else router.push("/");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-12 lg:flex-row lg:items-start">
      <div className="flex-1 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <img
            src="/images/parkbotix-logo.png"
            alt="ParkBotix Logo"
            className="h-10 w-10 rounded-xl border border-slate-200"
          />
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">Sign In to ParkBotix</h1>
            <p className="text-xs text-slate-500">
              Secure HTTP-only session with RBAC enforcement
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">
              Email Address
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700">Password</label>
              <Link
                href="/forgot-password"
                className="text-xs font-semibold text-indigo-600 hover:underline"
              >
                Forgot password / OTP?
              </Link>
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? "Verifying Credentials..." : "Sign In"}
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-slate-500">
          New to ParkBotix?{" "}
          <Link href="/register" className="font-bold text-indigo-600 hover:underline">
            Create a customer account (100 bonus points)
          </Link>
        </p>
      </div>

      {/* Sandbox Role Quick-Fill Helper */}
      <div className="w-full rounded-2xl border border-slate-800 bg-[#0F172A] p-6 text-white lg:w-[400px]">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
          <h2 className="text-sm font-bold">Seeded RBAC Test Accounts</h2>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-slate-400">
          Click any role below to populate the login form and test strict backend RBAC,
          owner data isolation, QR scanner authorization, and SuperAdmin controls.
        </p>
        <div className="space-y-2">
          {ROLE_PRESETS.map((preset) => (
            <button
              key={preset.email}
              type="button"
              onClick={() => {
                setEmail(preset.email);
                setPassword(preset.pass);
              }}
              className="flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800/70 px-3.5 py-2.5 text-left transition hover:border-indigo-400 hover:bg-slate-800"
            >
              <div>
                <p className="text-xs font-bold text-white">{preset.label}</p>
                <p className="font-mono text-[10px] text-slate-400">{preset.email}</p>
              </div>
              <span className="rounded-md bg-indigo-500/20 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-indigo-300">
                {preset.badge}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
