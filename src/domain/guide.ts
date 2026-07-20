import type { ChatLanguage } from "./chatConfig.js";

export const guideUrlForLanguage = (
	guideUrl: string,
	language: ChatLanguage,
): string =>
	language === "it"
		? guideUrl
		: guideUrl.replace(/\/guida\.html$/, "/guide.html");
