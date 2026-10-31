import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import { magicLink } from "better-auth/plugins/magic-link";
import * as z from "zod";
import { sendAuthEmail } from "./email";
import { EMAIL_SIGN_IN } from "./email-config";
import { signInCodeEmail, signInLinkEmail } from "./email-templates";
import { emailTransport } from "./env";
import { isWorkspaceEmail, refusalMessage } from "./workspace";

const CODE_REQUEST_PATH = "/email-otp/send-verification-otp";

export const codeRequestBody = z.object({ email: z.string() });

export function assertMayReceiveEmail(email: string): void {
	if (isWorkspaceEmail(email)) return;
	throw new APIError("FORBIDDEN", { message: refusalMessage() });
}

export function isCodeRequestPath(path: string | undefined): boolean {
	return path === CODE_REQUEST_PATH;
}

export async function sendSignInCode({
	email,
	otp,
}: {
	email: string;
	otp: string;
}): Promise<void> {
	assertMayReceiveEmail(email);
	await sendAuthEmail({ to: email, ...signInCodeEmail({ code: otp }) });
}

export async function sendSignInLink({
	email,
	url,
}: {
	email: string;
	url: string;
}): Promise<void> {
	assertMayReceiveEmail(email);
	await sendAuthEmail({ to: email, ...signInLinkEmail({ url }) });
}

const emailSignInGuard = {
	id: "email-sign-in-guard",
	hooks: {
		before: [
			{
				matcher: (context) => isCodeRequestPath(context.path),
				handler: createAuthMiddleware(async (context) => {
					const request = codeRequestBody.safeParse(context.body);
					if (request.success) assertMayReceiveEmail(request.data.email);
				}),
			},
		],
	},
} satisfies BetterAuthPlugin;

export function emailSignInPlugins() {
	if (emailTransport().kind === "off") return [];

	return [
		magicLink({
			expiresIn: EMAIL_SIGN_IN.link.expiresInSeconds,
			storeToken: "hashed",
			sendMagicLink: sendSignInLink,
		}),
		emailOTP({
			otpLength: EMAIL_SIGN_IN.code.length,
			expiresIn: EMAIL_SIGN_IN.code.expiresInSeconds,
			allowedAttempts: EMAIL_SIGN_IN.code.allowedAttempts,
			storeOTP: "hashed",
			sendVerificationOTP: sendSignInCode,
		}),
		emailSignInGuard,
	];
}
