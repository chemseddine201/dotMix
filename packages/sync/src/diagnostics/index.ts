import { signal, type Signal } from '@dotmix/runtime';
import type { D137Engine } from '../protocol/engine.js';

export interface DiagnosticEventRecord {
  code: string;
  timestamp: number;
  detail: string;
  payloadPreview?: string;
}

export interface SanitizedQuarantineEntry {
  identifier: string;
  replicaIdentifier: string;
  sequenceNumber: number;
  reasonCode: string;
  tierLevel: number;
  timestamp: number;
  boundedPreview: string;
}

export interface DiagnosticsController {
  diagnostics: Signal<DiagnosticEventRecord[]>;
  recordDiagnosticEvent: (code: string, detail: string, rawPayload?: unknown) => void;
  getQuarantineInspector: () => QuarantineInspector;
}

export class QuarantineInspector {
  private readonly engineInstance: D137Engine;

  constructor(engineInstance: D137Engine) {
    this.engineInstance = engineInstance;
  }

  public getQuarantinedEntries(): SanitizedQuarantineEntry[] {
    const rawQuarantineMap = this.engineInstance.quarantineJournal;
    const sanitizedEntriesList: SanitizedQuarantineEntry[] = [];

    for (const [keyIdentifier, record] of rawQuarantineMap.entries()) {
      const rawPreview = typeof record.offendingPayloadPreview === 'string'
        ? record.offendingPayloadPreview
        : JSON.stringify(record.offendingPayloadPreview ?? '');
      const boundedPreview = rawPreview.length > 80 ? rawPreview.slice(0, 77) + '...' : rawPreview;

      sanitizedEntriesList.push({
        identifier: keyIdentifier,
        replicaIdentifier: record.collectionId,
        sequenceNumber: record.quarantineSeq,
        reasonCode: record.reasonCode,
        tierLevel: record.priorityTier,
        timestamp: record.recordedAtLogicalStep,
        boundedPreview
      });
    }

    return sanitizedEntriesList;
  }

  public getEntryCount(): number {
    return this.engineInstance.quarantineJournal.size;
  }

  public clearQuarantinedEntries(): void {
    this.engineInstance.quarantineJournal.clear();
  }

  private sanitizePayload(operationRecord: unknown): string {
    if (!operationRecord || typeof operationRecord !== 'object') {
      return '';
    }
    const recordCandidate = operationRecord as Record<string, unknown>;
    const summaryObject = {
      kind: recordCandidate.kind,
      replicaId: recordCandidate.replicaId,
      seq: recordCandidate.seq,
      externalId: recordCandidate.externalId
    };
    const serializedString = JSON.stringify(summaryObject);
    if (serializedString.length > 80) {
      return serializedString.slice(0, 77) + '...';
    }
    return serializedString;
  }
}

export function createDiagnosticsController(engineInstance: D137Engine): DiagnosticsController {
  const diagnosticsSignalInstance = signal<DiagnosticEventRecord[]>([]);

  const recordDiagnosticEvent = (code: string, detail: string, rawPayload?: unknown) => {
    let payloadPreview: string | undefined = undefined;
    if (rawPayload !== undefined) {
      const serialized = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);
      payloadPreview = serialized.length > 64 ? serialized.slice(0, 61) + '...' : serialized;
    }

    const newRecord: DiagnosticEventRecord = {
      code,
      timestamp: Date.now(),
      detail,
      ...(payloadPreview !== undefined ? { payloadPreview } : {})
    };

    const currentList = diagnosticsSignalInstance();
    const updatedList = [...currentList.slice(-99), newRecord];
    diagnosticsSignalInstance.set(updatedList);
  };

  const quarantineInspector = new QuarantineInspector(engineInstance);

  return {
    diagnostics: diagnosticsSignalInstance,
    recordDiagnosticEvent,
    getQuarantineInspector: () => quarantineInspector
  };
}
