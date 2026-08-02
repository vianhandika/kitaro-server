import { setTimeout, clearTimeout } from "node:timers";
import { deepseekApiKey } from "./env.js";
import logger from "./logger.js";

/* eslint-disable typescript/naming-convention */
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_MODEL = "deepseek-v4-flash";
const TIMEOUT_MS = 10_000;

export type Classification = "Followup Signal" | "Information" | "Signal";

const SYSTEM_PROMPT = `You are a crypto trading signal classifier. Your only job is to classify a Discord message as "Signal", "Followup Signal", or "Information".

A "Signal" message contains a NEW trading setup with ALL of these characteristics:
- Mentions a specific coin/token ticker (like $UNI, $WLD, $ONDO)
- Specifies LONG or SHORT direction
- Contains ENTRY price
- Contains at least one TP (Take Profit) target
- Contains SL (Stop Loss)

A "Followup Signal" message mentions CANCELLING or CLOSING an existing position/order for a specific coin/token ticker. Key indicators:
- Words like "cancel", "close", "gw cancel", "di cancel"
- References a specific ticker being cancelled (e.g., "ONDO gw cancel", "XMR gw cancel")
- Does NOT contain a new ENTRY/TP/SL setup for that ticker

An "Information" message is everything else, such as:
- Status updates about active limits without cancellation
- General market commentary or news
- Questions or discussions
- Any message that does NOT contain a full trading setup and does NOT cancel any position

Reply ONLY with a JSON object: {"classification": "Signal"} or {"classification": "Followup Signal"} or {"classification": "Information"}`;

/**
 * Classifies a Discord message as "Signal" or "Information" using DeepSeek AI.
 * Falls back to "Information" on any error (API failure, timeout, invalid response).
 */
export const classifyMessage = async (content: string): Promise<Classification> => {
    if (!deepseekApiKey) {
        logger.warning("DeepSeek API key not set — defaulting to Information");
        return "Information";
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${deepseekApiKey}`
            },
            body: JSON.stringify({
                model: DEEPSEEK_MODEL,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content }
                ],
                response_format: { type: "json_object" },
                max_tokens: 128000,
                temperature: 0
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorBody = await response.text().catch(() => "");
            logger.error(`DeepSeek API error: ${response.status} ${response.statusText} — ${errorBody}`);
            return "Information";
        }

        const data = (await response.json()) as {
            choices?: { message?: { content?: string } }[];
        };

        logger.info(`DeepSeek classify response: ${JSON.stringify(data)}`);

        const rawContent = data?.choices?.[0]?.message?.content;
        if (rawContent === undefined || rawContent === null || rawContent === "") {
            logger.warning("DeepSeek returned empty response — defaulting to Information");
            return "Information";
        }

        const parsed = JSON.parse(rawContent) as { classification?: string };
        const classification = parsed?.classification;

        if (classification === "Signal" || classification === "Information" || classification === "Followup Signal") {
            logger.debug(`DeepSeek classified message as: ${classification}`);
            return classification;
        }

        logger.warning(`DeepSeek returned unexpected classification: "${classification}" — defaulting to Information`);
        return "Information";
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            logger.error("DeepSeek API request timed out — defaulting to Information");
        } else {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error(`DeepSeek API failure: ${msg} — defaulting to Information`);
        }
        return "Information";
    }
};