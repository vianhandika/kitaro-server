/* eslint-disable typescript/naming-convention */
import type { APIEmbed, Snowflake } from "discord.js";

export type Channel = {
    id: Snowflake;
    type: number;
    guild_id?: Snowflake;
    position: string;
    permission_overwrites?: Overwrite[];
    name: string;
    topic?: string;
    nsfw?: boolean;
    last_message_id?: Snowflake;
    reate_limit_per_user?: number;
    parent_id?: Snowflake;
}

export type Overwrite = {
    id: string;
    type: number;
    allow: string;
    deny: string;
}

export type Things = {
    avatarURL: string;
    content: any;
    embeds?: APIEmbed[];
    files?: any[];
    url: string;
    username: string;
}

export type WebhookConfig = {
    things: Things;
}

export type WebsocketTypes = {
    on(event: string, cb: (data: any) => void): void;
    send(data: any): void;
}

export type DiscordWebhook = {
    application_id: Snowflake | null;
    avatar: string | null;
    channel_id: Snowflake;
    guild_id: Snowflake;
    id: Snowflake;
    name: string;
    token: string;
    url: string;
}

// === Signal → Bybit Trading Types ===

export type ParsedSignal = {
    symbol: string;          // "ONDOUSDT" — normalized, USDT suffix appended if missing
    side: "LONG" | "SHORT";
    entry: {
        price: number;
    };
    tp: {
        level: number;       // 1-indexed: 1, 2, 3, 4
        price: number;
    }[];
    sl: {
        price: number;
    };
};

export type SymbolMeta = {
    symbol: string;
    tickSize: number;        // price precision, e.g. 0.0001
    qtyStep: number;         // quantity precision, e.g. 0.1
    minOrderQty: number;     // minimum order size, e.g. 1
    minNotionalUSD: number;  // minimum notional value, e.g. 5
};

export type ExecutionResult = {
    success: boolean;
    symbol: string;
    side: "LONG" | "SHORT";
    entryPrice: number;
    tpPrice: number | null;
    slPrice: number;
    qty: number;
    dryRun: boolean;
    error?: string;
    details: string[];
};
