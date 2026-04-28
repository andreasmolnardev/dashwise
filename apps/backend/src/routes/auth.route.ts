import { Hono } from "hono";

import { changePassword, deleteAccount, loginUser, signupUser, updateUserProperty, validateAuthToken } from "@dashwise/sdk/data/auth";
import type { UserPropertyValue } from "@dashwise/sdk/data/auth";

import { loadSignupDefaults, readJsonBody, routeRedirectTarget, withJson } from "./shared";

const authRoute = new Hono();
  authRoute.get("/api/v1/auth/callback", (c) => c.redirect(routeRedirectTarget(c)));
  authRoute.get("/api/v1/auth/sso", (c) => c.redirect(routeRedirectTarget(c)));
  authRoute.post("/api/v1/auth/mfa", withJson(async (c) => {
    const body = await readJsonBody<{ email?: string; password?: string; totp?: string }>(c);
    return loginUser({
      email: typeof body.email === "string" ? body.email : "",
      password: typeof body.password === "string" ? body.password : "",
      totp: typeof body.totp === "string" ? body.totp : undefined,
    });
  }));
  authRoute.post("/api/v1/auth/login", withJson(async (c) => {
    const body = await readJsonBody<{ email?: string; password?: string; totp?: string }>(c);
    return loginUser({
      email: typeof body.email === "string" ? body.email : "",
      password: typeof body.password === "string" ? body.password : "",
      totp: typeof body.totp === "string" ? body.totp : undefined,
    });
  }));
  authRoute.post("/api/v1/auth/signup", withJson(async (c) => {
    const input = await readJsonBody<{
      _name?: string;
      email?: string;
      password?: string;
      passwordConfirm?: string;
      userConfig?: Record<string, unknown>;
    }>(c);
    const home = await loadSignupDefaults("home.json");
    const links = await loadSignupDefaults("links.json");
    const preferences = await loadSignupDefaults("preferences.json");

    return signupUser({
      _name: input._name,
      email: String(input.email ?? ""),
      password: String(input.password ?? ""),
      passwordConfirm: String(input.passwordConfirm ?? ""),
      userConfig: {
        preferences,
        homeConfig: home,
        linksConfig: links,
      },
    });
  }));
  authRoute.post("/api/v1/auth/change-password", withJson(async (c) => {
    const body = await readJsonBody<{ auth?: { token?: string | null }; body?: { email?: string; oldPassword?: string; newPassword?: string; confirmPassword?: string } }>(c);
    return changePassword(String(body?.auth?.token ?? ""), {
      email: body?.body?.email,
      oldPassword: String(body?.body?.oldPassword ?? ""),
      newPassword: String(body?.body?.newPassword ?? ""),
      confirmPassword: String(body?.body?.confirmPassword ?? ""),
    });
  }));
  authRoute.delete("/api/v1/auth/delete-account", withJson(async (c) => {
    const body = await readJsonBody<{ payload?: { email?: string; password?: string; totp?: string } }>(c);
    return deleteAccount({
      email: String(body?.payload?.email ?? ""),
      password: String(body?.payload?.password ?? ""),
      totp: typeof body?.payload?.totp === "string" ? body.payload.totp : undefined,
    });
  }));
  authRoute.post("/api/v1/auth/validate-auth", withJson(async (c) => {
    const body = await readJsonBody<{ token?: string; auth?: { token?: string | null } }>(c);
    return validateAuthToken(String(body?.token ?? body?.auth?.token ?? ""));
  }));
  authRoute.patch("/api/v1/auth/update-user-property", withJson(async (c) => {
    const body = await readJsonBody<{ auth?: { token?: string | null }; propertyName?: string; propertyValue?: UserPropertyValue }>(c);
      return updateUserProperty(body?.auth ?? {}, String(body?.propertyName ?? ""), body?.propertyValue ?? null);
    }));
export default authRoute;