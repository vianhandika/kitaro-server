import process from "node:process";

import { parseEnvValue } from "./functions/parseEnvValue.js";

export const discordToken = process.env.DISCORD_TOKEN;
export const channelsId: string[] = parseEnvValue(process.env.CHANNELS_ID ?? "");
export const webhooksUrl: string[] = parseEnvValue(process.env.WEBHOOKS_URL ?? "");

export const enableBotIndicator: boolean = process.env.ENABLE_BOT_INDICATOR?.toLowerCase() === "yes";
export const useWebhookProfile: boolean = process.env.USE_WEBHOOK_PROFILE?.toLowerCase() === "yes";
export const debugMode: boolean = process.env.DEBUG_MODE?.toLowerCase() === "yes";

export const headers = {
    "Content-Type": "application/json",
    Authorization: `Bot ${discordToken}`
};

export const channelWebhookMap = new Map<string, string>();
for (const [i, channelId] of channelsId.entries()) {
    const webhook = webhooksUrl[i];
    if (webhook === undefined) {
        console.warn(`Warning: Channel ${channelId} at index ${i} has no matching webhook URL`);
    } else {
        channelWebhookMap.set(channelId, webhook);
    }
}

if (webhooksUrl.length > channelsId.length) {
    console.warn(`Warning: ${webhooksUrl.length - channelsId.length} extra webhook URL(s) will not be used`);
}

// Optional special handling channel for scalp reversals
export const scalpReversalsChannelId: string | undefined = process.env.SCALP_REVERSALS_CHANNEL_ID;

// Optional Binance credentials (used by trading integration)
export const binanceApiKey: string | undefined = process.env.BINANCE_API_KEY;
export const binanceApiSecret: string | undefined = process.env.BINANCE_API_SECRET;
export const binanceUseTestnet: boolean = (process.env.BINANCE_USE_TESTNET ?? "yes").toLowerCase() === "yes";

// Scalp-reversals trading params (env-driven)
const rawSide = (process.env.SCALP_SIDE ?? "SELL").toUpperCase();
export const scalpSide: "BUY" | "SELL" = rawSide === "BUY" ? "BUY" : "SELL";
export const scalpSizeUsd: number = Number(process.env.SCALP_SIZE_USD ?? "100");
export const scalpTpPct: number = Number(process.env.SCALP_TP_PCT ?? "5");
export const scalpSlPct: number = Number(process.env.SCALP_SL_PCT ?? "10");
export const scalpDcaSteps: number[] = parseEnvValue(process.env.SCALP_DCA_STEPS ?? "2.5,5,7.5")
    .map((v: string) => Number(v))
    .filter((n: number) => Number.isFinite(n));
