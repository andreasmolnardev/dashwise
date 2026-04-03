import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { trpc } from "@/lib/apiClient";
const api = trpc as any;

export type ChangePasswordRequest = {
  email?: string;
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export type ChangePasswordSuccess = {
  message: string;
  token?: string | null;
};

export type ChangePasswordError = {
  error: string;
};

export async function changePasswordAction(auth: ActionAuth, body: ChangePasswordRequest) {
  return api.auth.changePasswordAction.mutate({ auth, body });
}

export async function loginUserAction(payload: { email: string; password: string; totp?: string }) {
  return api.auth.loginUserAction.mutate(payload);
}

export async function signupUserAction(payload: { _name?: string; email: string; password: string; passwordConfirm: string }) {
  return api.auth.signupUserAction.mutate(payload);
}

export async function validateAuthTokenAction(auth: ActionAuth) {
  return api.auth.validateAuthTokenAction.mutate(auth);
}

export async function deleteAccountAction(auth: ActionAuth, payload: { email: string; password: string; totp?: string }) {
  return api.auth.deleteAccountAction.mutate({ auth, payload });
}

export async function updateUserPropertyAction(auth: ActionAuth, propertyName: string, propertyValue: any) {
  return api.auth.updateUserPropertyAction.mutate({ auth, propertyName, propertyValue });
}
