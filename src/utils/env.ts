import process from "node:process";

import { parseEnvValue } from "./functions/parseEnvValue.js";

export const discordToken = process.env.DISCORD_TOKEN;
export const channelsId: string[] = parseEnvValue(process.env.CHANNELS_ID ?? "");
export const webhooksUrl: string[] = parseEnvValue(process.env.WEBHOOKS_URL ?? "");

export const enableBotIndicator: boolean = process.env.ENABLE_BOT_INDICATOR?.toLowerCase() === "yes";
export const useWebhookProfile: boolean = process.env.USE_WEBHOOK_PROFILE?.toLowerCase() === "yes";
export const debugMode: boolean = process.env.DEBUG_MODE?.toLowerCase() === "yes";

export const enableGrade: number = Number.parseFloat(process.env.ENABLE_GRADE ?? "0") || 0;
export const filterGroups: string[] = parseEnvValue(process.env.FILTER_GROUPS ?? "");

export const deepseekApiKey: string = process.env.DEEPSEEK_API_KEY ?? "";

export const realTrade: boolean = process.env.REAL_TRADE?.toLowerCase() === "yes";
export const bybitBaseUrl: string = process.env.BYBIT_BASE_URL ?? "https://api.bybit.com";
export const bybitApiKey: string = process.env.BYBIT_API_KEY ?? "";
export const bybitApiSecret: string = process.env.BYBIT_API_SECRET ?? "";
export const bybitAccountType: string = process.env.BYBIT_ACCOUNT_TYPE ?? "unified";
export const bybitPositionMode: string = (process.env.BYBIT_POSITION_MODE ?? "one-way").toLowerCase();
export const maxLossPerTrade: number = Number.parseFloat(process.env.MAX_LOSS_PER_TRADE ?? "50") || 50;
export const strategyType: string = (process.env.STRATEGY_TYPE ?? "TP2").toUpperCase();

/**
 * Get positionIdx based on account mode and trade side.
 */
export const getPositionIdx = (side: "Buy" | "Sell"): 0 | 1 | 2 => {
    if (bybitPositionMode === "hedge") {
        return side === "Buy" ? 1 : 2;
    }
    return 0; // one-way mode
};

export const headers = {
    "Content-Type": "application/json",
    Authorization: `Bot ${discordToken}`
};

export const channelWebhookMap = new Map<string, string>();
export const channelFilterMap = new Map<string, string>();
for (const [i, channelId] of channelsId.entries()) {
    const webhook = webhooksUrl[i];
    if (webhook === undefined) {
        console.warn(`Warning: Channel ${channelId} at index ${i} has no matching webhook URL`);
    } else {
        channelWebhookMap.set(channelId, webhook);
    }

    const group = filterGroups[i];
    if (group !== undefined && group.length > 0) {
        channelFilterMap.set(channelId, group.toLowerCase());
    }
}

if (webhooksUrl.length > channelsId.length) {
    console.warn(`Warning: ${webhooksUrl.length - channelsId.length} extra webhook URL(s) will not be used`);
}
if (filterGroups.length > channelsId.length) {
    console.warn(`Warning: ${filterGroups.length - channelsId.length} extra filter group(s) will not be used`);
}

/**
 * Returns all (webhook, group) pairs for a given channel ID.
 * Supports duplicate channel IDs.
 */
export const getChannelRules = (channelId: string): { webhook: string; group: string }[] => {
    const rules: { webhook: string; group: string }[] = [];
    for (const [i, id] of channelsId.entries()) {
        if (id === channelId && webhooksUrl[i] !== undefined) {
            rules.push({
                webhook: webhooksUrl[i],
                group: (filterGroups[i] ?? "").toLowerCase()
            });
        }
    }
    return rules;
};
