import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { APIError } from "better-auth/api";

process.env.API_URL = "https://crm.example.test";

const { sendAuthEmail } = await import("../src/email");
const {
	assertMayReceiveEmail,
	codeRequestBody,
	emailSignInPlugins,
	isCodeRequestPath,
	sendSignInCode,
	sendSignInLink,
} = await import("../src/email-sign-in");
const { signInCodeEmail, signInLinkEmail } = await import(
	"../src/email-templates"
);
const { emailTransport, isEmailSignInConfigured } = await import("../src/env");

const KEYS = [
	"RESEND_API_KEY",
	"RESEND_FROM",
	"API_URL",
	"BETTER_AUTH_URL",
	"ALLOWED_SIGN_IN",
] as const;

const FROM = "CRM <crm@comp.jetvantage.app>";

let saved: Record<string, string | undefined>;

beforeEach(() => {
	saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
	for (const key of KEYS) delete process.env[key];
	process.env.ALLOWED_SIGN_IN = "acme.com";
});

afterEach(() => {
	for (const key of KEYS) {
		const value = saved[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

function useResend() {
	process.env.RESEND_API_KEY = "re_test_key";
	process.env.RESEND_FROM = FROM;
	process.env.API_URL = "https://api.crm.example.com";
}

function stubFetch(status = 200) {
	return spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(JSON.stringify({ id: "email_1" }), { status }),
	);
}

describe("how sign-in email is delivered", () => {
	it("uses Resend when the key and the sender are both set", () => {
		useResend();

		expect(emailTransport()).toEqual({
			kind: "resend",
			apiKey: "re_test_key",
			from: FROM,
		});
		expect(isEmailSignInConfigured()).toBe(true);
	});

	it("prints to the log on a local API with no key", () => {
		expect(emailTransport()).toEqual({ kind: "log" });

		process.env.API_URL = "http://127.0.0.1:3001";
		expect(emailTransport()).toEqual({ kind: "log" });

		process.env.API_URL = "http://[::1]:3001";
		expect(emailTransport()).toEqual({ kind: "log" });
	});

	it("is off on a deployed API with no key", () => {
		process.env.API_URL = "https://api.crm.example.com";

		expect(emailTransport()).toEqual({ kind: "off" });
		expect(isEmailSignInConfigured()).toBe(false);
	});

	it("treats empty values as unset", () => {
		process.env.RESEND_API_KEY = "";
		process.env.RESEND_FROM = "";
		process.env.API_URL = "https://api.crm.example.com";

		expect(emailTransport()).toEqual({ kind: "off" });
	});

	it("refuses half a pair", () => {
		process.env.RESEND_API_KEY = "re_test_key";
		expect(() => emailTransport()).toThrow(
			"RESEND_API_KEY and RESEND_FROM must be set together.",
		);

		delete process.env.RESEND_API_KEY;
		process.env.RESEND_FROM = FROM;
		expect(() => emailTransport()).toThrow(
			"RESEND_API_KEY and RESEND_FROM must be set together.",
		);
	});
});

describe("sending one email", () => {
	const message = {
		to: "rep@acme.com",
		subject: "Hello",
		text: "plain body",
		html: "<p>html body</p>",
	};

	it("posts to Resend with the key in the header and never in the body", async () => {
		useResend();
		const fetchSpy = stubFetch();

		await sendAuthEmail(message);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, init] = fetchSpy.mock.calls[0] ?? [];
		expect(url).toBe("https://api.resend.com/emails");
		expect(init?.method).toBe("POST");
		expect(new Headers(init?.headers).get("authorization")).toBe(
			"Bearer re_test_key",
		);
		const body = String(init?.body);
		expect(JSON.parse(body)).toEqual({
			from: FROM,
			to: ["rep@acme.com"],
			subject: "Hello",
			text: "plain body",
			html: "<p>html body</p>",
		});
		expect(body).not.toContain("re_test_key");

		fetchSpy.mockRestore();
	});

	it("fails with a plain message and logs the status when Resend refuses", async () => {
		useResend();
		const fetchSpy = stubFetch(422);
		const errorSpy = spyOn(console, "error").mockImplementation(() => {});

		const failure = await sendAuthEmail(message).catch((error) => error);

		expect(failure).toBeInstanceOf(APIError);
		if (!(failure instanceof APIError)) throw failure;
		expect(failure.message).not.toContain("re_test_key");
		expect(errorSpy).toHaveBeenCalled();
		expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("re_test_key");

		fetchSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("prints the message instead of sending it in log mode", async () => {
		const fetchSpy = stubFetch();
		const infoSpy = spyOn(console, "info").mockImplementation(() => {});

		await sendAuthEmail(message);

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(JSON.stringify(infoSpy.mock.calls)).toContain("plain body");
		expect(JSON.stringify(infoSpy.mock.calls)).toContain("rep@acme.com");

		fetchSpy.mockRestore();
		infoSpy.mockRestore();
	});

	it("refuses to send when delivery is off", async () => {
		process.env.API_URL = "https://api.crm.example.com";
		const fetchSpy = stubFetch();

		await expect(sendAuthEmail(message)).rejects.toThrow();
		expect(fetchSpy).not.toHaveBeenCalled();

		fetchSpy.mockRestore();
	});
});

describe("the sign-in emails", () => {
	it("puts the code in the email, plain and HTML", () => {
		const email = signInCodeEmail({ code: "123456" });

		expect(email.text).toContain("123456");
		expect(email.html).toContain("123456");
		expect(email.subject.length).toBeGreaterThan(0);
	});

	it("puts the link in the email, and escapes it in HTML", () => {
		const url = "https://api.crm.example.com/verify?token=a&callbackURL=%2F";
		const email = signInLinkEmail({ url });

		expect(email.text).toContain(url);
		expect(email.html).toContain(
			"https://api.crm.example.com/verify?token=a&amp;callbackURL=%2F",
		);
		expect(email.html).not.toContain("token=a&callbackURL");
	});

	it("never lets a quote break out of the link attribute", () => {
		const email = signInLinkEmail({ url: 'https://x.test/"><script>' });

		expect(email.html).not.toContain("<script>");
	});
});

describe("who may be emailed a sign-in", () => {
	it("lets an allowed address through", () => {
		expect(() => assertMayReceiveEmail("rep@acme.com")).not.toThrow();
		expect(() => assertMayReceiveEmail("Rep@Mail.Acme.com")).not.toThrow();
	});

	it("refuses anyone else with the same words the sign-in guard uses", () => {
		const failure = (() => {
			try {
				assertMayReceiveEmail("stranger@other.com");
				return null;
			} catch (error) {
				return error;
			}
		})();

		expect(failure).toBeInstanceOf(APIError);
		expect((failure as APIError).status).toBe("FORBIDDEN");
		expect((failure as APIError).message).toContain("@acme.com");
	});

	it("refuses everyone when the allow-list is empty", () => {
		process.env.ALLOWED_SIGN_IN = "";

		expect(() => assertMayReceiveEmail("rep@acme.com")).toThrow();
	});

	it("sends the code only to an allowed address", async () => {
		useResend();
		const fetchSpy = stubFetch();

		await sendSignInCode({ email: "rep@acme.com", otp: "482913" });
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(String(fetchSpy.mock.calls[0]?.[1]?.body)).toContain("482913");

		await expect(
			sendSignInCode({ email: "stranger@other.com", otp: "482913" }),
		).rejects.toThrow();
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		fetchSpy.mockRestore();
	});

	it("sends the link only to an allowed address", async () => {
		useResend();
		const fetchSpy = stubFetch();
		const url =
			"https://api.crm.example.com/api/auth/magic-link/verify?token=t";

		await sendSignInLink({ email: "rep@acme.com", url });
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(String(fetchSpy.mock.calls[0]?.[1]?.body)).toContain("magic-link");

		await expect(
			sendSignInLink({ email: "stranger@other.com", url }),
		).rejects.toThrow();
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		fetchSpy.mockRestore();
	});
});

describe("the Better Auth plugins", () => {
	it("registers none when delivery is off", () => {
		process.env.API_URL = "https://api.crm.example.com";

		expect(emailSignInPlugins()).toEqual([]);
	});

	it("registers the link, the code and the guard when delivery is on", () => {
		useResend();

		expect(emailSignInPlugins().map((plugin) => plugin.id)).toEqual([
			"magic-link",
			"email-otp",
			"email-sign-in-guard",
		]);
	});
});

describe("refusing a stranger before the code is made", () => {
	it("guards the code request and nothing else", () => {
		expect(isCodeRequestPath("/email-otp/send-verification-otp")).toBe(true);
		expect(isCodeRequestPath("/sign-in/email-otp")).toBe(false);
		expect(isCodeRequestPath("/sign-in/magic-link")).toBe(false);
		expect(isCodeRequestPath(undefined)).toBe(false);
	});

	it("reads the address out of the request body", () => {
		const request = codeRequestBody.safeParse({
			email: "rep@acme.com",
			type: "sign-in",
		});

		expect(request.data?.email).toBe("rep@acme.com");
	});

	it("reads nothing out of a body that has no address", () => {
		for (const body of [{}, { email: 5 }, null, "rep@acme.com"]) {
			expect(codeRequestBody.safeParse(body).success).toBe(false);
		}
	});
});
