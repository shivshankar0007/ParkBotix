"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MapPin,
  Ticket,
  Gift,
  MessageSquare,
  QrCode,
  ShieldCheck,
  Building2,
  Cpu,
  User,
  LogOut,
  Menu,
  X,
  Crown,
} from "lucide-react";
import { useAuth } from "./AuthProvider";

const roleBadgeStyles: Record<string, string> = {
  superadmin: "bg-indigo-500/20 text-indigo-200 border-indigo-400/30",
  admin: "bg-sky-500/20 text-sky-200 border-sky-400/30",
  owner: "bg-amber-500/20 text-amber-200 border-amber-400/30",
  employee: "bg-emerald-500/20 text-emerald-200 border-emerald-400/30",
  customer: "bg-slate-700 text-slate-200 border-slate-600",
};

export function Navbar() {
  const pathname = usePathname();
  const { user, loyalty, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems: Array<{ href: string; label: string; icon: React.ReactNode }> = [
    { href: "/", label: "Discover", icon: <MapPin className="h-4 w-4" /> },
    { href: "/my-bookings", label: "My Bookings", icon: <Ticket className="h-4 w-4" /> },
    { href: "/rewards", label: "Rewards", icon: <Gift className="h-4 w-4" /> },
    { href: "/feedback", label: "Feedback", icon: <MessageSquare className="h-4 w-4" /> },
  ];

  if (user && ["employee", "admin", "superadmin"].includes(user.role)) {
    navItems.push({
      href: "/scanner",
      label: "QR Scanner",
      icon: <QrCode className="h-4 w-4" />,
    });
  }

  if (user && ["owner", "superadmin"].includes(user.role)) {
    navItems.push({
      href: "/owner",
      label: "Owner Hub",
      icon: <Building2 className="h-4 w-4" />,
    });
  }

  if (user && ["admin", "superadmin"].includes(user.role)) {
    navItems.push(
      { href: "/admin", label: "Admin", icon: <ShieldCheck className="h-4 w-4" /> },
      { href: "/admin/full", label: "Platform", icon: <Crown className="h-4 w-4" /> },
      { href: "/admin/advanced", label: "AI Suite", icon: <Cpu className="h-4 w-4" /> }
    );
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-[#0F172A] text-white shadow-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5">
            <img
              src="/images/parkbotix-logo.png"
              alt="ParkBotix Official Logo"
              className="h-9 w-9 rounded-lg border border-indigo-400/30 object-cover shadow-sm"
            />
            <div className="leading-tight">
              <span className="block text-base font-extrabold tracking-tight text-white">
                PARK<span className="text-indigo-400">BOTIX</span>
              </span>
              <span className="block font-mono text-[10px] uppercase tracking-widest text-emerald-400">
                Smart Parking OS
              </span>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {navItems.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href ||
                    (item.href !== "/admin" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                    active
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="hidden items-center gap-3 lg:flex">
          {user ? (
            <>
              {loyalty && (
                <Link
                  href="/rewards"
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  {loyalty.pointsBalance} pts (₹{(loyalty.pointsBalance * 0.5).toFixed(0)})
                </Link>
              )}
              <Link
                href="/profile"
                className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs transition hover:border-indigo-400"
              >
                <User className="h-3.5 w-3.5 text-indigo-300" />
                <span className="max-w-[130px] truncate font-semibold text-slate-100">
                  {user.name}
                </span>
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                    roleBadgeStyles[user.role] ?? roleBadgeStyles.customer
                  }`}
                >
                  {user.role}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-rose-500/50 hover:bg-rose-500/10 hover:text-rose-300"
              >
                <LogOut className="h-3.5 w-3.5" />
                Logout
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="rounded-lg border border-slate-700 px-3.5 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
              >
                Sign In
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500"
              >
                Create Account
              </Link>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          className="inline-flex items-center justify-center rounded-lg border border-slate-700 p-2 text-slate-200 lg:hidden"
          aria-label="Toggle navigation menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-slate-800 bg-slate-900 px-4 pb-4 pt-3 lg:hidden">
          <div className="grid grid-cols-2 gap-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 rounded-lg bg-slate-800/80 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-indigo-600"
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-3">
            {user ? (
              <>
                <Link
                  href="/profile"
                  onClick={() => setMobileOpen(false)}
                  className="text-xs font-semibold text-indigo-300"
                >
                  {user.name} ({user.role})
                </Link>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-300"
                >
                  Logout
                </button>
              </>
            ) : (
              <div className="flex w-full gap-2">
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                  className="flex-1 rounded-lg border border-slate-700 py-2 text-center text-xs font-semibold"
                >
                  Sign In
                </Link>
                <Link
                  href="/register"
                  onClick={() => setMobileOpen(false)}
                  className="flex-1 rounded-lg bg-indigo-600 py-2 text-center text-xs font-semibold"
                >
                  Register
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
