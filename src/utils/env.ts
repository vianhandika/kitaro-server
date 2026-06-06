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

/** Returns all (webhook, group) pairs for a given channel ID. Supports duplicate channel IDs. */
export const getChannelRules = (channelId: string): Array<{ webhook: string; group: string }> => {
    const rules: Array<{ webhook: string; group: string }> = [];
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
