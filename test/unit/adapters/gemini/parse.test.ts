import { afterEach, describe, expect, it, vi } from "vitest";
import { makeGeminiParser } from "../../../../src/adapters/gemini/parse.js";

const env = {
	config: {
		botToken: "b",
		databaseUrl: "d",
		geminiApiKey: "k",
		geminiModel: "gemini-2.0-flash",
		cronSecret: "c",
		webhookUrl: "w",
		webhookSecret: "whs",
		maxChats: 5,
		repoIssuesUrl: "https://github.com/x/y/issues",
	},
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		log: vi.fn(),
	},
};

const geminiOk = (obj: unknown) => ({
	ok: true,
	json: async () => ({
		candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }],
	}),
});

afterEach(() => vi.unstubAllGlobals());

describe("[GEMINI parser]", () => {
	it("maps a confident parse and drops side/hour sentinels", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				geminiOk({
					type: "poop",
					action: "instant",
					side: "none",
					hour: -1,
					minute: 0,
					confidence: 0.9,
				}),
			),
		);
		const r = await makeGeminiParser(env).parse("credo abbia fatto");
		expect(r.success).toBe(true);
		if (r.success)
			expect(r.data).toEqual({
				type: "poop",
				action: "instant",
				confidence: 0.9,
			});
	});

	it("keeps side and time when present", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				geminiOk({
					type: "eat",
					action: "start",
					side: "dx",
					hour: 9,
					minute: 15,
					confidence: 0.8,
				}),
			),
		);
		const r = await makeGeminiParser(env).parse("poppata");
		if (r.success)
			expect(r.data).toEqual({
				type: "eat",
				action: "start",
				side: "dx",
				hour: 9,
				minute: 15,
				confidence: 0.8,
			});
	});

	it("maps a bottle with its ml amount", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				geminiOk({
					type: "bottle",
					action: "instant",
					side: "none",
					hour: -1,
					minute: 0,
					amount: 120,
					confidence: 0.9,
				}),
			),
		);
		const r = await makeGeminiParser(env).parse("gli ho dato 120 di aggiunta");
		expect(r.success).toBe(true);
		if (r.success)
			expect(r.data).toEqual({
				type: "bottle",
				action: "instant",
				amountMl: 120,
				confidence: 0.9,
			});
	});

	it("returns null for type 'other'", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					geminiOk({ type: "other", action: "instant", confidence: 0.1 }),
				),
		);
		const r = await makeGeminiParser(env).parse("ciao");
		if (r.success) expect(r.data).toBeNull();
	});

	it("posts the schema + api key and gives up (null, no retry) on a 4xx client error", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
		vi.stubGlobal("fetch", fetchMock);
		const r = await makeGeminiParser(env).parse("x");
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1); // 400 is not retryable
		const call = fetchMock.mock.calls[0];
		expect(call?.[0]).toContain("gemini-2.0-flash:generateContent");
		expect(call?.[1]?.headers["x-goog-api-key"]).toBe("k");
		const body = JSON.parse(call?.[1]?.body);
		expect(body.generationConfig.responseMimeType).toBe("application/json");
		expect(body.generationConfig.responseSchema.required).toContain("type");
	});

	it("retries on 429 (rate limit) and succeeds on a later attempt", async () => {
		const rateLimited = { ok: false, status: 429, json: async () => ({}) };
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(rateLimited)
			.mockResolvedValueOnce(rateLimited)
			.mockResolvedValueOnce(
				geminiOk({ type: "pee", action: "instant", confidence: 0.9 }),
			);
		vi.stubGlobal("fetch", fetchMock);
		const r = await makeGeminiParser(env, { delayMs: 0 }).parse("pisho");
		expect(r.success).toBe(true);
		if (r.success)
			expect(r.data).toEqual({
				type: "pee",
				action: "instant",
				confidence: 0.9,
			});
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("gives up with null after exhausting retries on repeated 5xx", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
		vi.stubGlobal("fetch", fetchMock);
		const r = await makeGeminiParser(env, { delayMs: 0 }).parse("x");
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(3); // 1 attempt + 2 retries
	});

	it("retries when fetch itself throws (network error)", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error("ECONNRESET"))
			.mockResolvedValueOnce(
				geminiOk({ type: "poop", action: "instant", confidence: 0.7 }),
			);
		vi.stubGlobal("fetch", fetchMock);
		const r = await makeGeminiParser(env, { delayMs: 0 }).parse("x");
		if (r.success)
			expect(r.data).toEqual({
				type: "poop",
				action: "instant",
				confidence: 0.7,
			});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
