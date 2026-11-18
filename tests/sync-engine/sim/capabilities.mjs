/**
 * Capability checks for protocol features
 */
export function checkCrashRestartCapability() {
  return {
    supported: true,
    reason: "Supported via (StoreBackend and boot recovery)",
  };
}

export function checkDropRecoveryCapability() {
  return {
    supported: true,
    reason: "Supported via (anti-entropy range pull)",
  };
}

