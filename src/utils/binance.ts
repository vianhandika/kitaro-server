import Binance from "node-binance-api";

import process from "node:process";
import logger from "./logger.js";

// Initialize client (prefers env; falls back to testnet constants if missing)
const API_KEY = process.env.BINANCE_API_KEY ?? "";
const API_SECRET = process.env.BINANCE_API_SECRET ?? "";
const USE_TESTNET = (process.env.BINANCE_USE_TESTNET ?? "yes").toLowerCase() === "yes";
const TESTNET_BASE = "https://testnet.binancefuture.com/fapi/";

const binance = new Binance().options({
  APIKEY: API_KEY,
  APISECRET: API_SECRET,
  useServerTime: true,
  recvWindow: 60000,
  urls: USE_TESTNET ? { fapi: TESTNET_BASE } : undefined,
});

// Compute decimal places from a tick/step value (e.g., 0.001 -> 3, 1e-8 -> 8)
const decimalsFromStep = (x: number): number => {
  const s = String(x);
  if (s.includes("e-")) return parseInt(s.split("e-")[1]!, 10);
  const i = s.indexOf(".");
  return i >= 0 ? s.length - i - 1 : 0;
};

// Round DOWN to the nearest valid multiple based on step, avoiding float drift
const roundDownTo = (value: number, step: number): number => {
  const d = decimalsFromStep(step);
  const factor = 10 ** d;
  const valueInt = Math.floor(value * factor + 1e-9);
  const stepInt = Math.round(step * factor);
  const resultInt = Math.floor(valueInt / stepInt) * stepInt;
  return resultInt / factor;
};

const roundToTick = (value: number, tick: number): number => roundDownTo(value, tick);
const roundToStep = (value: number, step: number): number => roundDownTo(value, step);

async function getSymbolFilters(symbol: string): Promise<{ tickSize: number; stepSize: number; minQty: number }> {
  const info = await binance.futuresExchangeInfo();
  const s = info.symbols.find((x: any) => x.symbol === symbol);
  const priceFilter = s.filters.find((f: any) => f.filterType === "PRICE_FILTER");
  const lotFilter = s.filters.find((f: any) => f.filterType === "LOT_SIZE");
  return {
    tickSize: Number(priceFilter.tickSize),
    stepSize: Number(lotFilter.stepSize),
    minQty: Number(lotFilter.minQty ?? 0),
  };
}

async function cancelExistingTpOrders(symbol: string): Promise<void> {
  const open: any[] = await (binance as any).futuresOpenOrders(symbol);
  for (const o of open) {
    const t = String((o as any).type || (o as any).origType || "");
    if (t.includes("TAKE_PROFIT")) {
      try {
        await (binance as any).futuresCancel(symbol, { orderId: (o as any).orderId });
        logger.info(`🧹 Canceled existing TP order id=${(o as any).orderId} type=${t}`);
      } catch (err) {
        logger.warning(`⚠️ Failed to cancel TP order id=${(o as any).orderId}: ${String((err as any)?.body || err)}`);
      }
    }
  }
}

