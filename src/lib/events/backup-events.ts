import { EventEmitter } from 'events';

export type BackupEventStatus = 'running' | 'success' | 'failed';

export type BackupEvent = {
  type: 'backup.started' | 'backup.finished';
  historyId: string;
  configId: string;
  backupName: string;
  status: BackupEventStatus;
  errorMessage?: string;
  mailboxPending?: boolean;
  at: string;
};

const EVENT_NAME = 'backup';

type GlobalWithBus = typeof globalThis & {
  __lazybackupBackupEvents?: EventEmitter;
};

function getBus(): EventEmitter {
  const g = globalThis as GlobalWithBus;
  if (!g.__lazybackupBackupEvents) {
    const bus = new EventEmitter();
    bus.setMaxListeners(100);
    g.__lazybackupBackupEvents = bus;
  }
  return g.__lazybackupBackupEvents;
}

export function emitBackupEvent(event: BackupEvent): void {
  getBus().emit(EVENT_NAME, event);
}

export function subscribeBackupEvents(cb: (event: BackupEvent) => void): () => void {
  const bus = getBus();
  bus.on(EVENT_NAME, cb);
  return () => {
    bus.off(EVENT_NAME, cb);
  };
}
