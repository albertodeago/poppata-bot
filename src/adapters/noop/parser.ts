import type { ParserEnv } from "../../domain/parse.js";
import * as R from "../../domain/result.js";

/** Local fallback with no LLM: never contributes a parse. */
export const makeNoopParser = (): ParserEnv["parser"] => ({
	parse: async () => R.success(null),
});
