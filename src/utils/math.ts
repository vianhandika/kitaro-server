const EPS = 1e-12;

/** Round value DOWN/UP to the nearest valid step (e.g., tickSize or qtyStep). */
export const roundToStep = (val: number, step: number): number =>
    Math.round((val + EPS) / step) * step;

/** Round value UP to the nearest valid step (ensures min notional / min qty is met). */
export const roundUpToStep = (val: number, step: number): number =>
    Math.ceil((val + EPS) / step) * step;