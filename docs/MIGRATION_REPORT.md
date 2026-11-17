# PARKBOTIX — Migration, Feature Parity, Security Audit & Deployment Report

## 1. Architecture Modernization Overview

The ParkBotix Smart Parking Management System has been modernized into a fullstack **Node.js + TypeScript + Next.js App Router + PostgreSQL + Drizzle ORM** production architecture with strict Zod request validation, HTTP-only session authentication, RBAC governance, transactional slot locking, cryptographic QR verification, live OpenStreetMap discovery, camera QR scanning, and an advisory-locked background auto-extension worker.

---

## 2. Database Schema Parity (All 26 Domain Tables + 2 Security Tables)

All 26 ParkBotix domain tables are defined in `src/db/schema.ts` with proper PostgreSQL types, foreign keys, and indexes, plus `sessions` and `audit_logs`:

1. `users`
2. `parking_lots`
3. `parking_slots`
4. `bookings`
5. `payments`
6. `penalties`
7. `api_keys`
8. `ai_activity`
9. `password_resets`
10. `settings`
11. `feedback`
12. `coupons`
13. `user_loyalty`
14. `subscription_plans`
15. `user_subscriptions`
16. `penalty_share_logs`
17. `dynamic_pricing_logs`
18. `shadow_reservations`
19. `parking_events`
20. `slot_morphs`
21. `auto_extensions`
22. `congestion_predictions`
23. `vehicle_fingerprints`
24. `ev_charging_slots`
25. `marketplace_offers`
26. `crowd_density`
27. `sessions` *(added for revocable HTTP-only cookie authentication)*
28. `audit_logs` *(added for Phase 11 administrative & security audit logging)*

### Legacy SQLite Preservation & Migration Utility
- Script: `scripts/migrate-sqlite-to-postgres.ts`
- Creates an automatic timestamped backup inside `./backups/` before reading the source SQLite database (`-readonly`).
- Never deletes or modifies `instance/parkbotix.db`.
- Converts SQLite booleans (`0/1`), preserves IDs, resets PostgreSQL sequences (`setval`), avoids duplicates (`ON CONFLICT DO NOTHING`), and outputs a before/after count verification table.

---

## 3. Page & Dashboard Parity (All 13 Routes)

| Legacy Template | Modernized Route | Access Role |
|---|---|---|
| `index.html` | `/` | Public (no login required to browse; login required to book) |
| `login.html` | `/login` | Public |
| `register.html` | `/register` | Public |
| `forgot_password.html` | `/forgot-password` | Public |
| `profile.html` | `/profile` | Authenticated Users |
| `my_bookings.html` | `/my-bookings` | Authenticated Users |
| `rewards.html` | `/rewards` | Public catalog + Authenticated wallet |
| `feedback.html` | `/feedback` | Public feed + Authenticated submission |
| `scanner.html` | `/scanner` | Employee, Admin, SuperAdmin |
| `owner.html` | `/owner` | Owner (strictly isolated to assigned lots), SuperAdmin |
| `admin.html` | `/admin` | Admin, SuperAdmin |
| `admin_full.html` | `/admin/full` | Admin, SuperAdmin (SuperAdmin-only role/API key guards) |
| `admin_advanced.html` | `/admin/advanced` | Admin, SuperAdmin (15 AI modules + Auto-Extension Worker) |

---

## 4. AI & Smart Parking Endpoints Parity (All 15 Modules)

Every endpoint logs execution telemetry into `ai_activity` and reports exact provider (`groq` | `gemini` | `deterministic-engine`):
- `POST /api/ai/advice`
- `POST /api/pcde/advise`
- `POST /api/aerr/predict`
- `POST /api/ipre/suggest`
- `POST /api/gsd/detect`
- `POST /api/easdl/process`
- `POST /api/dnlrp/adjust`
- `POST /api/rsms/morph`
- `POST /api/vfap/register`
- `POST /api/vfap/verify`
- `POST /api/easas/assign`
- `POST /api/rrm/offer`
- `POST /api/rrm/take`
- `GET / POST /api/cdaec/status`
- `POST /api/chat`

---

## 5. Security Audit Checklist

- **Password Storage**: `bcryptjs` (cost 10) for all accounts; zero plaintext passwords.
- **Session Management**: Cryptographic 256-bit random session token hashed via SHA-256 in PostgreSQL `sessions` table, delivered via `HttpOnly`, `SameSite=Lax` cookie.
- **RBAC Enforcement**: Enforced server-side via `requireAuth()` and `requireRole()` on every protected route.
- **Privilege Escalation Prevention**: Admins cannot promote/modify Admin or SuperAdmin accounts; public registration always forces `customer` role.
- **Owner Isolation**: All Owner queries strictly filter by `parking_lots.owner_id = sessionUser.id`.
- **Concurrency Protection**: Slot reservation executes inside a PostgreSQL transaction with `SELECT ... FOR UPDATE` row locking and time-overlap validation to eliminate double-bookings.
- **QR Forgery Protection**: QR payloads are signed with HMAC-SHA256 (`PBXQR.<base64url>.<sig>`) and verified via `crypto.timingSafeEqual`.
- **Payment Integrity**: Server generates a verification challenge code; `/api/payments/verify` rejects mismatched codes or non-owner calls.
- **Rate Limiting & HTTP Headers**: Sliding-window rate limits on auth, OTP, and scanner routes + security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) in `next.config.ts`.
- **Secrets Hygiene**: All keys read from `process.env`; sanitized `.env.example` provided. Rotate any credentials from legacy `.env` files before production go-live.

---

## 6. Known Limitations & External Configuration Notes

1. **Email/SMS OTP Delivery**: When `SMTP_HOST` / `SMTP_USER` are not configured, `/api/auth/forgot-password` runs in local-sandbox mode and returns the generated OTP for verification testing. Configure SMTP credentials in production to suppress sandbox OTP responses.
2. **External Payment Gateway**: UPI initiation generates a standard `upi://pay` URI and requires server-side confirmation via `/api/payments/verify`. Plug in Razorpay/Cashfree webhook signature verification before accepting live consumer money.
3. **LLM Providers**: When `GROQ_API_KEY` or `GEMINI_API_KEY` are unset, AI endpoints transparently use the PostgreSQL-backed deterministic analytics engine and label `provider: "deterministic-engine"`.

---

## 7. Production Deployment Commands

```bash
# 1. Configure production environment variables (copy from .env.example)
cp .env.example .env

# 2. Push schema to PostgreSQL
npx drizzle-kit push

# 3. Optional: Migrate legacy SQLite data safely
SQLITE_SOURCE_PATH=./instance/parkbotix.db npx tsx scripts/migrate-sqlite-to-postgres.ts

# 4. Build & Start production server
npm run build
npm run start

# 5. Verify health endpoint
curl http://127.0.0.1:3000/api/health
```
