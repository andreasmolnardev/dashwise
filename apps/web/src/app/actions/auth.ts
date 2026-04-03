import type { ActionAuth } from "@dashwise/sdk/data/auth";
import { callAction } from "@/src/lib/action-client";

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

export async function changePasswordAction(
	auth: ActionAuth,
	body: ChangePasswordRequest,
) {
	return callAction("auth", "changePasswordAction", [auth, body]);
}

export async function loginUserAction(payload: {
	email: string;
	password: string;
	totp?: string;
}) {
	return callAction("auth", "loginUserAction", [payload]);
}


export async function signupUserAction(payload: {
	_name?: string;
	email: string;
	password: string;
	passwordConfirm: string;
}) {
	return callAction("auth", "signupUserAction", [payload]);
}

export async function validateAuthTokenAction(auth: ActionAuth) {
	return callAction("auth", "validateAuthTokenAction", [auth]);
}

export async function deleteAccountAction(
	auth: ActionAuth,
	payload: { email: string; password: string; totp?: string },
) {
	return callAction("auth", "deleteAccountAction", [auth, payload]);
}

export async function updateUserPropertyAction(
	auth: ActionAuth,
	propertyName: string,
	propertyValue: any,
) {
	return callAction("auth", "updateUserPropertyAction", [auth, propertyName, propertyValue]);
}
