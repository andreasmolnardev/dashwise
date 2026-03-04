"use server";

import { ActionAuth, requireUserAuth } from "@/lib/api/data/auth";
import {
	loginUser,
	signupUser,
	validateAuthToken,
	changePassword,
	deleteAccount,
	type ChangePasswordRequest,
} from "@/lib/api/data/authRoutes";

export type { ChangePasswordRequest };

export type ChangePasswordSuccess = {
	message: string;
	token?: string | null;
};

export type ChangePasswordError = {
	error: string;
};

export async function changePasswordAction(auth: ActionAuth, body: ChangePasswordRequest) {
	await requireUserAuth(auth);
	return changePassword(auth.token as string, body);
}

export async function loginUserAction(payload: {
	email: string;
	password: string;
	totp?: string;
}) {
	return loginUser(payload);
}

export async function signupUserAction(payload: {
	_name?: string;
	email: string;
	password: string;
	passwordConfirm: string;
}) {
	return signupUser(payload);
}

export async function validateAuthTokenAction(auth: ActionAuth) {
	await requireUserAuth(auth);
	return validateAuthToken(auth.token as string);
}

export async function deleteAccountAction(
	auth: ActionAuth,
	payload: { email: string; password: string; totp?: string }
) {
	await requireUserAuth(auth);
	return deleteAccount(payload);
}

