import { afterEach, describe, expect, it, vi } from "vitest";
import { makeGeminiParser } from "../../../../src/adapters/gemini/parse";

const env = {
	config: {
		botToken: "b",
		allowedChatId: 1,
		databaseUrl: "d",
		geminiApiKey: "k",
		geminiModel: "gemini-2.0-flash",
		cronSecret: "c",
		webhookUrl: "w",
		webhookSecret: "whs",
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

	it("posts the schema + api key and returns null on HTTP error", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
		vi.stubGlobal("fetch", fetchMock);
		const r = await makeGeminiParser(env).parse("x");
		expect(r.success).toBe(true);
		if (r.success) expect(r.data).toBeNull();
		const call = fetchMock.mock.calls[0];
		expect(call?.[0]).toContain("gemini-2.0-flash:generateContent");
		expect(call?.[1]?.headers["x-goog-api-key"]).toBe("k");
		const body = JSON.parse(call?.[1]?.body);
		expect(body.generationConfig.responseMimeType).toBe("application/json");
		expect(body.generationConfig.responseSchema.required).toContain("type");
	});
});
