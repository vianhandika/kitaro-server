import "dotenv/config";
import process from "node:process";
import { setInterval } from "node:timers";
import { listen } from "./modules/Discord.js";
import { startServer } from "./server.js";
import logger from "./utils/logger.js";

startServer();
listen();

// Watchdog: enable only if RELOAD_TIMER (minutes) is set and valid
const reloadTimerMinutesRaw = process.env.RELOAD_TIMER ?? "";
if (reloadTimerMinutesRaw.trim() === "") {
    logger.info("Watchdog disabled: RELOAD_TIMER not set");
} else {
    const reloadTimerMinutes = Number(reloadTimerMinutesRaw);
    if (Number.isFinite(reloadTimerMinutes) && reloadTimerMinutes > 0) {
        const reloadTimerMs = reloadTimerMinutes * 60 * 1000;
        setInterval(() => {
            logger.info("Watchdog: restarting Discord listener...");
            listen();
        }, reloadTimerMs);
    } else {
        logger.info(`Watchdog disabled: invalid RELOAD_TIMER "${reloadTimerMinutesRaw}"`);
    }
}
