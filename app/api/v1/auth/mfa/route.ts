import { getServerPB } from "@/lib/pb";
import { NextResponse } from "next/server";
import speakeasy from "speakeasy";
import qrcode from "qrcode";

export async function POST(request: Request) {
  try {
    // Require Bearer token
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.split(" ")[1];

    const pb = getServerPB();

    // Restore session from token
    pb.authStore.save(token, null);

    // Refresh to confirm token is valid and get user record
    const authModel = await pb.collection("users").authRefresh();
    if (!authModel || !authModel.record) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = authModel.record.id;
    const email = authModel.record.email;

    // Generate TOTP secret
    const secret = speakeasy.generateSecret({
      name: `dashwise (${email})`,
    });

    // Save TOTP secret in user record
    await pb.collection("users").update(userId, { totpSecret: secret.base32 });

    // Generate QR code URL for authenticator app
    const otpauthUrl = secret.otpauth_url;
    if (!otpauthUrl) {
      return NextResponse.json({ error: "Failed to generate OTP Auth URL" }, { status: 500 });
    }
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

    return NextResponse.json(
      {
        message: "2FA setup initialized",
        qrCodeDataUrl,
        secret: secret.base32, 
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("2FA setup error:", err);
    return NextResponse.json({ error: "Failed to set up 2FA" }, { status: 500 });
  }
}
