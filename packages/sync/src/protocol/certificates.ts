/**
 * Epoch Membership Certificate Verification Re-Exports & Monotonicity (G32-1)
 */
export * from "./lifecycle.js";

import type { EpochMembershipCertificate } from "./types.js";

export function checkCertificateMonotonicity(
  currentCert: EpochMembershipCertificate,
  newCert: EpochMembershipCertificate
): { ok: boolean; code?: string; detail?: string } {
  for (const [streamKey, currentFloor] of Object.entries(currentCert.baselineStableFrontier)) {
    if (!(streamKey in newCert.baselineStableFrontier)) {
      // G32-1: Streams of earlier, already-closed epochs are not repeated and not compared
      continue;
    }
    const newFloor = newCert.baselineStableFrontier[streamKey] ?? 0;
    if (newFloor < currentFloor) {
      return {
        ok: false,
        code: "SYNC_EPOCH_TRANSITION_NOT_READY",
        detail: `Baseline floor for stream ${streamKey} decreased from ${currentFloor} to ${newFloor}`,
      };
    }
  }
  return { ok: true };
}
