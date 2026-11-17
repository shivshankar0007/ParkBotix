export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

export const LOYALTY_POINT_RUPEE_VALUE = 0.5; // 1 point = ₹0.50 per Phase 8 specification

export function formatRupees(amount: number): string {
  return `₹${Number(amount || 0).toFixed(2).replace(/\.00$/, "")}`;
}

export function computeTier(totalEarned: number): string {
  if (totalEarned >= 2500) return "Platinum";
  if (totalEarned >= 1000) return "Gold";
  if (totalEarned >= 400) return "Silver";
  return "Bronze";
}
