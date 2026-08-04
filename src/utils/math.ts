const EPS = 1e-12;

/**
 * Derive required decimal places from a step size.
 * e.g., 0.001 → 3, 0.1 → 1, 1 → 0, 0.5 → 1, 10 → 0
 */
export const decimalsFromStep = (step: number): number => {
    const str = step.toExponential();
    const match = /e-(\d+)/.exec(str);
    return match ? Number.parseInt(match[1], 10) : 0;
};

/**
 * Round value DOWN/UP to the nearest valid step (e.g., tickSize or qtyStep).
 */
export const roundToStep = (val: number, step: number): number =>
    Math.round((val + EPS) / step) * step;

/**
 * Round value UP to the nearest valid step (ensures min notional / min qty is met).
 */
export const roundUpToStep = (val: number, step: number): number =>
    Math.ceil((val + EPS) / step) * step;

/**
 * Round to step AND format as a clean string matching step precision.
 * Safe for Bybit API (avoids IEEE 754 artifacts like "1590.3000000000002").
 */
export const roundToStepStr = (val: number, step: number): string => {
    const decimals = decimalsFromStep(step);
    return roundToStep(val, step).toFixed(decimals);
};

/**
 * Round up to step AND format as a clean string matching step precision.
 */
export const roundUpToStepStr = (val: number, step: number): string => {
    const decimals = decimalsFromStep(step);
    return roundUpToStep(val, step).toFixed(decimals);
};