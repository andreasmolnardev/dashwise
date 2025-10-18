import { getServerPB } from "@/lib/pb";
import { NextResponse } from "next/server";

export async function POST(request: Request): Promise<NextResponse<ChangePasswordResponse>> {
  try {
    const body = (await request.json().catch(() => ({}))) as ChangePasswordRequest;
    const { email: bodyEmail, oldPassword, newPassword, confirmPassword } = body || {};

    // basic validation
    if (!oldPassword || !newPassword || !confirmPassword) {
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    }
    if (newPassword !== confirmPassword) {
      return NextResponse.json({ error: "New passwords do not match" }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "New password should be at least 8 characters" }, { status: 400 });
    }

    // require bearer token
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.split(" ")[1];

    const pb = getServerPB();

    // restore session from token
    pb.authStore.save(token, null);

    // refresh to confirm token is valid and get user record
    const authModel = await pb.collection("users").authRefresh();
    if (!authModel?.record) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // default to session email if none provided
    const email = bodyEmail ?? authModel.record.email;
    if (!email) {
      return NextResponse.json({ error: "Email is required or you must be authenticated" }, { status: 401 });
    }

    const userId = authModel.record.id;

    // update password in db
    try {
      await pb.collection("users").update(userId, {
        oldPassword,
        password: newPassword,
        passwordConfirm: confirmPassword,
      });
    } catch (updateErr: unknown) {
      console.error("PocketBase update error:", updateErr);
      const errorMsg =
        updateErr instanceof Error ? updateErr.message : "Failed to update password";
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    // re-authenticate and return new token
    try {
      await pb.collection("users").authWithPassword(email, newPassword);
    } catch (reauthErr: unknown) {
      console.error("Re-auth after password change failed:", reauthErr);
      return NextResponse.json(
        { message: "Password changed - Please log in again." },
        { status: 200 }
      );
    }

    const newToken = pb.authStore.token ?? null;

    return NextResponse.json(
      { message: "Password changed successfully", token: newToken },
      { status: 200 }
    );

  } catch (err: unknown) {
    console.error("Change password error:", err);
    const errorMsg = err instanceof Error ? err.message : "Failed to change password";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export interface ChangePasswordRequest {
  email?: string;
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ChangePasswordSuccess {
  message: string;
  token?: string | null;
}

export interface ChangePasswordError {
  error: string;
}

export type ChangePasswordResponse = ChangePasswordSuccess | ChangePasswordError;
