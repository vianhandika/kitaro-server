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
