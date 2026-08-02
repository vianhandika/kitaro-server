import type { ParsedSignal, ExecutionResult } from "../typings/index.js";
import { maxLossPerTrade, realTrade, strategyType, getPositionIdx } from "./env.js";
import { roundToStep, roundUpToStep } from "./math.js";
import { getInstrumentsInfo, submitOrder, getPositions, closePosition, cancelAllOrders } from "../modules/Bybit.js";
import logger from "./logger.js";

const DELAY_MS = 100;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Picks the right TP from the signal based on STRATEGY_TYPE.
 * e.g. STRATEGY_TYPE=TP2 → find tp[level=2], fallback to tp[0] (lowest level)
 */
const pickTP = (tp: ParsedSignal["tp"]): ParsedSignal["tp"][number] | null => {
    const targetLevel = Number.parseInt(strategyType.replace("TP", ""), 10) || 1;
    const match = tp.find((t) => t.level === targetLevel);
    if (match) return match;

    // Fallback: use the TP with the lowest level
    const sorted = [...tp].sort((a, b) => a.level - b.level);
    const fallback = sorted[0];
    if (fallback) {
        logger.info(`STRATEGY_TYPE=${strategyType} not found, falling back to TP${fallback.level}`);
    }
    return fallback ?? null;
};

/**
 * Execute a parsed signal into Bybit futures limit orders.
 *
 * Flow:
 * 1. Fetch symbol metadata (tickSize, qtyStep)
 * 2. Calculate quantity: MAX_LOSS_PER_TRADE / |entry - sl|
 * 3. Pick TP level based on STRATEGY_TYPE
 * 4. If REAL_TRADE: close existing position → entry → TP → SL
 * 5. If not REAL_TRADE: log dry-run summary
 */
export const executeSignal = async (parsed: ParsedSignal): Promise<ExecutionResult> => {
    const details: string[] = [];
    const dryRun = !realTrade;

    // 1. Fetch symbol metadata
    const meta = await getInstrumentsInfo(parsed.symbol);
    if (!meta) {
        return { success: false, symbol: parsed.symbol, side: parsed.side, entryPrice: parsed.entry.price, tpPrice: null, slPrice: parsed.sl.price, qty: 0, dryRun, error: "Failed to fetch symbol metadata", details };
    }

    details.push(`TickSize=${meta.tickSize}, QtyStep=${meta.qtyStep}`);

    // 2. Calculate quantity: qty = maxLossPerTrade / |entry - sl|
    const lossPerUnit = Math.abs(parsed.entry.price - parsed.sl.price);
    if (lossPerUnit <= 0) {
        return { success: false, symbol: parsed.symbol, side: parsed.side, entryPrice: parsed.entry.price, tpPrice: null, slPrice: parsed.sl.price, qty: 0, dryRun, error: "SL equals entry — cannot calculate quantity", details };
    }

    let qty = maxLossPerTrade / lossPerUnit;
    qty = roundUpToStep(qty, meta.qtyStep);
    if (qty < meta.minOrderQty) {
        qty = roundUpToStep(meta.minOrderQty, meta.qtyStep);
        details.push(`Qty bumped to min: ${qty}`);
    }

    details.push(`Calculated qty=${qty} (maxLoss=$${maxLossPerTrade}, loss/unit=${lossPerUnit})`);

    // 3. Pick TP
    const selectedTp = pickTP(parsed.tp);
    const tpPrice = selectedTp ? roundToStep(selectedTp.price, meta.tickSize) : null;
    const entryPrice = roundToStep(parsed.entry.price, meta.tickSize);
    const slPrice = roundToStep(parsed.sl.price, meta.tickSize);
    const side = parsed.side === "LONG" ? "Buy" as const : "Sell" as const;

    if (dryRun) {
        details.push(`[DRY-RUN] Would submit: ${parsed.symbol} ${side} qty=${qty} entry=${entryPrice} SL=${slPrice} TP=${tpPrice ?? "N/A"}`);
        logger.info(`[DRY-RUN] ${parsed.symbol} ${parsed.side}: entry=${entryPrice}, SL=${slPrice}, TP=${tpPrice}, qty=${qty}`);
        return { success: true, symbol: parsed.symbol, side: parsed.side, entryPrice, tpPrice, slPrice, qty, dryRun, details };
    }

    // 4. REAL TRADE
    // Cancel ALL open orders for this symbol (both Buy and Sell, TP/SL)
    details.push("Cancelling all open orders...");
    await cancelAllOrders(parsed.symbol);
    details.push("Open orders cancelled");

    // Close any existing position (use actual position side, not signal direction)
    const positions = await getPositions(parsed.symbol);
    if (positions.length > 0) {
        const existingSide = positions[0].side as "Buy" | "Sell";
        details.push(`Existing ${existingSide} position found, closing...`);
        const closed = await closePosition(parsed.symbol, existingSide);
        if (!closed) {
            details.push("Failed to close existing position — aborting");
            return { success: false, symbol: parsed.symbol, side: parsed.side, entryPrice, tpPrice, slPrice, qty, dryRun, error: "Failed to close existing position", details };
        }
        details.push(`Existing ${existingSide} position closed`);
        await delay(DELAY_MS);
    }

    // Submit entry order with TP + SL attached (single API call)
    const entryId = `ENTRY-${Date.now()}`;
    const entryOk = await submitOrder({
        category: "linear",
        symbol: parsed.symbol,
        side,
        orderType: "Limit",
        qty: String(qty),
        price: String(entryPrice),
        timeInForce: "GTC",
        orderLinkId: entryId,
        reduceOnly: false,
        positionIdx: getPositionIdx(side),
        takeProfit: tpPrice !== null ? String(tpPrice) : undefined,
        stopLoss: String(slPrice),
        tpslMode: "Partial",
        tpOrderType: "Limit",
        slOrderType: "Limit",
        tpLimitPrice: tpPrice !== null ? String(tpPrice) : undefined,
        slLimitPrice: String(slPrice)
    });

    if (!entryOk) {
        return { success: false, symbol: parsed.symbol, side: parsed.side, entryPrice, tpPrice, slPrice, qty, dryRun, error: "Entry order failed", details };
    }
    details.push(`Entry + TP/SL placed: entry=${entryPrice} SL=${slPrice} TP=${tpPrice ?? "N/A"}`);

    return {
        success: true,
        symbol: parsed.symbol,
        side: parsed.side,
        entryPrice,
        tpPrice,
        slPrice,
        qty,
        dryRun,
        details
    };
};

export type CancelResult = {
    success: boolean;
    dryRun: boolean;
    symbol: string;
    message: string;
};

/**
 * Cancel all open orders + close position for a symbol (followup signal).
 */
export const cancelOrderAndClose = async (symbol: string): Promise<CancelResult> => {
    const dryRun = !realTrade;

    if (dryRun) {
        logger.info(`[DRY-RUN] Would cancel orders & close position for: ${symbol}`);
        return { success: true, dryRun, symbol, message: `[DRY-RUN] Would cancel & close ${symbol}` };
    }

    // Cancel all open orders
    await cancelAllOrders(symbol);

    // Close position
    const positions = await getPositions(symbol);
    if (positions.length > 0) {
        const side = positions[0].side as "Buy" | "Sell";
        const ok = await closePosition(symbol, side);
        if (!ok) {
            return { success: false, dryRun, symbol, message: `Failed to close ${symbol} position` };
        }
        return { success: true, dryRun, symbol, message: `Cancelled orders & closed ${symbol} position` };
    }

    return { success: true, dryRun, symbol, message: `Cancelled orders for ${symbol} (no open position)` };
};