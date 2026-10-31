export function migrationDatabaseUrl(
	url: string | undefined,
	env?: Partial<NodeJS.ProcessEnv>,
	writeCa?: (pem: string) => string,
): string | undefined;
