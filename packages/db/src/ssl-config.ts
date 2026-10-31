import { rootCertificates } from "node:tls";

export interface DatabaseConnection {
	connectionString: string;
	ssl?: { ca: string[] };
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

// pg lets whatever the URL says win over the `ssl` option, so with an extra CA
// these have to come off the URL or the CA is never used. `sslmode=require` in
// particular is read by pg 8 as `verify-full` against Node's own roots only.
const URL_TLS_PARAMS = new Set([
	"sslmode",
	"ssl",
	"sslrootcert",
	"sslcert",
	"sslkey",
	"uselibpqcompat",
]);

function isLocalhostUrl(connectionString: string): boolean {
	try {
		const { hostname } = new URL(connectionString);
		return LOCAL_HOSTNAMES.has(hostname.replace(/^\[|\]$/g, ""));
	} catch {
		return false;
	}
}

// DATABASE_SSL_CA holds one extra root CA in PEM form, for a database whose
// chain does not end at a root Node already trusts (Supabase signs with its own).
// Literal "\n" sequences are accepted so the PEM fits on one env-var line.
function parseExtraCa(value: string | undefined): string | undefined {
	const pem = value?.replace(/\\n/g, "\n").trim();
	return pem?.includes("BEGIN CERTIFICATE") ? pem : undefined;
}

function paramName(pair: string): string {
	return (pair.split("=", 1)[0] ?? "").toLowerCase();
}

function withoutTlsParams(connectionString: string): string {
	const queryAt = connectionString.indexOf("?");
	if (queryAt === -1) return connectionString;

	const kept = connectionString
		.slice(queryAt + 1)
		.split("&")
		.filter((pair) => !URL_TLS_PARAMS.has(paramName(pair)));

	const base = connectionString.slice(0, queryAt);
	return kept.length > 0 ? `${base}?${kept.join("&")}` : base;
}

/**
 * Without DATABASE_SSL_CA the URL is used exactly as given. With it, the CA is
 * trusted alongside Node's own roots (never instead of them) and the chain and
 * the hostname are both still checked. A local database is left alone.
 */
export function resolveDatabaseConnection(
	connectionString: string,
	env: Partial<NodeJS.ProcessEnv> = process.env,
): DatabaseConnection {
	const extraCa = parseExtraCa(env.DATABASE_SSL_CA);

	if (!extraCa || isLocalhostUrl(connectionString)) {
		return { connectionString };
	}

	return {
		connectionString: withoutTlsParams(connectionString),
		ssl: { ca: [...rootCertificates, extraCa] },
	};
}
