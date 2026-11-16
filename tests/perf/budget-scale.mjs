/**
 * Multiplier for wall-clock performance budgets.
 * Local runs use 1. CI sets MIX_PERF_BUDGET_SCALE (for example 2) because shared 2-core runners are
 * slower and noisier; a regression larger than the scale still fails.
 */
import process from "node:process";

const configuredScale = Number(process.env.MIX_PERF_BUDGET_SCALE ?? "1");

export const perfBudgetScale = Number.isFinite(configuredScale) && configuredScale >= 1 ? configuredScale : 1;
