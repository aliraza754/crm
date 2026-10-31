import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// This is plain JavaScript because build-func.mjs runs before anything is built
// and cannot import the TypeScript in @crm/db. It mirrors packages/db/src/ssl-config.ts.

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

const URL_TLS_PARAMS = new Set([
	"sslmode",
	"ssl",
	"sslaccept",
	"sslrootcert",
	"sslcert",
	"sslkey",
	"uselibpqcompat",
]);

function isLocalhostUrl(url) {
	try {
		return LOCAL_HOSTNAMES.has(new URL(url).hostname.replace(/^\[|\]$/g, ""));
	} catch {
		return false;
	}
}

function parseExtraCa(value) {
	const pem = value?.replace(/\\n/g, "\n").trim();
	return pem?.includes("BEGIN CERTIFICATE") ? pem : undefined;
}

function paramName(pair) {
	return (pair.split("=", 1)[0] ?? "").toLowerCase();
}

function withoutTlsParams(url) {
	const queryAt = url.indexOf("?");
	if (queryAt === -1) return url;

	const kept = url
		.slice(queryAt + 1)
		.split("&")
		.filter((pair) => !URL_TLS_PARAMS.has(paramName(pair)));

	const base = url.slice(0, queryAt);
	return kept.length > 0 ? `${base}?${kept.join("&")}` : base;
}

function writeCaFile(pem) {
	const file = join(
		mkdtempSync(join(tmpdir(), "crm-database-ca-")),
		"root.pem",
	);
	writeFileSync(file, `${pem}\n`);
	return file;
}

/**
 * `prisma migrate deploy` is Prisma's own client, not pg, so DATABASE_SSL_CA
 * means nothing to it. Without help it still encrypts but does not check the
 * certificate chain. With DATABASE_SSL_CA set this writes that root to a file and
 * asks Prisma to verify against it, so the migration connection is held to the same
 * standard as the running API. Any other TLS parameter in the URL is replaced.
 */
export function migrationDatabaseUrl(
	url,
	env = process.env,
	writeCa = writeCaFile,
) {
	const pem = parseExtraCa(env.DATABASE_SSL_CA);
	if (!url || !pem || isLocalhostUrl(url)) return url;

	const stripped = withoutTlsParams(url);
	const joiner = stripped.includes("?") ? "&" : "?";
	const certPath = writeCa(pem).split("\\").join("/");

	return `${stripped}${joiner}sslmode=require&sslaccept=strict&sslcert=${certPath}`;
}
