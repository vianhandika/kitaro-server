/* eslint-disable id-length */
import type { Buffer } from "node:buffer";
import process from "node:process";
import { setInterval, clearInterval } from "node:timers";

import type { APIAttachment, APIStickerItem, GatewayReceivePayload } from "discord.js";
import { WebhookClient, GatewayDispatchEvents, GatewayOpcodes } from "discord.js";

import Websocket from "ws";

import type { DiscordWebhook, Things } from "../typings/index.js";
import { channelsId, discordToken, channelWebhookMap, enableBotIndicator, headers, useWebhookProfile, scalpReversalsChannelId, scalpSide, scalpSizeUsd, scalpTpPct, scalpSlPct, scalpDcaSteps } from "../utils/env.js";
import { placeDcaStrategyUsd } from "../utils/binance.js";
import logger from "../utils/logger.js";

export const executeWebhook = async (things: Things): Promise<void> => {
    const wsClient = new WebhookClient({ url: things.url });
    await wsClient.send(things);
};

let ws: Websocket;
let resumeData = {
    sessionId: "",
    resumeGatewayUrl: "",
    seq: 0
};
let authenticated = false;
let attemptingResume = false;
let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

export const listen = (): void => {
    // reset state for new connection
    authenticated = false;
    // close previous connection if any
    try {
        if (ws !== undefined) {
            // remove listeners and close gracefully
            ws.removeAllListeners?.();
            ws.close?.();
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.debug(`Failed to close previous WebSocket: ${msg}`);
    }
    if (heartbeatInterval !== undefined) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = undefined;
    }

    if (resumeData.sessionId && resumeData.resumeGatewayUrl) {
        logger.info("Resuming session...");
        logger.debug(`Session ID: ${resumeData.sessionId}`);
        logger.debug(`Resume Gateway URL: ${resumeData.resumeGatewayUrl}`);
        logger.debug(`Sequence: ${resumeData.seq}`);
        attemptingResume = true;
        ws = new Websocket(resumeData.resumeGatewayUrl);
    } else {
        attemptingResume = false;
        ws = new Websocket("wss://gateway.discord.gg/?v=10&encoding=json");
    }

    ws.on("open", () => {
        logger.info("Connected to the Discord WSS.");
    });
    ws.on("message", async (data: [any]) => {
        const payload: GatewayReceivePayload = JSON.parse(data.toString()) as GatewayReceivePayload;
        const { op, d, s, t } = payload;
        resumeData.seq = s ?? resumeData.seq;

        switch (op) {
            case GatewayOpcodes.Hello:
                logger.info("Hello event received. Starting heartbeat...");
                ws.send(
                    JSON.stringify({
                        op: 1,
                        d: s
                    })
                );
                heartbeatInterval = setInterval(() => {
                    ws.send(
                        JSON.stringify({
                            op: 1,
                            d: s
                        })
                    );

                    logger.debug("Heartbeat sent.");
                }, d.heartbeat_interval);

                logger.info("Heartbeat started.");
                // If resuming, send resume payload AFTER hello/heartbeat setup
                if (attemptingResume) {
                    ws.send(
                        JSON.stringify({
                            op: 6,
                            d: {
                                token: discordToken,
                                // eslint-disable-next-line typescript/naming-convention
                                session_id: resumeData.sessionId,
                                seq: resumeData.seq
                            }
                        })
                    );
                    logger.info("Attempting to resume session...");
                }
                break;
            case GatewayOpcodes.Heartbeat:
                logger.debug("Discord requested an immediate heartbeat.");
                ws.send(
                    JSON.stringify({
                        op: 1,
                        d: s
                    })
                );
                logger.debug("Heartbeat sent.");
                break;
            case GatewayOpcodes.HeartbeatAck:
                // Only identify on fresh connections, not during resume
                if (!authenticated && !attemptingResume) {
                    authenticated = true;
                    ws.send(
                        JSON.stringify({
                            op: 2,
                            d: {
                                token: discordToken,
                                properties: { os: "android", browser: "dcm", device: "dcm" },
                                intents: Number("37408")
                            }
                        })
                    );
                    logger.info("Authenticating...");
                }
                break;
            case GatewayOpcodes.Dispatch:
                if (t === GatewayDispatchEvents.Ready) {
                    resumeData = {
                        sessionId: d.session_id,
                        resumeGatewayUrl: `${d.resume_gateway_url}?v=10&encoding=json`,
                        seq: s
                    };
                    authenticated = true;
                    attemptingResume = false;
                    logger.info(
                        `Logged in as ${d.user.username}${(d.user.discriminator !== null && d.user.discriminator !== undefined && d.user.discriminator !== "0") ? `#${d.user.discriminator}` : ""}`
                    );
                }

                if (t === GatewayDispatchEvents.MessageCreate && channelsId.includes(d.channel_id)) {
                    const webhookUrl = channelWebhookMap.get(d.channel_id);
                    
                    if (webhookUrl === undefined) {
                        logger.warning(`No webhook URL mapped for channel ${d.channel_id}`);
                        break;
                    }

                    let ext = "jpg";
                    let ub = " [USER]";

                    const { content, attachments, embeds, sticker_items, author } = d;
                    const { avatar, username, discriminator: discriminatorRaw, id, bot } = author;
                    let discriminator: string | null = discriminatorRaw;

                    discriminator = discriminator === "0" ? null : `#${discriminator}`;

                    if (avatar?.startsWith("a_") === true) ext = "gif";
                    if (bot === true) ub = " [BOT]";

                    const normalizedContent = (typeof content === "string" && content.trim().length > 0) ? content : "** **";
                    if (typeof content === "string" && content.trim().length === 0) {
                        logger.debug("Content is empty; using placeholder to satisfy Discord webhook.");
                    }

                    // Build aggregated text for parsing
                    const embedText = Array.isArray(embeds) ? embeds.map((e: any) => {
                        const parts: string[] = [];
                        if (typeof e.title === "string") parts.push(e.title);
                        if (typeof e.description === "string") parts.push(e.description);
                        if (Array.isArray(e.fields)) {
                            for (const f of e.fields) {
                                const name = typeof f.name === "string" ? f.name : "";
                                const value = typeof f.value === "string" ? f.value : "";
                                if (name || value) parts.push(`${name}${name && value ? ": " : ""}${value}`);
                            }
                        }
                        return parts.join("\n");
                    }).join("\n") : "";

                    const aggregateText = [normalizedContent, embedText].filter(Boolean).join("\n");

                    // Parse Asset, RSI, Funding Rate
                    const assetMatch = aggregateText.match(/Asset:\s*([A-Z0-9_\-]+USDT)/i) || aggregateText.match(/\b([A-Z0-9_\-]+USDT)\b/);
                    const rsiMatch = aggregateText.match(/RSI:\s*([0-9]+(?:\.[0-9]+)?)/i);
                    const frMatch = aggregateText.match(/Funding\s*Rate:\s*([-+]?\d*\.?\d+)%?/i);

                    const isScalpChannel = typeof scalpReversalsChannelId === "string" && scalpReversalsChannelId !== "" && d.channel_id === scalpReversalsChannelId;
                    const hasAlertData = assetMatch !== null && rsiMatch !== null && frMatch !== null;

                    if (isScalpChannel && hasAlertData) {
                        const symbol = assetMatch![1].toUpperCase();
                        const rsiVal = Number(rsiMatch![1]);
                        const fundingRate = Number(frMatch![1]);
                        const startedAt = new Date().toISOString();
                        logger.info(`🧭 Alert detected @ ${startedAt} | symbol=${symbol} rsi=${rsiVal} fr=${fundingRate}`);
                        try {
                            await placeDcaStrategyUsd(symbol, scalpSide, scalpSizeUsd, scalpDcaSteps, scalpTpPct, scalpSlPct);
                            logger.info(`Executed DCA strategy for ${symbol} (${scalpSide}, $${scalpSizeUsd})`);
                        } catch (err) {
                            const message = err instanceof Error ? err.message : String(err);
                            logger.error(`Failed to execute strategy for ${symbol}: ${message}`);
                        }
                        // Do not mirror this message
                        break;
                    }

                    // const things: Things = {
                    //     avatarURL:
                    //         (avatar !== null && avatar !== undefined && avatar !== "")
                    //             ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.${ext}`
                    //             : `https://cdn.discordapp.com/embed/avatars/${(BigInt(id) >> 22n) % 6n}.png`,
                    //     content: normalizedContent,
                    //     url: webhookUrl,
                    //     username: `${username}${discriminator ?? ""}${enableBotIndicator ? ub : ""}`
                    // };

                    // if (useWebhookProfile) {
                    //     const webhookData = await fetch(webhookUrl, {
                    //         method: "GET",
                    //         headers
                    //     });

                    //     const tes: DiscordWebhook = (await webhookData.json()) as DiscordWebhook;
                    //     let ext2 = "jpg";
                    //     if (tes.avatar?.startsWith("a_") === true) ext2 = "gif";
                    //     things.avatarURL = `https://cdn.discordapp.com/avatars/${tes.id}/${tes.avatar}.${ext2}`;
                    //     things.username = tes.name;
                    // }

                     
                    // if (embeds.length > 0) {
                    //     things.embeds = embeds;
                    // } else if (sticker_items) {
                    //     things.files = sticker_items.map((a: APIStickerItem) => `https://media.discordapp.net/stickers/${a.id}.webp`);
                    // } else if (attachments.length > 0) {
                    //     const fileSizeInBytes = Math.max(...attachments.map((a: APIAttachment) => a.size));
                    //     const fileSizeInMegabytes = fileSizeInBytes / (1_024 * 1_024);
                    //     if (fileSizeInMegabytes < 8) {
                    //         things.files = attachments.map((a: APIAttachment) => a.url);
                    //     } else {
                    //         things.content += attachments.map((a: APIAttachment) => a.url).join("\n");
                    //     }
                    // }
                    // await executeWebhook(things);
                }
                break;
            case GatewayOpcodes.Reconnect: {
                logger.info("Reconnecting...");
                listen();
                break;
            }
            case GatewayOpcodes.InvalidSession:
                logger.warning("Invalid session.");
                if (d) {
                    logger.info("Can retry, reconnecting...");
                    listen();
                } else {
                    logger.error("Cannot retry, exiting...");
                    process.exit(1);
                }
                break;
            default:
                logger.warning("Unhandled opcode:", op);
                break;
        }
    });

    ws.on("close", (code: number, reason: Buffer) => {
        logger.warning(`WebSocket closed: code=${code} reason=${reason.toString()}`);
        if (heartbeatInterval !== undefined) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = undefined;
        }
        listen();
    });

    ws.on("error", (err: Error) => {
        logger.error(`WebSocket error: ${err.message}`);
    });
};
