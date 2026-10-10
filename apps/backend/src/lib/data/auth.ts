import type { RecordModel } from "pocketbase";
import { ClientResponseError, getServerPB, getSuperuserPB } from "../pb/pocketbase";
import { createSession, hashSessionToken } from "./sessions";
import { defaultHomeConfig } from "@dashwise/assets";
import type { UsersResponse } from "@dashwise/types";

import speakeasy from "speakeasy";
import { config } from "../config";

export class ApiActionError extends Error {
  status: number;
  body?: unknown;

  constructor(message: string, status = 500, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export type ActionAuth = {
  token?: string | null;
  sessionId?: string | null;
};

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type UserPropertyValue = JsonValue;

export type SearchEngineRecord = {
  icon?: string;
  name: string;
  slug: string;
  status: "default" | "enabled" | "disabled";
  url_home: string;
  url_params: string;
};

export type UserAppearancePreferences = {
  accentColor?: string;
  backgroundImageUrl?: string;
  clock?: {
    color?: string;
    defaultFont?: string;
    fontWeight?: number;
    frosted?: boolean;
    letterSpacing?: number;
    opacity?: number;
    outlineColor?: string;
    outlineEnabled?: boolean;
    outlineWidth?: number;
    roundness?: number;
  };
  frostedAppearance?: string;
  linkTileStyle?: "default" | "compact";
  themeMode?: string;
  wallpaperFilters?: {
    blur?: number;
    brightness?: number;
    darkModeBrightness?: number;
  };
  [key: string]: unknown;
};

export type UserLocalizationPreferences = {
  dateFormat?: string;
  language?: string;
  locale?: string;
  timeFormat?: string;
  weatherLocation?: string;
  weatherUnit?: string;
  [key: string]: unknown;
};

export type UserSearchPreferences = {
  linkOpenBehaviour?: string;
  searchEngineShortcutFallback?: string;
  searchEngines?: SearchEngineRecord[];
  [key: string]: unknown;
};

export type AuthUserRecord = Partial<
  Pick<
    UsersResponse<
      UserAppearancePreferences,
      UserLocalizationPreferences,
      Record<string, unknown>,
      UserSearchPreferences
    >,
    | "id"
    | "email"
    | "emailVisibility"
    | "name"
    | "appearancePreferences"
    | "localizationPreferences"
    | "screensaverPreferences"
    | "searchPreferences"
    | "verified"
    | "created"
    | "updated"
  >
> & {
  global?: {
    linkOpenBehaviour?: string;
  };
  totpSecret?: string;
  [key: string]: unknown;
};

export async function requireUserAuth(auth?: ActionAuth) {
  const token = auth?.token?.trim();
  if (!token?.startsWith("dws_") || token.length > 128) {
    throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
  }

  const admin = await getSuperuserPB();
  let session: RecordModel & {
    sessionId: string;
    user: string;
    tokenHash: string;
    pocketbaseToken?: string;
    expiresAt?: string;
    revokedAt?: string;
    lastSeenAt?: string;
  };
  try {
    session = await admin.collection("sessions").getFirstListItem(
      `tokenHash = "${hashSessionToken(token)}"`,
    );
  } catch {
    throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
  }

  const now = Date.now();
  const idleExpired = !session.lastSeenAt || Date.parse(session.lastSeenAt) + 30 * 24 * 60 * 60 * 1000 <= now;
  if (session.revokedAt || !session.expiresAt || Date.parse(session.expiresAt) <= now || idleExpired || !session.pocketbaseToken) {
    throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
  }

  const pb = getServerPB();
  pb.authStore.save(session.pocketbaseToken, null);
  try {
    const authModel = await pb.collection("users").authRefresh();
    const userId = authModel?.record?.id;
    if (!userId || userId !== session.user) {
      throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
    }
    await admin.collection("sessions").update(session.id, {
      lastSeenAt: new Date().toISOString(),
      pocketbaseToken: pb.authStore.token || session.pocketbaseToken,
    });
    return { pb, userId, authModel, sessionId: session.sessionId };
  } catch (error) {
    if (error instanceof ApiActionError) throw error;
    if (error instanceof ClientResponseError && error.status === 401) {
      throw new ApiActionError("Unauthorized", 401, { error: "Unauthorized" });
    }
    throw error;
  }
}

export async function loginUser(
  payload: { email: string; password: string; totp?: string },
) {
  const { email, password, totp } = payload;

  if (!email || !password) {
    throw new ApiActionError("Email and password are required", 400, {
      error: "Email and password are required",
    });
  }

  const pb = getServerPB();
  const authData = await pb.collection("users").authWithPassword(
    email,
    password,
  );
  const user = authData.record as AuthUserRecord & { id: string; totpSecret?: string };

  if (user.totpSecret) {
    if (!totp) {
      throw new ApiActionError(
        "TOTP code required because 2FA is enabled",
        401,
        {
          error: "TOTP code required because 2FA is enabled",
        },
      );
    }

    const verified = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: "base32",
      token: totp,
      window: 1,
    });

    if (!verified) {
      throw new ApiActionError("Invalid TOTP code", 401, {
        error: "Invalid TOTP code",
      });
    }
  }

