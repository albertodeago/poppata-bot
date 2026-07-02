export type Result<T, E = Error> =
	| { success: true; data: T }
	| { success: false; error: E };

export const error = <T = unknown, E = Error>(error: E): Result<T, E> => ({
	success: false,
	error,
});

export const success = <T, E = Error>(data: T): Result<T, E> => ({
	success: true,
	data,
});

export const tryCatch = async <T, E = Error>(
	fn: () => T | Promise<T>,
	onError: (e: Error) => E,
): Promise<Result<T, E>> => {
	try {
		const result = await fn();
		return success(result);
	} catch (e) {
		return error(onError(toError(e)));
	}
};

function isErrorWithMessage(error: unknown): error is Error {
	return (
		typeof error === "object" &&
		error instanceof Error &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	);
}

function toError(maybeError: unknown): Error {
	if (isErrorWithMessage(maybeError)) return maybeError;
	if (typeof maybeError === "string") return new Error(maybeError);
	return new Error(JSON.stringify(maybeError));
}
