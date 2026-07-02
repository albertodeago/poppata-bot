import type { ParserEnv } from "../../domain/parse";
import * as R from "../../domain/result";

/** Local fallback with no LLM: never contributes a parse. */
export const makeNoopParser = (): ParserEnv["parser"] => ({
	parse: async () => R.success(null),
});
