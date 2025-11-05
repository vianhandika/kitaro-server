import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";

const readTail = async (filePath: string, maxLines = 200): Promise<string> => {
    try {
        const content = await fs.promises.readFile(filePath, "utf8");
        const lines = content.split(/\r?\n/u);
        const tail = lines.slice(Math.max(0, lines.length - maxLines));
        return tail.join("\n");
    } catch {
        return "";
    }
};

export const startServer = (): void => {
    const port = Number(process.env.PORT ?? 3000);
    const server = createServer(async (req, res) => {
        const urlStr = req.url ?? "/";
        const url = new URL(urlStr, `http://localhost:${port}`);

        if (url.pathname === "/" || url.pathname === "/logs") {
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            const base = process.cwd();
            const debugLog = await readTail(path.join(base, "logs", "debug.log"));
            const errorLog = await readTail(path.join(base, "logs", "error.log"));

            const combined = [
                "=== Discord Chat Mirror Logs ===",
                "",
                errorLog ? `---- error.log ----\n${errorLog}` : "---- error.log ----\n(no entries)",
                "",
                debugLog ? `---- debug.log ----\n${debugLog}` : "---- debug.log ----\n(no entries)",
                ""
            ].join("\n");

            res.end(combined);
            return;
        }

        res.statusCode = 404;
        res.end("Not Found");
    });

    server.listen(port, () => {
        console.log(`Log server listening on port ${port}`);
    });
};