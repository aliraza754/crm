const MINUTE_SECONDS = 60;

export const EMAIL_SIGN_IN = {
	code: {
		length: 6,
		expiresInSeconds: 10 * MINUTE_SECONDS,
		allowedAttempts: 3,
	},
	link: {
		expiresInSeconds: 10 * MINUTE_SECONDS,
	},
	send: {
		endpoint: "https://api.resend.com/emails",
		timeoutMs: 10_000,
	},
} as const;
