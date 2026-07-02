import { describe, expect, it } from "vitest";
import { error, success, tryCatch } from "../../../src/domain/result.js";

describe("[RESULT]", () => {
	it("success wraps data", () => {
		const r = success(42);
		expect(r).toEqual({ success: true, data: 42 });
	});

	it("error wraps an error", () => {
		const e = new Error("boom");
		const r = error(e);
		expect(r).toEqual({ success: false, error: e });
	});

	it("tryCatch returns success for a resolving fn", async () => {
		const r = await tryCatch(
			async () => "ok",
			(e) => e,
		);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBe("ok");
	});

	it("tryCatch maps a thrown error", async () => {
		const r = await tryCatch(
			() => {
				throw new Error("nope");
			},
			(e) => e,
		);
		expect(r.success).toBe(false);
		if (!r.success) expect(r.error.message).toBe("nope");
	});
});
