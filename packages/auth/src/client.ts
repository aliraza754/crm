import { apiKeyClient } from "@better-auth/api-key/client";
import { ssoClient } from "@better-auth/sso/client";
import { emailOTPClient, magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: globalThis.window?.location.origin,
	plugins: [ssoClient(), apiKeyClient(), magicLinkClient(), emailOTPClient()],
});

export const { emailOtp, getSession, signIn, signOut, useSession } = authClient;

export type AuthClient = typeof authClient;
