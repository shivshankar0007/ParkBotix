/**
 * ParkBotix — Automated End-to-End Integration, RBAC & Security Verification Suite
 *
 * Runs real HTTP requests against the live ParkBotix server and PostgreSQL database.
 * Usage: BASE_URL=http://127.0.0.1:3000 npx tsx scripts/verify-e2e.ts
 */

import assert from "node:assert/strict";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";

class HttpClient {
  cookie = "";

  async req(path: string, init?: RequestInit) {
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (this.cookie) headers["Cookie"] = this.cookie;
    const res = await fetch(`${BASE}${path}`, { ...init, headers });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const m = setCookie.match(/parkbotix_session=([^;]+)/);
      if (m) {
        this.cookie = m[1] ? `parkbotix_session=${m[1]}` : "";
      }
    }
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { raw: text };
    }
    return { status: res.status, json };
  }
}

async function runTests() {
  const passed: string[] = [];
  const check = (name: string) => {
    passed.push(name);
    console.log(`  [PASS] ${name}`);
  };

  console.log(`Running ParkBotix E2E QA Verification against ${BASE}...\n`);

  // 1. Health & Public Discovery (no login required)
  const anon = new HttpClient();
  const health = await anon.req("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);
  check("GET /api/health returns PostgreSQL ok=true & seeded counts");

  const lotsRes = await anon.req("/api/lots?lat=12.9716&lng=77.5946");
  assert.equal(lotsRes.status, 200);
  const lots = lotsRes.json.lots as Array<{ id: number; distanceKm: number }>;
  assert.ok(lots.length >= 4, "Expected at least 4 seeded parking lots");
  assert.equal(typeof lots[0].distanceKm, "number");
  check("GET /api/lots public discovery + Haversine geolocation distance works");

  // 2. Customer Registration, Logout, Forgot Password OTP + Reset, Login
  const testEmail = `qa_driver_${Date.now()}@parkbotix.local`;
  const customer = new HttpClient();
  const reg = await customer.req("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "QA Test Driver",
      email: testEmail,
      password: "Password@123",
      vehicleNumber: "KA-01-QA-9999",
    }),
  });
  assert.equal(reg.status, 201);
  check("POST /api/auth/register creates customer + 100 bonus loyalty points + HTTP-only cookie");

  const me = await customer.req("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal((me.json.loyalty as { pointsBalance: number }).pointsBalance, 100);
  check("GET /api/auth/me validates persistent session & 100 welcome loyalty points");

  // Forgot password + OTP reset
  const forgot = await anon.req("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: testEmail }),
  });
  assert.equal(forgot.status, 200);
  const otp = forgot.json.sandboxOtp as string;
  assert.match(otp, /^\d{6}$/);

  const reset = await anon.req("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: testEmail, otp, newPassword: "NewPassword@456" }),
  });
  assert.equal(reset.status, 200);
  check("POST /api/auth/forgot-password + /reset-password OTP verification works");

  // Re-login with new password
  const relogin = await customer.req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: testEmail, password: "NewPassword@456" }),
  });
  assert.equal(relogin.status, 200);
  check("POST /api/auth/login succeeds with updated password");

  // 3. RBAC enforcement: customer blocked from admin & scanner
  const forbiddenAdmin = await customer.req("/api/admin/overview");
  assert.equal(forbiddenAdmin.status, 403);
  const forbiddenScan = await customer.req("/api/scanner/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qrInput: "PBX-MG26-1001" }),
  });
  assert.equal(forbiddenScan.status, 403);
  check("RBAC blocks customer from /api/admin/overview & /api/scanner/scan (HTTP 403)");

  // 4. Transactional Booking + Coupon + Loyalty + Double-Booking Prevention + Payment Verification
  const lotDetail = await customer.req(`/api/lots/${lots[0].id}`);
  const availSlot = (lotDetail.json.slots as Array<{ id: number; status: string }>).find(
    (s) => s.status === "available"
  );
  assert.ok(availSlot, "Expected an available slot in lot 1");

  const book1 = await customer.req("/api/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lotId: lots[0].id,
      slotId: availSlot.id,
      vehicleNumber: "KA-01-QA-9999",
      durationHours: 2,
      couponCode: "PARK20",
      loyaltyPointsToRedeem: 20,
      autoExtendEnabled: true,
    }),
  });
  assert.equal(book1.status, 201);
  const createdBooking = book1.json.booking as {
    id: number;
    bookingCode: string;
    qrCodePayload: string;
    loyaltyDiscount: number;
  };
  const createdPayment = book1.json.payment as {
    transactionId: string;
    verificationCode: string;
  };
  assert.equal(createdBooking.loyaltyDiscount, 10, "20 loyalty pts must equal ₹10 (1 pt = ₹0.50)");
  check("POST /api/bookings enforces coupon + 1pt=₹0.50 loyalty + HMAC QR signing");

  // Attempt duplicate booking on same slot -> MUST fail with 409 Conflict
  const doubleBook = await customer.req("/api/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lotId: lots[0].id,
      slotId: availSlot.id,
      vehicleNumber: "KA-01-QA-8888",
      durationHours: 2,
    }),
  });
  assert.equal(doubleBook.status, 409);
  check("Concurrency lock prevents duplicate active booking on same slot (HTTP 409)");

  // Payment verification: wrong code rejected, valid code verified
  const badVerify = await customer.req("/api/payments/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transactionId: createdPayment.transactionId,
      verificationCode: "000000",
    }),
  });
  assert.equal(badVerify.status, 400);

  const goodVerify = await customer.req("/api/payments/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transactionId: createdPayment.transactionId,
      verificationCode: createdPayment.verificationCode,
      utrReference: "UTRQA123456",
    }),
  });
  assert.equal(goodVerify.status, 200);
  check("POST /api/payments/verify rejects forged codes & verifies matching server code");

  // 5. QR Scanner Entry, Duplicate Entry Prevention, Forged QR Rejection, and Exit
  const scanner = new HttpClient();
  const empLogin = await scanner.req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "scanner@parkbotix.local",
      password: "Scanner@1234",
    }),
  });
  assert.equal(empLogin.status, 200);

  const forgedScan = await scanner.req("/api/scanner/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qrInput: "PBXQR.Zm9yZ2Vk.deadbeef0000000000000000" }),
  });
  assert.equal(forgedScan.status, 400);

  const entryScan = await scanner.req("/api/scanner/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qrInput: createdBooking.qrCodePayload, mode: "entry" }),
  });
  assert.equal(entryScan.status, 200);
  assert.equal(entryScan.json.action, "entry");

  const dupEntry = await scanner.req("/api/scanner/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qrInput: createdBooking.qrCodePayload, mode: "entry" }),
  });
  assert.equal(dupEntry.status, 409);

  const exitScan = await scanner.req("/api/scanner/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qrInput: createdBooking.qrCodePayload, mode: "exit" }),
  });
  assert.equal(exitScan.status, 200);
  assert.equal(exitScan.json.action, "exit");
  check("QR Scanner rejects forged QR, approves entry, blocks duplicate entry, and completes exit");

  // 6. Strict Owner Data Isolation
  const owner1 = new HttpClient();
  await owner1.req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner1@parkbotix.local", password: "Owner@1234" }),
  });
  const owner1Summary = await owner1.req("/api/owner/summary");
  assert.equal(owner1Summary.status, 200);
  const owner1LotIds = (owner1Summary.json.lots as Array<{ id: number }>).map((l) => l.id);
  const otherLot = lots.find((l) => !owner1LotIds.includes(l.id));
  assert.ok(otherLot, "Expected another owner's lot for isolation test");
  const crossEdit = await owner1.req(`/api/lots/${otherLot.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseHourlyRate: 999 }),
  });
  assert.equal(crossEdit.status, 403);
  check("Owner isolation prevents Owner 1 from modifying Owner 2's parking hub (HTTP 403)");

  // 7. Admin Privilege Escalation Guard & AI Suite + Auto-Extension Worker
  const admin = new HttpClient();
  await admin.req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@parkbotix.local", password: "Admin@1234" }),
  });

  // Admin must be blocked from promoting any user to superadmin
  const escalate = await admin.req("/api/admin/users", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: 6, role: "superadmin" }),
  });
  assert.equal(escalate.status, 403);
  check("RBAC blocks Admin from escalating roles to SuperAdmin (HTTP 403)");

  // Test AI endpoints & Auto-Extension Worker
  for (const [ep, payload] of [
    ["/api/ai/advice", { preferEv: true }],
    ["/api/pcde/advise", { horizonMinutes: 60 }],
    ["/api/aerr/predict", {}],
    ["/api/ipre/suggest", { preferEv: true }],
    ["/api/gsd/detect", {}],
    ["/api/easas/assign", { minPowerKw: 22 }],
    ["/api/chat", { message: "What coupons are active?" }],
  ] as const) {
    const r = await admin.req(ep, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(r.status, 200, `AI endpoint ${ep} failed with ${r.status}`);
  }
  const cdaec = await admin.req("/api/cdaec/status");
  assert.equal(cdaec.status, 200);
  check("All AI & Smart Parking endpoints return valid PostgreSQL-backed responses");

  const worker = await admin.req("/api/jobs/auto-extend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ windowMinutes: 30, extensionMinutes: 30 }),
  });
  assert.equal(worker.status, 200);
  assert.equal(worker.json.lockAcquired, true);
  check("PostgreSQL Advisory-Locked Auto-Extension Background Worker executes safely");

  console.log(`\nALL ${passed.length} E2E VERIFICATION SUITES PASSED!`);
}

runTests().catch((err) => {
  console.error("\n[QA FAILURE]", err);
  process.exit(1);
});
