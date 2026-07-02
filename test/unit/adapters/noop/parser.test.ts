import { describe, expect, it } from "vitest";
import { makeNoopParser } from "../../../../src/adapters/noop/parser.js";

describe("[NOOP parser]", () => {
	it("always returns success(null)", async () => {
		const r = await makeNoopParser().parse("qualcosa");
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBeNull();
	});
});
