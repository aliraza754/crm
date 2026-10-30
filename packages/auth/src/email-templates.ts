import type { AuthEmail } from "./email";
import { EMAIL_SIGN_IN } from "./email-config";

type EmailContent = Pick<AuthEmail, "subject" | "text" | "html">;

const HTML_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

const IGNORE_NOTE =
	"If you did not ask for this, ignore this email. Nobody can sign in without it.";

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

function minutes(seconds: number): number {
	return Math.round(seconds / 60);
}

function page(body: string): string {
	return `<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#171717">${body}<p style="margin-top:24px;font-size:13px;color:#737373">${IGNORE_NOTE}</p></body></html>`;
}

export function signInCodeEmail({ code }: { code: string }): EmailContent {
	const lifetime = minutes(EMAIL_SIGN_IN.code.expiresInSeconds);

	return {
		subject: "Your CRM sign-in code",
		text: `Your CRM sign-in code is ${code}.\n\nIt works once, for ${lifetime} minutes.\n\n${IGNORE_NOTE}`,
		html: page(
			`<p>Your CRM sign-in code is:</p><p style="font-size:28px;font-weight:600;letter-spacing:6px">${escapeHtml(code)}</p><p>It works once, for ${lifetime} minutes.</p>`,
		),
	};
}

export function signInLinkEmail({ url }: { url: string }): EmailContent {
	const lifetime = minutes(EMAIL_SIGN_IN.link.expiresInSeconds);
	const safeUrl = escapeHtml(url);

	return {
		subject: "Sign in to the CRM",
		text: `Open this link to sign in to the CRM:\n\n${url}\n\nIt works once, for ${lifetime} minutes.\n\n${IGNORE_NOTE}`,
		html: page(
			`<p>Use this button to sign in to the CRM.</p><p><a href="${safeUrl}" style="display:inline-block;padding:10px 16px;border-radius:5px;background:#006b4f;color:#ffffff;text-decoration:none">Sign in</a></p><p>The link works once, for ${lifetime} minutes. If the button does not work, paste this link into your browser:<br>${safeUrl}</p>`,
		),
	};
}
