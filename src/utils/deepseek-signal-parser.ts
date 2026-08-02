import type { ParsedSignal } from "../typings/index.js";
import { deepseekApiKey } from "./env.js";
import logger from "./logger.js";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_MODEL = "deepseek-v4-flash";
const TIMEOUT_MS = 10_000;

const SYSTEM_PROMPT = `You are a trading signal parser. Given a message in this format:

$SYMBOL DIRECTION
ENTRY: price
TP 1: price
TP 2: price
...
SL: price

Extract it into valid JSON matching this type:

{
  "symbol": string,       // uppercase, with "USDT" suffix if not present. "$" prefix stripped.
  "side": "LONG" | "SHORT",
  "entry": { "price": number },
  "tp": [{ "level": number, "price": number }],
  "sl": { "price": number }
}

Rules:
- symbol: strip "$" prefix, convert to uppercase, append "USDT" if no stablecoin suffix (USDT, USDC, BUSD, etc.)
- side: "LONG" or "SHORT" exactly as appears
- All prices must be numbers (not strings)
- tp[].level: 1-indexed integer (1, 2, 3, 4...)
- Order of TP levels must match the signal
- Output ONLY the JSON object. No markdown wrapping, no explanation, no additional text.`;

/**
 * Parses a Discord trading signal message into a structured ParsedSignal via DeepSeek.
 * Returns null if the message is not a valid trading signal or parsing fails.
 */
export const parseSignal = async (content: string): Promise<ParsedSignal | null> => {
    if (!deepseekApiKey) {
        logger.warning("DeepSeek API key not set — cannot parse signal");
        return null;
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
            logger.error(`DeepSeek signal parse error: ${response.status} — ${errorBody}`);
            return null;
        }

        const data = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
        };

        logger.info(`DeepSeek signal parse response: ${JSON.stringify(data)}`);

        const rawContent = data?.choices?.[0]?.message?.content;
        if (!rawContent) {
            logger.warning("DeepSeek signal parse returned empty response");
            return null;
        }

        const parsed = JSON.parse(rawContent) as ParsedSignal;

        // Validate required fields
        if (!parsed.symbol || !parsed.side || !parsed.entry?.price || !parsed.sl?.price || !Array.isArray(parsed.tp) || parsed.tp.length === 0) {
            logger.warning(`DeepSeek signal parse returned incomplete signal: ${JSON.stringify(parsed)}`);
            return null;
        }

        logger.debug(`Signal parsed: ${parsed.symbol} ${parsed.side} Entry=${parsed.entry.price} SL=${parsed.sl.price} TPs=${parsed.tp.length}`);
        return parsed;
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            logger.error("DeepSeek signal parse timed out");
        } else {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error(`DeepSeek signal parse failure: ${msg}`);
        }
        return null;
    }
};

// ── Cancel Signal Parser ──────────────────────────────────

const CANCEL_SYSTEM_PROMPT = `You are a cancel signal parser. Given a Discord message about cancelling/closing a trading position, extract which ticker symbol is being cancelled.

Rules:
- Look for ticker symbols (like UNI, WLD, ONDO, XMR, PYTH, ZEC) mentioned near cancellation words
- The message will contain words like "cancel", "close", "gw cancel"
- Extract the ticker symbol that is being cancelled
- Strip "$" prefix if present, convert to UPPERCASE
- If multiple tickers are mentioned but only one is cancelled, return only the cancelled one
- If no ticker is clearly being cancelled, return symbol as null

Output ONLY a JSON object: {"symbol": "TICKER" | null}

Example:
- "ONDO gw cancel karena miss entry" → {"symbol": "ONDO"}
- "XMR gw cancel karena news" → {"symbol": "XMR"}
- "setting one more limit short" → {"symbol": null}`;

/**
 * Parses a followup signal message to extract the cancelled symbol.
 * Returns normalized symbol (with USDT suffix) or null if no symbol found.
 */
export const parseCancelSignal = async (content: string): Promise<string | null> => {
    if (!deepseekApiKey) return null;

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
                    { role: "system", content: CANCEL_SYSTEM_PROMPT },
                    { role: "user", content }
                ],
                response_format: { type: "json_object" },
                max_tokens: 128000,
                temperature: 0
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) return null;

        const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        logger.info(`DeepSeek cancel parse response: ${JSON.stringify(data)}`);

        const rawContent = data?.choices?.[0]?.message?.content;
        if (!rawContent) return null;

        const parsed = JSON.parse(rawContent) as { symbol: string | null };
        if (!parsed.symbol) return null;

        // Normalize: uppercase, add USDT suffix
        let symbol = parsed.symbol.toUpperCase();
        if (!/(USDT|USDC|BUSD)$/.test(symbol)) symbol += "USDT";

        logger.debug(`Cancel signal parsed: ${symbol}`);
        return symbol;
    } catch {
        return null;
    }
};