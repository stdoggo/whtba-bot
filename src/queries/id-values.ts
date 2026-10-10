// Discord snowflakes stay strings in application code, bigint at the SQL boundary.
export const toDatabaseId = (value: string | bigint | number): bigint => {
	if (typeof value === 'number' && !Number.isSafeInteger(value)) {
		throw new RangeError('An unsafe numeric ID cannot be recovered; pass the original string.');
	}
	return BigInt(value);
};

export const databaseValue = (key: string, value: any): any => {
	// JSON columns must retain their original JSON-compatible values.
	if (key === 'settings' || key === 'content' || value == null) return value;
	if (key === 'id' || key.endsWith('Id')) return toDatabaseId(value);
	if (Array.isArray(value)) return value.map(item => databaseValue('', item));
	if (typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, databaseValue(k, v)]));
	}
	return value;
};