export async function placeDcaStrategyUsd(
  symbol: string,
  side: "BUY" | "SELL",
  usdSize: number,
  dcaSteps: number[],
  tpPct: number,
  slPct: number,
): Promise<void> {
  const startedAt = new Date().toISOString();
  logger.info(`🚀 Strategy start @ ${startedAt} | ${symbol} ${side} $${usdSize}`);
  const markInfo: any = await binance.futuresMarkPrice(symbol);
  const markPrice: number = Number(markInfo.markPrice);
  const { tickSize, stepSize, minQty } = await getSymbolFilters(symbol);
  const price = markPrice;
  const qtyBase = usdSize / price;
  const qtyInitial = Math.max(qtyBase, minQty);
  const qtyRounded = roundToStep(qtyInitial, stepSize);
  const stepDecimals = decimalsFromStep(stepSize);
  const tickDecimals = decimalsFromStep(tickSize);
  const qty = Number(qtyRounded.toFixed(stepDecimals));
  logger.info(`📊 ${symbol} mark price: ${price} | tick size: ${tickSize} (dec=${tickDecimals}) | step size: ${stepSize} (dec=${stepDecimals}) | minQty=${minQty}`);

  // Market entry
  if (side === "BUY") {
    const body = { type: "MARKET", side, symbol, quantity: qty };
    logger.info(`➡️  Submit MARKET BUY: ${JSON.stringify(body)}`);
    await binance.futuresMarketBuy(symbol, qty);
  } else {
    const body = { type: "MARKET", side, symbol, quantity: qty };
    logger.info(`➡️  Submit MARKET SELL: ${JSON.stringify(body)}`);
    await binance.futuresMarketSell(symbol, qty);
  }
  logger.info(`✅ Base MARKET entry placed (${side} ${qty} ${symbol})`);

  const baseEntry = Number(markPrice);
  const entries: number[] = [baseEntry];
  for (const pct of dcaSteps) {
    const adj = side === "BUY" ? (1 - pct / 100) : (1 + pct / 100);
    entries.push(baseEntry * adj);
  }

  const exitSide = side === "BUY" ? "SELL" : "BUY";
  let totalQty = 0;
  let totalCost = 0;
  const client: any = binance;

  // Initial close-position TP after base entry
  const baseExitSide = exitSide;
  const tpBaseTarget = side === "BUY" ? markPrice * (1 + tpPct / 100) : markPrice * (1 - tpPct / 100);
  const tpBaseRoundedNum = roundToTick(tpBaseTarget, tickSize);
  const tpBaseRounded = Number(tpBaseRoundedNum.toFixed(tickDecimals));
  logger.info(`➡️  Submit INITIAL TP (closePosition): { type: "TAKE_PROFIT_MARKET", side: ${baseExitSide}, symbol: ${symbol}, stopPrice: ${tpBaseRounded}, workingType: "MARK_PRICE" }`);
  await client.futuresOrder("TAKE_PROFIT_MARKET", baseExitSide, symbol, undefined, undefined, {
    stopPrice: tpBaseRounded,
    closePosition: true,
    workingType: "MARK_PRICE",
  });
  logger.info(`🎯 Initial TP set → trigger=${tpBaseRounded}`);

  for (let i = 0; i < entries.length; i++) {
    const px = entries[i];
    totalQty = totalQty + qty;
    totalCost = totalCost + (px * qty);
    const priceRoundedNum = roundToTick(px, tickSize);
    const priceRounded = Number(priceRoundedNum.toFixed(tickDecimals));
    // Recalculate average entry after this DCA and plan TP accordingly
    const avgEntry = totalCost / totalQty;
    const tpTarget = side === "BUY" ? avgEntry * (1 + tpPct / 100) : avgEntry * (1 - tpPct / 100);
    const tpLimitNum = roundToTick(tpTarget, tickSize);
    const tpLimit = Number(tpLimitNum.toFixed(tickDecimals));

    if (i > 0) {
      const body = { type: "LIMIT", side, symbol, quantity: qty, price: priceRounded, timeInForce: "GTC" };
      logger.info(`➡️  Submit DCA LIMIT: ${JSON.stringify(body)}`);
      await client.futuresOrder("LIMIT", side, symbol, qty, priceRounded, {
        timeInForce: "GTC",
      });
      logger.info(`📥 DCA ${i} limit placed @ ${priceRounded}`);
    }

    // Plan TP for DCA as STOP-LIMIT that triggers at the DCA price; keep one TP active
    if (i > 0) {
      await cancelExistingTpOrders(symbol);
      const markInfo2: any = await binance.futuresMarkPrice(symbol);
      const curMark = Number(markInfo2.markPrice);
      const dcaTrigger = priceRounded;
      const wouldTriggerNow = exitSide === "BUY" ? curMark >= dcaTrigger : curMark <= dcaTrigger;

      if (wouldTriggerNow) {
        const limBody = { type: "LIMIT", side: exitSide, symbol, quantity: totalQty, price: tpLimit, timeInForce: "GTC", reduceOnly: true };
        logger.info(`➡️  Submit immediate TP LIMIT: ${JSON.stringify(limBody)} (mark=${curMark})`);
        await client.futuresOrder("LIMIT", exitSide, symbol, totalQty, tpLimit, {
          timeInForce: "GTC",
          reduceOnly: true,
        });
        logger.info(`🎯 TP LIMIT active → price=${tpLimit} qty=${totalQty}`);
      } else {
        const offset = tickSize;
        const adjustedTrigger = exitSide === "BUY" ? dcaTrigger + offset : dcaTrigger - offset;
        const tpBody2 = { type: "STOP", side: exitSide, symbol, stopPrice: adjustedTrigger, price: tpLimit, quantity: totalQty, timeInForce: "GTC", reduceOnly: true, workingType: "MARK_PRICE" };
        logger.info(`➡️  Submit TP STOP-LIMIT: ${JSON.stringify(tpBody2)} (mark=${curMark})`);
        await client.futuresOrder("STOP", exitSide, symbol, totalQty, tpLimit, {
          stopPrice: adjustedTrigger,
          timeInForce: "GTC",
          reduceOnly: true,
          workingType: "MARK_PRICE",
        });
        logger.info(`🎯 Planned STOP-LIMIT for DCA ${i} → stop=${adjustedTrigger} limit=${tpLimit} qty=${totalQty}`);
      }
    }
  }

  const slTarget = side === "BUY" ? baseEntry * (1 - slPct / 100) : baseEntry * (1 + slPct / 100);
  const slRoundedNum = roundToTick(slTarget, tickSize);
  const slRounded = Number(slRoundedNum.toFixed(tickDecimals));

  const slBody = { type: "STOP_MARKET", side: exitSide, symbol, trigger: slRounded, closePosition: true, workingType: "MARK_PRICE" };
  logger.info(`➡️  Submit SL: ${JSON.stringify(slBody)}`);
  await client.futuresOrder("STOP_MARKET", exitSide, symbol, undefined, undefined, {
    stopPrice: slRounded,
    closePosition: true,
    workingType: "MARK_PRICE",
  });
  logger.info(`🛑 Stop-loss placed @ ${slRounded}`);
  logger.info(`✅ All ${USE_TESTNET ? "TESTNET" : "LIVE"} orders placed for ${symbol}: MARKET entry + DCA + TP + SL`);
}