import { describe, expect, it } from "vitest";
import type { ChatConfig } from "../../../src/domain/chatConfig.js";
import {
	languageCommand,
	nomeCommand,
	registerChat,
	reportCommand,
} from "../../../src/domain/registration.js";
import { success } from "../../../src/domain/result.js";
import { makeTestEnv } from "../testEnv.js";

const base = {
	userName: "papà",
	adminChatId: 999,
	guideUrl: "https://ex.com/guida.html",
};

const lastMessage = (
	mocks: ReturnType<typeof makeTestEnv>["mocks"],
): string => {
	const calls = mocks.bot.sendMessage.mock.calls;
	return (calls[calls.length - 1]?.[1] as string) ?? "";
};

const chatConfig = (over: Partial<ChatConfig> = {}): ChatConfig => ({
	chatId: 1,
	language: "it",
	reportsEnabled: true,
	status: "approved",
	...over,
});

describe("[REGISTRATION] registerChat", () => {
	it("creates a pending request, notifies the admin, and tells the requester", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(success(null));
		mocks.chatConfigRepository.create.mockResolvedValue(
			success(chatConfig({ status: "pending" })),
		);
		await registerChat({ chatId: 1, chatTitle: "Fam", ...base })(env);
		expect(mocks.chatConfigRepository.create).toHaveBeenCalledWith({
			chatId: 1,
			createdByName: "papà",
			language: "it",
		});
		const call = mocks.bot.sendAccessRequest.mock.calls[0];
		expect(call?.[0]).toBe(999); // admin chat
		expect(call?.[2]).toBe(1); // target chat id
		expect(call?.[1]).toContain("Fam");
		expect(lastMessage(mocks).toLowerCase()).toContain("richiesta");
	});

	it("passes the requester @username to create and shows it to the admin", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(success(null));
		mocks.chatConfigRepository.create.mockResolvedValue(
			success(chatConfig({ status: "pending" })),
		);
		await registerChat({ chatId: 1, username: "tizio", ...base })(env);
		expect(mocks.chatConfigRepository.create).toHaveBeenCalledWith({
			chatId: 1,
			createdByName: "papà",
			language: "it",
			username: "tizio",
		});
		expect(mocks.bot.sendAccessRequest.mock.calls[0]?.[1]).toContain("@tizio");
	});

	it("re-notifies the admin when an already-pending chat retries /start (self-heal)", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success(chatConfig({ status: "pending" })),
		);
		await registerChat({ chatId: 1, ...base })(env);
		expect(mocks.chatConfigRepository.create).not.toHaveBeenCalled();
		expect(mocks.bot.sendAccessRequest).toHaveBeenCalled();
		expect(lastMessage(mocks).toLowerCase()).toContain("attesa");
	});

	it("still confirms to the requester even if the admin notify fails", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(success(null));
		mocks.chatConfigRepository.create.mockResolvedValue(
			success(chatConfig({ status: "pending" })),
		);
		mocks.bot.sendAccessRequest.mockRejectedValue(
			new Error("admin unreachable"),
		);
		await registerChat({ chatId: 1, ...base })(env);
		expect(lastMessage(mocks).toLowerCase()).toContain("richiesta");
	});

	it("silently ignores a banned chat", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success(chatConfig({ status: "banned" })),
		);
		await registerChat({ chatId: 1, ...base })(env);
		expect(mocks.chatConfigRepository.create).not.toHaveBeenCalled();
		expect(mocks.bot.sendAccessRequest).not.toHaveBeenCalled();
		expect(mocks.bot.sendMessage).not.toHaveBeenCalled();
	});

	it("re-welcomes an already-approved chat", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success(
				chatConfig({
					babyName: "Leo",
				}),
			),
		);
		await registerChat({ chatId: 1, ...base })(env);
		expect(mocks.chatConfigRepository.create).not.toHaveBeenCalled();
		expect(lastMessage(mocks)).toContain("Leo");
	});

	it("links English approved chats to the English guide", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success(chatConfig({ language: "en", babyName: "Leo" })),
		);
		await registerChat({ chatId: 1, ...base })(env);
		expect(lastMessage(mocks)).toContain('href="https://ex.com/guide.html"');
	});

	it("updates the name when /start carries one on an approved chat", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success(
				chatConfig({
					babyName: "Leo",
				}),
			),
		);
		mocks.chatConfigRepository.setBabyName.mockResolvedValue(
			success(
				chatConfig({
					babyName: "Gigi",
				}),
			),
		);
		await registerChat({ chatId: 1, name: "Gigi", ...base })(env);
		expect(mocks.chatConfigRepository.setBabyName).toHaveBeenCalledWith(
			1,
			"Gigi",
		);
		expect(lastMessage(mocks).toLowerCase()).toContain("aggiornato");
	});

	it("uses the requester Telegram language for the first chat default", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(success(null));
		mocks.chatConfigRepository.create.mockResolvedValue(
			success(chatConfig({ language: "en", status: "pending" })),
		);
		await registerChat({ chatId: 1, languageCode: "en-US", ...base })(env);
		expect(mocks.chatConfigRepository.create).toHaveBeenCalledWith({
			chatId: 1,
			createdByName: "papà",
			language: "en",
		});
		expect(lastMessage(mocks).toLowerCase()).toContain("access request");
	});
});

