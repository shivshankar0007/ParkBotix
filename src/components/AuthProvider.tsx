"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: "superadmin" | "admin" | "owner" | "employee" | "customer";
  assignedLotId: number | null;
  vehicleNumber: string | null;
}

export interface LoyaltyInfo {
  pointsBalance: number;
  totalEarned: number;
  totalRedeemed: number;
  tier: string;
  lastTransactionNote?: string | null;
}

export interface SubscriptionInfo {
  id: number;
  planName: string;
  status: string;
  hoursRemaining: number;
  discountPercent: number;
  evBonus: boolean;
  endDate: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loyalty: LoyaltyInfo | null;
  subscription: SubscriptionInfo | null;
  loading: boolean;
  refreshAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loyalty: null,
  subscription: null,
  loading: true,
  refreshAuth: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyInfo | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user ?? null);
        setLoyalty(data.loyalty ?? null);
        setSubscription(data.subscription ?? null);
      } else {
        setUser(null);
        setLoyalty(null);
        setSubscription(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setLoyalty(null);
    setSubscription(null);
    window.location.href = "/";
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loyalty, subscription, loading, refreshAuth, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
