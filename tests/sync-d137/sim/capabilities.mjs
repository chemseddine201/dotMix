/**
 * Capability checks for protocol features (T-31.12, T-31.13)
 */
export function checkCrashRestartCapability() {
  return {
    supported: true,
    reason: "Supported via T-31.12 (StoreBackend and boot recovery)",
  };
}

export function checkDropRecoveryCapability() {
  return {
    supported: true,
    reason: "Supported via T-31.13 (anti-entropy range pull)",
  };
}

