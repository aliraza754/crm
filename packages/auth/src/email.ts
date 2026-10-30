import { APIError } from "better-auth/api";
import { EMAIL_SIGN_IN } from "./email-config";
import { emailTransport } from "./env";

export type AuthEmail = {
	to: string;
	subject: string;
	text: string;
	html: string;
};

const sendFailure = (): APIError =>
	new APIError("INTERNAL_SERVER_ERROR", {
		message: "Could not send the sign-in email. Try again in a minute.",
	});

export async function sendAuthEmail(message: AuthEmail): Promise<void> {
	const transport = emailTransport();

	if (transport.kind === "off") {
		throw new Error("Email sign-in is not configured.");
	}

	if (transport.kind === "log") {
		console.info(
			`[auth] sign-in email to ${message.to}\n${message.subject}\n\n${message.text}`,
		);
		return;
	}

	let response: Response;
	try {
		response = await fetch(EMAIL_SIGN_IN.send.endpoint, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${transport.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from: transport.from,
				to: [message.to],
				subject: message.subject,
				text: message.text,
				html: message.html,
			}),
			signal: AbortSignal.timeout(EMAIL_SIGN_IN.send.timeoutMs),
		});
	} catch (error) {
		console.error("[auth] could not reach Resend", error);
		throw sendFailure();
	}

	if (response.ok) return;

	console.error("[auth] Resend refused the sign-in email", response.status);
	throw sendFailure();
}
