import { EMAIL_SIGN_IN } from "@crm/auth/email-config";

export const CODE_LENGTH = EMAIL_SIGN_IN.code.length;
export const CODE_MINUTES = Math.round(
	EMAIL_SIGN_IN.code.expiresInSeconds / 60,
);
export const LINK_MINUTES = Math.round(
	EMAIL_SIGN_IN.link.expiresInSeconds / 60,
);

export function cleanCode(value: string): string {
	return value.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

export function isCompleteCode(value: string): boolean {
	return value.length === CODE_LENGTH;
}
