import { describe, expect, it } from "vitest";
import type { ChatConfig } from "../../../src/domain/chatConfig.js";
import {
	describeIssueLink,
	nomeCommand,
	registerChat,
} from "../../../src/domain/registration.js";
import { success } from "../../../src/domain/result.js";
import { makeTestEnv } from "../testEnv.js";

const base = {
	userName: "papà",
	maxChats: 5,
	repoIssuesUrl: "https://github.com/x/y/issues",
};

const lastMessage = (
	mocks: ReturnType<typeof makeTestEnv>["mocks"],
): string => {
	const calls = mocks.bot.sendMessage.mock.calls;
	return (calls[calls.length - 1]?.[1] as string) ?? "";
};

describe("[REGISTRATION] registerChat", () => {
	it("registers a fresh chat under the cap and welcomes", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(success(null));
		mocks.chatConfigRepository.count.mockResolvedValue(success(0));
		mocks.chatConfigRepository.create.mockResolvedValue(success({ chatId: 1 }));
		await registerChat({ chatId: 1, ...base })(env);
		expect(mocks.chatConfigRepository.create).toHaveBeenCalledWith({
			chatId: 1,
			createdByName: "papà",
		});
		expect(lastMessage(mocks).toLowerCase()).toContain("attivato");
	});

	it("registers a fresh chat with an inline name", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(success(null));
		mocks.chatConfigRepository.count.mockResolvedValue(success(0));
		mocks.chatConfigRepository.create.mockResolvedValue(success({ chatId: 1 }));
		mocks.chatConfigRepository.setBabyName.mockResolvedValue(
			success({ chatId: 1, babyName: "Mario" }),
		);
		await registerChat({ chatId: 1, name: "Mario", ...base })(env);
		expect(mocks.chatConfigRepository.setBabyName).toHaveBeenCalledWith(
			1,
			"Mario",
		);
		expect(lastMessage(mocks)).toContain("Mario");
	});

	it("is idempotent — an already-registered chat is not re-created", async () => {
		const { env, mocks } = makeTestEnv();
		const existing: ChatConfig = { chatId: 1, babyName: "Leo" };
		mocks.chatConfigRepository.get.mockResolvedValue(success(existing));
		await registerChat({ chatId: 1, ...base })(env);
		expect(mocks.chatConfigRepository.create).not.toHaveBeenCalled();
		expect(lastMessage(mocks)).toContain("Leo");
	});

	it("updates the name when /start carries one on a registered chat", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success({ chatId: 1, babyName: "Leo" }),
		);
		mocks.chatConfigRepository.setBabyName.mockResolvedValue(
			success({ chatId: 1, babyName: "Gigi" }),
		);
		await registerChat({ chatId: 1, name: "Gigi", ...base })(env);
		expect(mocks.chatConfigRepository.create).not.toHaveBeenCalled();
		expect(lastMessage(mocks).toLowerCase()).toContain("aggiornato");
	});

	it("refuses a new chat at the cap and sends the issue link with the chatId", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(success(null));
		mocks.chatConfigRepository.count.mockResolvedValue(success(5));
		await registerChat({ chatId: -100999, chatTitle: "Fam", ...base })(env);
		expect(mocks.chatConfigRepository.create).not.toHaveBeenCalled();
		const msg = lastMessage(mocks);
		expect(msg).toContain("https://github.com/x/y/issues/new");
		expect(msg).toContain("-100999");
	});
});

describe("[REGISTRATION] nomeCommand", () => {
	it("sets a name (impostato) when none was set", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(success({ chatId: 1 }));
		mocks.chatConfigRepository.setBabyName.mockResolvedValue(
			success({ chatId: 1, babyName: "Mario" }),
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
			success({ chatId: 1, babyName: "Leo" }),
		);
		mocks.chatConfigRepository.setBabyName.mockResolvedValue(
			success({ chatId: 1, babyName: "Gigi" }),
		);
		await nomeCommand(1, "Gigi")(env);
		expect(lastMessage(mocks).toLowerCase()).toContain("aggiornato");
	});

	it("shows the current name for bare /nome", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(
			success({ chatId: 1, babyName: "Leo" }),
		);
		await nomeCommand(1, "")(env);
		expect(mocks.chatConfigRepository.setBabyName).not.toHaveBeenCalled();
		expect(lastMessage(mocks)).toContain("Leo");
	});

	it("shows a usage hint for bare /nome when no name is set", async () => {
		const { env, mocks } = makeTestEnv();
		mocks.chatConfigRepository.get.mockResolvedValue(success({ chatId: 1 }));
		await nomeCommand(1, "")(env);
		expect(lastMessage(mocks).toLowerCase()).toContain("/nome");
	});
});

describe("[REGISTRATION] describeIssueLink", () => {
	it("embeds the chatId and url-encodes the body", () => {
		const link = describeIssueLink(
			"https://github.com/x/y/issues",
			-100999,
			"Fam Rossi",
		);
		expect(link).toContain("https://github.com/x/y/issues/new?");
		expect(link).toContain("-100999");
		expect(link).toContain(encodeURIComponent("Fam Rossi"));
	});
});
