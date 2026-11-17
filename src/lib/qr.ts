import crypto from "crypto";
import QRCode from "qrcode";

function getSigningSecret(): string {
  return (
    process.env.QR_SIGNING_SECRET ||
    process.env.SESSION_SECRET ||
    "parkbotix-local-dev-qr-hmac-secret-change-in-production"
  );
}

export interface SignedQrPayload {
  v: number;
  code: string;
  lotId: number;
  slotId: number;
  uid: number;
  exp: number;
}

export function createSignedQr(params: {
  bookingCode: string;
  lotId: number;
  slotId: number;
  userId: number;
  endTime: Date;
}): { payloadString: string; signature: string; qrToken: string } {
  const payload: SignedQrPayload = {
    v: 1,
    code: params.bookingCode,
    lotId: params.lotId,
    slotId: params.slotId,
    uid: params.userId,
    exp: Math.floor(params.endTime.getTime() / 1000),
  };
  const payloadString = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", getSigningSecret())
    .update(payloadString)
    .digest("hex")
    .slice(0, 24);

  const encoded = Buffer.from(payloadString, "utf8").toString("base64url");
  const qrToken = `PBXQR.${encoded}.${signature}`;
  return { payloadString, signature, qrToken };
}

export function verifySignedQr(rawInput: string): {
  valid: boolean;
  bookingCode?: string;
  payload?: SignedQrPayload;
  reason?: string;
  isSignedToken: boolean;
} {
  const trimmed = rawInput.trim();

  // Support direct booking code entry fallback for manual scanner operations
  if (/^PBX-[A-Z0-9-]{6,24}$/i.test(trimmed)) {
    return {
      valid: true,
      bookingCode: trimmed.toUpperCase(),
      isSignedToken: false,
    };
  }

  if (!trimmed.startsWith("PBXQR.")) {
    return { valid: false, reason: "Unrecognized QR format", isSignedToken: false };
  }

  const parts = trimmed.split(".");
  if (parts.length !== 3) {
    return { valid: false, reason: "Malformed ParkBotix QR token", isSignedToken: true };
  }

  const [, encoded, providedSig] = parts;
  try {
    const payloadString = Buffer.from(encoded, "base64url").toString("utf8");
    const expectedSig = crypto
      .createHmac("sha256", getSigningSecret())
      .update(payloadString)
      .digest("hex")
      .slice(0, 24);

    const a = Buffer.from(providedSig, "utf8");
    const b = Buffer.from(expectedSig, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { valid: false, reason: "Invalid QR cryptographic signature (possible forgery)", isSignedToken: true };
    }

    const parsed = JSON.parse(payloadString) as SignedQrPayload;
    if (!parsed.code || !parsed.lotId || !parsed.slotId) {
      return { valid: false, reason: "Incomplete QR payload", isSignedToken: true };
    }

    return {
      valid: true,
      bookingCode: parsed.code,
      payload: parsed,
      isSignedToken: true,
    };
  } catch {
    return { valid: false, reason: "Corrupted QR payload encoding", isSignedToken: true };
  }
}

export async function generateQrDataUrl(qrToken: string): Promise<string> {
  return QRCode.toDataURL(qrToken, {
    width: 280,
    margin: 2,
    color: {
      dark: "#0F172A",
      light: "#FFFFFF",
    },
    errorCorrectionLevel: "M",
  });
}
