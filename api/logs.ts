import process from "node:process";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    const source = process.env.LOGS_SOURCE_URL;

    if (source === undefined || source === "") {
        res
            .status(200)
            .setHeader("Content-Type", "text/plain; charset=utf-8")
            .send(
                [
                    "No LOGS_SOURCE_URL configured.",
                    "",
                    "Deploy the bot on a persistent host (Railway/Render/VPS) where it exposes /logs.",
                    "Then set LOGS_SOURCE_URL to that endpoint to view logs via your Vercel domain.",
                ].join("\n")
            );
        return;
    }

    try {
        const response: Response = await fetch(source);
        const text = await response.text();
        res.status(response.status);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.send(text);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(502);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.send(`Failed to fetch logs from ${source}\n\n${message}`);
    }
}