import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { api } from "@/lib/apiClient";

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
  return api.auth.changePasswordAction({ auth, body });
}

export async function loginUserAction(payload: { email: string; password: string; totp?: string }) {
  return api.auth.loginUserAction(payload);
}

export async function signupUserAction(payload: { _name?: string; email: string; password: string; passwordConfirm: string }) {
  return api.auth.signupUserAction(payload);
}

export async function validateAuthTokenAction(auth: ActionAuth) {
  return api.auth.validateAuthTokenAction(auth);
}

export async function deleteAccountAction(auth: ActionAuth, payload: { email: string; password: string; totp?: string }) {
  return api.auth.deleteAccountAction({ auth, payload });
}

export async function updateUserPropertyAction(auth: ActionAuth, propertyName: string, propertyValue: any) {
  return api.auth.updateUserPropertyAction({ auth, propertyName, propertyValue });
}
