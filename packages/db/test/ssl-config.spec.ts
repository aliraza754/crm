import { describe, expect, it } from "bun:test";
import { resolveDatabaseConnection } from "../src/ssl-config";

const extraCa =
	"-----BEGIN CERTIFICATE-----\nMIIBextra\n-----END CERTIFICATE-----";
const remote = "postgresql://u:p@db.example.com:5432/crm";

describe("resolveDatabaseConnection", () => {
	it("uses the URL exactly as given when DATABASE_SSL_CA is not set", () => {
		const url = `${remote}?sslmode=require&schema=public`;

		expect(resolveDatabaseConnection(url, {})).toEqual({
			connectionString: url,
		});
	});

	it("ignores a DATABASE_SSL_CA that is not a certificate", () => {
		expect(
			resolveDatabaseConnection(remote, { DATABASE_SSL_CA: "not a pem" }),
		).toEqual({ connectionString: remote });
	});

	it("leaves a local database alone even when a CA is set", () => {
		for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
			const url = `postgresql://u:p@${host}:5432/crm?sslmode=disable`;

			expect(
				resolveDatabaseConnection(url, { DATABASE_SSL_CA: extraCa }),
			).toEqual({ connectionString: url });
		}
	});

	it("adds the CA after Node's own roots rather than replacing them", () => {
		const { ssl } = resolveDatabaseConnection(remote, {
			DATABASE_SSL_CA: extraCa,
		});

		expect(ssl?.ca.at(-1)).toBe(extraCa);
		expect(ssl?.ca.length).toBeGreaterThan(1);
	});

	it("keeps the hostname check on", () => {
		const { ssl } = resolveDatabaseConnection(remote, {
			DATABASE_SSL_CA: extraCa,
		});

		expect(ssl).not.toHaveProperty("checkServerIdentity");
		expect(ssl).not.toHaveProperty("rejectUnauthorized");
	});

	it("accepts literal \\n sequences so the PEM fits on one line", () => {
		const { ssl } = resolveDatabaseConnection(remote, {
			DATABASE_SSL_CA: extraCa.replace(/\n/g, "\\n"),
		});

		expect(ssl?.ca.at(-1)).toBe(extraCa);
	});

	it("drops the TLS parameters that would override the CA and keeps the rest", () => {
		const { connectionString } = resolveDatabaseConnection(
			`${remote}?schema=public&sslmode=require&SSLROOTCERT=/tmp/x.pem&pgbouncer=true&uselibpqcompat=true`,
			{ DATABASE_SSL_CA: extraCa },
		);

		expect(connectionString).toBe(`${remote}?schema=public&pgbouncer=true`);
	});

	it("drops the whole query string when nothing else is left in it", () => {
		const { connectionString } = resolveDatabaseConnection(
			`${remote}?sslmode=require`,
			{ DATABASE_SSL_CA: extraCa },
		);

		expect(connectionString).toBe(remote);
	});

	it("leaves the user, password and host untouched", () => {
		const url =
			"postgresql://postgres.abc:p%40ss%2Fword@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require";
		const { connectionString } = resolveDatabaseConnection(url, {
			DATABASE_SSL_CA: extraCa,
		});

		expect(connectionString).toBe(url.replace("?sslmode=require", ""));
	});

	it("treats a malformed URL as remote so TLS is never silently skipped", () => {
		const { ssl } = resolveDatabaseConnection("not-a-url?sslmode=require", {
			DATABASE_SSL_CA: extraCa,
		});

		expect(ssl?.ca.at(-1)).toBe(extraCa);
	});
});