  const { token, session } = await createSession(pb, user.id, { clientType: "browser" });
  const safeUser = { ...user };
  delete safeUser.totpSecret;
  return { token, sessionId: session.sessionId, user: safeUser };
}

export async function signupUser(payload: {
  _name?: string;
  email: string;
  password: string;
  passwordConfirm: string;
  userConfig?: {
    preferences?: {
      appearance?: Record<string, unknown>;
      localization?: Record<string, unknown>;
      search?: Record<string, unknown>;
    };
    homeConfig?: Record<string, unknown>;
    linksConfig?: Record<string, unknown>;
  };
}) {
  if (config.DISABLE_USER_SIGNUP) {
    throw new ApiActionError("Signup failed.", 401, {
      error: "Signup failed.",
    });
  }

  const { _name, email, password, passwordConfirm, userConfig } = payload;
  if (!email || !password || !passwordConfirm) {
    throw new ApiActionError("All fields are required", 400, {
      error: "All fields are required",
    });
  }

  if (password !== passwordConfirm) {
    throw new ApiActionError("Passwords do not match", 400, {
      error: "Passwords do not match",
    });
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
    localizationPreferences: userConfig?.preferences?.localization || {},
    appearancePreferences: userConfig?.preferences?.appearance || {},
    searchPreferences: userConfig?.preferences?.search || {},
  });

  await (await getSuperuserPB()).collection("pageConfig").create({
    associatedUserId: user.id,
    config: defaultHomeConfig,
    pageName: "home",
  });

  return { user };
}

export async function validateAuthToken(token: string) {
  const { authModel } = await requireUserAuth({ token });
  const user = { ...authModel.record };
  delete user.totpSecret;
  return { success: true, user };
}

export type ChangePasswordRequest = {
  email?: string;
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export async function changePassword(
  token: string,
  body: ChangePasswordRequest,
) {
  const { email: bodyEmail, oldPassword, newPassword, confirmPassword } =
    body || {};

  if (!oldPassword || !newPassword || !confirmPassword) {
    throw new ApiActionError("All fields are required", 400, {
      error: "All fields are required",
    });
  }
  if (newPassword !== confirmPassword) {
    throw new ApiActionError("New passwords do not match", 400, {
      error: "New passwords do not match",
    });
  }
  if (newPassword.length < 8) {
    throw new ApiActionError(
      "New password should be at least 8 characters",
      400,
      {
        error: "New password should be at least 8 characters",
      },
    );
  }

  const { pb, authModel } = await requireUserAuth({ token });

  const email = bodyEmail ?? authModel.record.email;
  if (!email) {
    throw new ApiActionError(
      "Email is required or you must be authenticated",
      401,
      {
        error: "Email is required or you must be authenticated",
      },
    );
  }

  const userId = authModel.record.id;
  await pb.collection("users").update(userId, {
    oldPassword,
    password: newPassword,
    passwordConfirm: confirmPassword,
  });

  return { message: "Password changed successfully. Please log in again." };
}

export async function deleteAccount(
  payload: { email: string; password: string; totp?: string },
) {
  const { email, password, totp } = payload;
  if (!email || !password) {
    throw new ApiActionError("Email and password are required", 400, {
      error: "Email and password are required",
    });
  }

  const pb = getServerPB();
  const authData = await pb.collection("users").authWithPassword(
    email,
    password,
  );
  const user = authData.record as AuthUserRecord & { id: string; totpSecret?: string };

  if (user.totpSecret) {
    if (!totp) {
      throw new ApiActionError(
        "TOTP code required because 2FA is enabled",
        401,
        {
          error: "TOTP code required because 2FA is enabled",
        },
      );
    }

    const verified = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: "base32",
      token: totp,
      window: 1,
    });

    if (!verified) {
      throw new ApiActionError("Invalid TOTP code", 401, {
        error: "Invalid TOTP code",
      });
    }
  }

  await pb.collection("users").delete(user.id);
  try {
    pb.authStore.clear();
  } catch {
  }

  return null;
}

export async function updateUserProperty(
  auth: ActionAuth,
  propertyName: string,
  propertyValue: UserPropertyValue
) {
  const { pb, userId } = await requireUserAuth(auth);

  const updatedUser = await pb.collection("users").update(userId, {
    [propertyName]: propertyValue,
  });

  if (propertyName === "newsPreferences") {
    void import("./news").then(({ rebuildNewsViews }) => rebuildNewsViews(userId)).catch(() => undefined);
  }

  return updatedUser;
}
