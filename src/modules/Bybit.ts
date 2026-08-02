import { createHmac } from "node:crypto";
import { bybitApiKey, bybitApiSecret, bybitBaseUrl, getPositionIdx } from "../utils/env.js";
import type { SymbolMeta } from "../typings/index.js";
import logger from "../utils/logger.js";

type BybitResponse<T> = {
    retCode: number;
    retMsg: string;
    result: T;
    time: number;
};

// ── HMAC signing ──────────────────────────────────────────

const sign = (timestamp: string, recvWindow: string, params: string): string => {
    const signStr = `${timestamp}${bybitApiKey}${recvWindow}${params}`;
    return createHmac("sha256", bybitApiSecret).update(signStr).digest("hex");
};

const bybitFetch = async <T>(
    method: "GET" | "POST",
    endpoint: string,
    body?: Record<string, unknown>
): Promise<BybitResponse<T>> => {
    const timestamp = Date.now().toString();
    const recvWindow = "5000";

    // Extract query string from endpoint for GET signing
    const queryIndex = endpoint.indexOf("?");
    const queryString = method === "GET" && queryIndex !== -1 ? endpoint.slice(queryIndex + 1) : "";

    const params = body ? JSON.stringify(body) : queryString;
    const signature = sign(timestamp, recvWindow, params);

    const headers: Record<string, string> = {
        "X-BAPI-API-KEY": bybitApiKey,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-SIGN": signature,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "Content-Type": "application/json"
    };

    const url = `${bybitBaseUrl}${endpoint}`;
    const options: RequestInit = { method, headers };
    if (method === "POST" && body) {
        options.body = params;
    }

    const response = await fetch(url, options);
    const data = (await response.json()) as BybitResponse<T>;

    if (data.retCode !== 0) {
        logger.error(`Bybit API error [${endpoint}]: ${data.retCode} — ${data.retMsg}`);
    }

    return data;
};

// ── Public API ────────────────────────────────────────────

/**
 * Fetch symbol metadata: tickSize, qtyStep, minOrderQty, minNotionalUSD.
 */
export const getInstrumentsInfo = async (symbol: string): Promise<SymbolMeta | null> => {
    const res = await bybitFetch<{
        category: string;
        list: Array<{
            symbol: string;
            lotSizeFilter: { qtyStep: string; maxOrderQty: string; minOrderQty: string };
            priceFilter: { tickSize: string };
            riskParameters: { limitParameter: string };
        }>;
    }>("GET", `/v5/market/instruments-info?category=linear&symbol=${symbol}`);

    if (res.retCode !== 0 || !res.result.list || res.result.list.length === 0) {
        logger.error(`Failed to get instruments info for ${symbol}: ${res.retMsg}`);
        return null;
    }

    const info = res.result.list[0];

    return {
        symbol: info.symbol,
        tickSize: Number.parseFloat(info.priceFilter.tickSize),
        qtyStep: Number.parseFloat(info.lotSizeFilter.qtyStep),
        minOrderQty: Number.parseFloat(info.lotSizeFilter.minOrderQty),
        minNotionalUSD: 5 // Bybit default minimum notional
    };
};

// ── Trading API ───────────────────────────────────────────

export type BybitOrderPayload = {
    category: "linear";
    symbol: string;
    side: "Buy" | "Sell";
    orderType: "Limit";
    qty: string;
    price: string;
    timeInForce: "GTC";
    orderLinkId: string;
    reduceOnly: boolean;
    positionIdx: 0 | 1 | 2;
    takeProfit?: string;
    stopLoss?: string;
    tpslMode?: "Partial";
    tpOrderType?: "Limit";
    slOrderType?: "Limit";
    tpLimitPrice?: string;
    slLimitPrice?: string;
};

export type BybitSLPayload = {
    category: "linear";
    symbol: string;
    positionIdx: 0;
    stopLoss: string;
};

/**
 * Submit a limit order.
 */
export const submitOrder = async (payload: BybitOrderPayload): Promise<boolean> => {
    logger.info(`Submitting order: ${payload.side} ${payload.qty} ${payload.symbol} @ ${payload.price} [${payload.orderLinkId}] reduceOnly=${payload.reduceOnly}`);

    const res = await bybitFetch<{ orderId: string; orderLinkId: string }>(
        "POST",
        "/v5/order/create",
        payload as unknown as Record<string, unknown>
    );

    if (res.retCode !== 0) {
        logger.error(`Order failed: ${res.retMsg}`);
        return false;
    }

    logger.info(`Order placed: ${res.result.orderId}`);
    return true;
};

/**
 * Set stop-loss via setTradingStop.
 */
export const setTradingStop = async (payload: BybitSLPayload): Promise<boolean> => {
    logger.info(`Setting SL: ${payload.symbol} @ ${payload.stopLoss}`);

    const res = await bybitFetch<object>(
        "POST",
        "/v5/position/trading-stop",
        payload as unknown as Record<string, unknown>
    );

    if (res.retCode !== 0) {
        logger.error(`SL set failed: ${res.retMsg}`);
        return false;
    }

    logger.info("Stop-loss set");
    return true;
};

/**
 * Get open positions for a symbol.
 */
export const getPositions = async (symbol: string): Promise<Array<{ symbol: string; side: string; size: string }>> => {
    const res = await bybitFetch<{
        category: string;
        list: Array<{ symbol: string; side: string; size: string }>;
    }>("GET", `/v5/position/list?category=linear&symbol=${symbol}`);

    if (res.retCode !== 0) {
        return [];
    }

    return res.result.list.filter((p) => Number.parseFloat(p.size) > 0);
};

/**
 * Close position with a market order (opposite side).
 */
export const closePosition = async (symbol: string, side: "Buy" | "Sell"): Promise<boolean> => {
    logger.info(`Closing existing position: ${symbol}`);

    const closeSide = side === "Buy" ? "Sell" : "Buy";

    const res = await bybitFetch<{ orderId: string }>(
        "POST",
        "/v5/order/create",
        {
            category: "linear",
            symbol,
            side: closeSide,
            orderType: "Market",
            qty: "0", // 0 means close entire position
            timeInForce: "IOC",
            reduceOnly: true,
            positionIdx: getPositionIdx(side)
        }
    );

    if (res.retCode !== 0) {
        logger.error(`Close position failed: ${res.retMsg}`);
        return false;
    }

    logger.info(`Position closed: ${res.result.orderId}`);
    return true;
};

/**
 * Cancel all open orders for a symbol.
 */
export const cancelAllOrders = async (symbol: string): Promise<boolean> => {
    logger.info(`Cancelling all open orders for: ${symbol}`);

    const res = await bybitFetch<{
        list: Array<{ orderId: string }>;
    }>("GET", `/v5/order/realtime?category=linear&symbol=${symbol}`);

    if (res.retCode !== 0 || !res.result.list || res.result.list.length === 0) {
        logger.info(`No open orders to cancel for ${symbol}`);
        return true; // nothing to cancel = success
    }

    for (const order of res.result.list) {
        await bybitFetch<object>(
            "POST",
            "/v5/order/cancel",
            { category: "linear", symbol, orderId: order.orderId }
        );
    }

    logger.info(`Cancelled ${res.result.list.length} orders for ${symbol}`);
    return true;
};