describe("[REGISTRATION] languageCommand", () => {
	it("shows the current language for bare /language", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success(chatConfig({ language: "en" })),
		);
		await languageCommand(1, "")(env);
		expect(lastMessage(mocks)).toContain("Current language: English");
	});

	it("sets the chat language", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success(chatConfig({ language: "it" })),
		);
		mocks.chatConfigRepository.setLanguage.mockResolvedValue(
			success(chatConfig({ language: "en" })),
		);
		await languageCommand(1, "en")(env);
		expect(mocks.chatConfigRepository.setLanguage).toHaveBeenCalledWith(
			1,
			"en",
		);
		expect(lastMessage(mocks)).toContain("Language set to English");
	});

	it("rejects unsupported language arguments", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success(chatConfig({ language: "it" })),
		);
		await languageCommand(1, "fr")(env);
		expect(mocks.chatConfigRepository.setLanguage).not.toHaveBeenCalled();
		expect(lastMessage(mocks)).toContain("/lingua it");
	});
});

describe("[REGISTRATION] nomeCommand", () => {
	it("sets a name (impostato) when none was set", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(success(chatConfig()));
		mocks.chatConfigRepository.setBabyName.mockResolvedValue(
			success(
				chatConfig({
					babyName: "Mario",
				}),
			),
		);
		await nomeCommand(1, "Mario")(env);
		expect(mocks.chatConfigRepository.setBabyName).toHaveBeenCalledWith(
			1,
			"Mario",
		);
		expect(lastMessage(mocks).toLowerCase()).toContain("impostato");
	});

	it("reports aggiornato when replacing an existing name", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success(
				chatConfig({
					babyName: "Leo",
				}),
			),
		);
		mocks.chatConfigRepository.setBabyName.mockResolvedValue(
			success(
				chatConfig({
					babyName: "Gigi",
				}),
			),
		);
		await nomeCommand(1, "Gigi")(env);
		expect(lastMessage(mocks).toLowerCase()).toContain("aggiornato");
	});

	it("shows the current name for bare /nome", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success(
				chatConfig({
					babyName: "Leo",
				}),
			),
		);
		await nomeCommand(1, "")(env);
		expect(mocks.chatConfigRepository.setBabyName).not.toHaveBeenCalled();
		expect(lastMessage(mocks)).toContain("Leo");
	});

	it("shows a usage hint for bare /nome when no name is set", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(success(chatConfig()));
		await nomeCommand(1, "")(env);
		expect(lastMessage(mocks).toLowerCase()).toContain("/nome");
	});
});

describe("[REGISTRATION] reportCommand", () => {
	it("bare /report shows the enabled state", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(success(chatConfig()));
		await reportCommand(1, "")(env);
		expect(mocks.chatConfigRepository.setReportsEnabled).not.toHaveBeenCalled();
		expect(lastMessage(mocks).toLowerCase()).toContain("attivi");
	});

	it("bare /report shows the disabled state", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success(chatConfig({ reportsEnabled: false })),
		);
		await reportCommand(1, "")(env);
		expect(lastMessage(mocks).toLowerCase()).toContain("disattivati");
	});

	it("/report off disables the reports", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(success(chatConfig()));
		mocks.chatConfigRepository.setReportsEnabled.mockResolvedValue(
			success(chatConfig({ reportsEnabled: false })),
		);
		await reportCommand(1, "off")(env);
		expect(mocks.chatConfigRepository.setReportsEnabled).toHaveBeenCalledWith(
			1,
			false,
		);
		expect(lastMessage(mocks).toLowerCase()).toContain("disattivati");
	});

	it("/report on enables the reports", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success(chatConfig({ reportsEnabled: false })),
		);
		mocks.chatConfigRepository.setReportsEnabled.mockResolvedValue(
			success(chatConfig()),
		);
		await reportCommand(1, "on")(env);
		expect(mocks.chatConfigRepository.setReportsEnabled).toHaveBeenCalledWith(
			1,
			true,
		);
		expect(lastMessage(mocks).toLowerCase()).toContain("riattivati");
	});

	it("/report with a bad arg shows a usage hint and changes nothing", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success(chatConfig({ language: "it" })),
		);
		await reportCommand(1, "pippo")(env);
		expect(mocks.chatConfigRepository.setReportsEnabled).not.toHaveBeenCalled();
		expect(lastMessage(mocks)).toContain("/report on");
	});
});
