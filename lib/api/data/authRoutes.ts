import path from "path";
import { promises as fs } from "fs";
import speakeasy from "speakeasy";
import config from "@/lib/config";
import { getServerPB } from "@/lib/pb";
import { ApiActionError } from "@/lib/api/data/auth";

export async function loginUser(payload: { email: string; password: string; totp?: string }) {
  const { email, password, totp } = payload;

  if (!email || !password) {
    throw new ApiActionError("Email and password are required", 400, {
      error: "Email and password are required",
    });
  }

  const pb = getServerPB();
  const authData = await pb.collection("users").authWithPassword(email, password);
  const user = authData.record as any;

  if (user.totpSecret) {
    if (!totp) {
      throw new ApiActionError("TOTP code required because 2FA is enabled", 401, {
        error: "TOTP code required because 2FA is enabled",
      });
    }

    const verified = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: "base32",
      token: totp,
      window: 1,
    });

    if (!verified) {
      throw new ApiActionError("Invalid TOTP code", 401, { error: "Invalid TOTP code" });
    }
  }

  return { token: authData.token, user };
}

export async function signupUser(payload: {
  _name?: string;
  email: string;
  password: string;
  passwordConfirm: string;
}) {
  if (config.disableUserSignup) {
    throw new ApiActionError("Signup failed.", 401, { error: "Signup failed." });
  }

  const { _name, email, password, passwordConfirm } = payload;
  if (!email || !password || !passwordConfirm) {
    throw new ApiActionError("All fields are required", 400, { error: "All fields are required" });
  }

  if (password !== passwordConfirm) {
    throw new ApiActionError("Passwords do not match", 400, { error: "Passwords do not match" });
  }

  let name: string | undefined = _name;
  if ((!_name || _name === "") && typeof email === "string") {
    const localPart = email.split("@")[0];
    name = localPart
      .replace(/[._-]+/g, " ")
      .trim()
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  }

  const pb = getServerPB();
  const user = await pb.collection("users").create({
    name,
    email,
    password,
    passwordConfirm,
  });

  const configPath = path.join(process.cwd(), "public", "default-config.json");
  const configFile = await fs.readFile(configPath, "utf-8");
  const configJson = JSON.parse(configFile);

  await pb.collection("userConfig").create({
    associatedUserId: user.id,
    config: configJson,
  });

  return { user };
}

export async function validateAuthToken(token: string) {
  if (!token) {
    throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
  }

  const pb = getServerPB();
  pb.authStore.save(token, null);
  const authModel = await pb.collection("users").authRefresh();
  const userId = authModel?.record?.id ?? null;

  if (!userId) {
    throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
  }

  return { success: true };
}

export type ChangePasswordRequest = {
  email?: string;
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export async function changePassword(token: string, body: ChangePasswordRequest) {
  const { email: bodyEmail, oldPassword, newPassword, confirmPassword } = body || {};

  if (!oldPassword || !newPassword || !confirmPassword) {
    throw new ApiActionError("All fields are required", 400, { error: "All fields are required" });
  }
  if (newPassword !== confirmPassword) {
    throw new ApiActionError("New passwords do not match", 400, {
      error: "New passwords do not match",
    });
  }
  if (newPassword.length < 8) {
    throw new ApiActionError("New password should be at least 8 characters", 400, {
      error: "New password should be at least 8 characters",
    });
  }

  const pb = getServerPB();
  pb.authStore.save(token, null);

  const authModel = await pb.collection("users").authRefresh();
  if (!authModel?.record) {
    throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
  }

  const email = bodyEmail ?? authModel.record.email;
  if (!email) {
    throw new ApiActionError("Email is required or you must be authenticated", 401, {
      error: "Email is required or you must be authenticated",
    });
  }

  const userId = authModel.record.id;
  await pb.collection("users").update(userId, {
    oldPassword,
    password: newPassword,
    passwordConfirm: confirmPassword,
  });

  try {
    await pb.collection("users").authWithPassword(email, newPassword);
  } catch {
    return { message: "Password changed - Please log in again." };
  }

  return {
    message: "Password changed successfully",
    token: pb.authStore.token ?? null,
  };
}

export async function deleteAccount(payload: { email: string; password: string; totp?: string }) {
  const { email, password, totp } = payload;
  if (!email || !password) {
    throw new ApiActionError("Email and password are required", 400, {
      error: "Email and password are required",
    });
  }

  const pb = getServerPB();
  const authData = await pb.collection("users").authWithPassword(email, password);
  const user = authData.record as any;

  if (user.totpSecret) {
    if (!totp) {
      throw new ApiActionError("TOTP code required because 2FA is enabled", 401, {
        error: "TOTP code required because 2FA is enabled",
      });
    }

    const verified = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: "base32",
      token: totp,
      window: 1,
    });

    if (!verified) {
      throw new ApiActionError("Invalid TOTP code", 401, { error: "Invalid TOTP code" });
    }
  }

  await pb.collection("users").delete(user.id);
  try {
    pb.authStore.clear();
  } catch {
  }

  return null;
}
