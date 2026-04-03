import type { Hono } from "hono";

import { changePassword, deleteAccount, loginUser, signupUser, updateUserProperty, validateAuthToken } from "@dashwise/sdk/data/auth";

import { loadSignupDefaults, readJsonBody, routeRedirectTarget, withJson } from "./shared";

export function registerAuthControllers(app: Hono) {
  app.get("/api/v1/auth/callback", (c) => c.redirect(routeRedirectTarget(c)));
  app.get("/api/v1/auth/sso", (c) => c.redirect(routeRedirectTarget(c)));
  app.post("/api/v1/auth/mfa", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    return loginUser({
      email: typeof body.email === "string" ? body.email : "",
      password: typeof body.password === "string" ? body.password : "",
      totp: typeof body.totp === "string" ? body.totp : undefined,
    });
  }));
  app.post("/api/v1/auth/login", withJson(async (c) => loginUser(await readJsonBody(c))));
  app.post("/api/v1/auth/signup", withJson(async (c) => {
    const input = await readJsonBody<any>(c);
    const home = await loadSignupDefaults("home.json");
    const links = await loadSignupDefaults("links.json");
    const preferences = await loadSignupDefaults("preferences.json");

    return signupUser({
      ...input,
      userConfig: {
        preferences,
        homeConfig: home,
        linksConfig: links,
      },
    });
  }));
  app.post("/api/v1/auth/change-password", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    return changePassword(String(body?.auth?.token ?? ""), body?.body ?? {});
  }));
  app.delete("/api/v1/auth/delete-account", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    return deleteAccount(body?.payload ?? {});
  }));
  app.post("/api/v1/auth/validate-auth", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    return validateAuthToken(String(body?.token ?? body?.auth?.token ?? ""));
  }));
  app.patch("/api/v1/auth/update-user-property", withJson(async (c) => {
    const body = await readJsonBody<any>(c);
    return updateUserProperty(body?.auth, String(body?.propertyName ?? ""), body?.propertyValue);
  }));
}