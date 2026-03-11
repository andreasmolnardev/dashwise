"use server";

import {
	ActionAuth,
	changePassword,
	deleteAccount,
	loginUser,
	requireUserAuth,
	signupUser,
	updateUserProperty,
	validateAuthToken,
} from "@dashwise/sdk/data/auth";
import path from "path";
import { promises as fs } from "fs";

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


// TODO: TEst if this adds links
export async function signupUserAction(payload: {
	_name?: string;
	email: string;
	password: string;
	passwordConfirm: string;
}) {
	const home = await getDefault("home.json");
	const links = await getDefault("links.json");
	const preferences = await getDefault("preferences.json");

	return signupUser({
		...payload,
		userConfig: {
			preferences,
			homeConfig: home,
			linksConfig: links,
		},
	});
}

async function getDefault(filename: string) {
	const _path = path.join(process.cwd(), "public", "defaults", filename);
	const _file = await fs.readFile(_path, "utf-8");
	return JSON.parse(_file);
}

export async function validateAuthTokenAction(auth: ActionAuth) {
	await requireUserAuth(auth);
	return validateAuthToken(auth.token as string);
}

export async function deleteAccountAction(
	auth: ActionAuth,
	payload: { email: string; password: string; totp?: string },
) {
	await requireUserAuth(auth);
	return deleteAccount(payload);
}

export async function updateUserPropertyAction(
	auth: ActionAuth,
	propertyName: string,
	propertyValue: any,
) {
	return updateUserProperty(auth, propertyName, propertyValue);
}
