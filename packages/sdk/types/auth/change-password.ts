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
