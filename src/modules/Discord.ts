/* eslint-disable id-length */
import type { Buffer } from "node:buffer";
import process from "node:process";
import { setInterval, clearInterval } from "node:timers";

import type { APIAttachment, APIStickerItem, GatewayReceivePayload } from "discord.js";
import { WebhookClient, GatewayDispatchEvents, GatewayOpcodes } from "discord.js";

import Websocket from "ws";

import type { DiscordWebhook, Things } from "../typings/index.js";
import { channelsId, discordToken, getChannelRules, enableBotIndicator, enableGrade, headers, useWebhookProfile } from "../utils/env.js";
import logger from "../utils/logger.js";

export const executeWebhook = async (things: Things): Promise<void> => {
    const wsClient = new WebhookClient({ url: things.url });
    await wsClient.send(things);
};

type FilterGroup = "a-only" | "grade-only" | "no-filter" | "premium";

/**
 * Per-group alert filtering:
 *   premium    — Grade \>= ENABLE_GRADE  +  Bias/Swing aligned
 *   a-only     — Grade letter is "A"
 *   grade-only — Grade \>= ENABLE_GRADE only
 *   no-filter  — pass through (no filter)
 */
const shouldSendAlert = (description: string | undefined, group: string | undefined): boolean => {
    const g: FilterGroup = (group ?? "no-filter") as FilterGroup;

    // no-filter: allow everything
    if (g === "no-filter") return true;
    if (description === undefined) return false;

    // Parse grade: captures both the letter and the number
    // Example: "**Grade:** B · 4.6" → letter="B", number=4.6
    const gradeMatch = /\*\*Grade:\*\*\s*.*?\s*(?<letter>[A-F][+-]?)\s*·\s*(?<number>[\d.]+)/iu.exec(description);
    const gradeLetter = gradeMatch?.groups?.letter === undefined ? null : gradeMatch.groups.letter.toUpperCase();
    const gradeNumber = gradeMatch?.groups?.number === undefined ? null : Number.parseFloat(gradeMatch.groups.number);
    
    logger.debug(`Parsed grade: letter="${gradeLetter}", number=${gradeNumber}, group=${g}`);

    // a-only: check if Grade line contains "A"
    if (g === "a-only") {
        if (!/\*\*grade:.*a/iu.test(description)) {
            logger.debug("Alert filtered out: Grade does not contain A (group=a-only)");
            return false;
        }
        logger.debug("Alert passed filter: Grade contains A (group=a-only)");
        return true;
    }

    // premium & grade-only: both need gradeNumber >= ENABLE_GRADE
    if (g === "premium" || g === "grade-only") {
        if (enableGrade <= 0) {
            logger.debug("Alert filter: ENABLE_GRADE is 0, grade check skipped.");
        } else {
            if (gradeNumber === null) {
                logger.debug("Alert filter: missing grade in description, skipping.");
                return false;
            }
            if (gradeNumber < enableGrade) {
                logger.debug(`Alert filtered out: Grade ${gradeNumber} < ${enableGrade} (group=${g})`);
                return false;
            }
        }
    }

    // premium only: also enforce bias/swing alignment
    if (g === "premium") {
        const biasMatch = /\*\*Bias:\*\*\s*.*?\s*(?<bias>Long|Short)/iu.exec(description);
        const swingMatch = /\*\*Swing:\*\*\s*.*?\s*(?<swing>Bullish|Bearish)/iu.exec(description);

        const bias = biasMatch?.groups?.bias === undefined ? null : biasMatch.groups.bias.toLowerCase();
        const swing = swingMatch?.groups?.swing === undefined ? null : swingMatch.groups.swing.toLowerCase();

        if (bias === null || swing === null) {
            logger.debug("Alert filter: missing bias/swing in description, skipping.");
            return false;
        }
        const aligned = (bias === "long" && swing === "bullish") || (bias === "short" && swing === "bearish");
        if (!aligned) {
            logger.debug(`Alert filtered out: Bias=${bias}, Swing=${swing} not aligned (group=premium)`);
            return false;
        }
    }

    logger.debug(`Alert passed filter: GradeLetter=${gradeLetter ?? "?"}, GradeNumber=${gradeNumber ?? "?"}, group=${g}`);
    return true;
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
                    const rules = getChannelRules(d.channel_id);

                    if (rules.length === 0) {
                        logger.warning(`No rules mapped for channel ${d.channel_id}`);
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

                    const firstEmbedDesc = embeds.length > 0 ? embeds[0].description : undefined;

                    // Iterate all matching rules (supports same channel → multiple webhooks/filters)
                    /* eslint-disable no-await-in-loop */
                    for (const rule of rules) {
                        // Per-group filter
                        if (!shouldSendAlert(firstEmbedDesc, rule.group)) {
                            logger.debug(`Alert skipped by filter (group=${rule.group}).`);
                            continue;
                        }

                        const things: Things = {
                            avatarURL:
                                (avatar !== null && avatar !== undefined && avatar !== "")
                                    ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.${ext}`
                                    : `https://cdn.discordapp.com/embed/avatars/${(BigInt(id) >> 22n) % 6n}.png`,
                            content: normalizedContent,
                            url: rule.webhook,
                            username: `${username}${discriminator ?? ""}${enableBotIndicator ? ub : ""}`
                        };

                        if (useWebhookProfile) {
                            const webhookData = await fetch(rule.webhook, {
                                method: "GET",
                                headers
                            });

                            const tes: DiscordWebhook = (await webhookData.json()) as DiscordWebhook;
                            let ext2 = "jpg";
                            if (tes.avatar?.startsWith("a_") === true) ext2 = "gif";
                            things.avatarURL = `https://cdn.discordapp.com/avatars/${tes.id}/${tes.avatar}.${ext2}`;
                            things.username = tes.name;
                        }

                         
                        if (embeds.length > 0) {
                            things.embeds = embeds;
                        } else if (sticker_items) {
                            things.files = sticker_items.map((a: APIStickerItem) => `https://media.discordapp.net/stickers/${a.id}.webp`);
                        } else if (attachments.length > 0) {
                            const fileSizeInBytes = Math.max(...attachments.map((a: APIAttachment) => a.size));
                            const fileSizeInMegabytes = fileSizeInBytes / (1_024 * 1_024);
                            if (fileSizeInMegabytes < 8) {
                                things.files = attachments.map((a: APIAttachment) => a.url);
                            } else {
                                things.content += attachments.map((a: APIAttachment) => a.url).join("\n");
                            }
                        }

                        logger.debug(`Sending to webhook (group=${rule.group}): ${JSON.stringify(things)}`);
                        await executeWebhook(things);
                    }
                    /* eslint-enable no-await-in-loop */
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
