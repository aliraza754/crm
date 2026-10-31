import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { migrationDatabaseUrl } from "../scripts/database-tls.mjs";

const pem = "-----BEGIN CERTIFICATE-----\nMIIBextra\n-----END CERTIFICATE-----";
const remote =
	"postgresql://postgres.abc:secret@pooler.example.com:5432/postgres";

function withFakeWriter() {
	const written: string[] = [];
	const writeCa = (value: string) => {
		written.push(value);
		return "/tmp/crm-database-ca-x/root.pem";
	};
	return { written, writeCa };
}

describe("migrationDatabaseUrl", () => {
	it("returns the URL untouched when DATABASE_SSL_CA is not set", () => {
		const url = `${remote}?sslmode=require`;

		expect(migrationDatabaseUrl(url, {})).toBe(url);
	});

	it("returns undefined when there is no URL", () => {
		expect(migrationDatabaseUrl(undefined, { DATABASE_SSL_CA: pem })).toBe(
			undefined,
		);
	});

	it("leaves a local database alone", () => {
		const url = "postgresql://u:p@localhost:5432/crm?schema=public";
		const { written, writeCa } = withFakeWriter();

		expect(migrationDatabaseUrl(url, { DATABASE_SSL_CA: pem }, writeCa)).toBe(
			url,
		);
		expect(written).toEqual([]);
	});

	it("asks Prisma to verify the chain against the written root", () => {
		const { written, writeCa } = withFakeWriter();

		const result = migrationDatabaseUrl(
			remote,
			{ DATABASE_SSL_CA: pem },
			writeCa,
		);

		expect(result).toBe(
			`${remote}?sslmode=require&sslaccept=strict&sslcert=/tmp/crm-database-ca-x/root.pem`,
		);
		expect(written).toEqual([pem]);
	});

	it("replaces TLS parameters already in the URL and keeps the rest", () => {
		const { writeCa } = withFakeWriter();

		const result = migrationDatabaseUrl(
			`${remote}?schema=public&sslmode=disable&sslaccept=accept_invalid_certs&pgbouncer=true`,
			{ DATABASE_SSL_CA: pem },
			writeCa,
		);

		expect(result).toBe(
			`${remote}?schema=public&pgbouncer=true&sslmode=require&sslaccept=strict&sslcert=/tmp/crm-database-ca-x/root.pem`,
		);
	});

	it("accepts literal \\n sequences and writes real line breaks", () => {
		const { written, writeCa } = withFakeWriter();

		migrationDatabaseUrl(
			remote,
			{ DATABASE_SSL_CA: pem.replace(/\n/g, "\\n") },
			writeCa,
		);

		expect(written).toEqual([pem]);
	});

	it("writes the root to a real file the URL points at", () => {
		const result = migrationDatabaseUrl(remote, { DATABASE_SSL_CA: pem });
		const path = result?.split("sslcert=")[1] ?? "";

		expect(path).toContain("crm-database-ca-");
		expect(readFileSync(path, "utf8").trim()).toBe(pem);
	});
});
