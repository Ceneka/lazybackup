/**
 * Node-only startup (migrations + cron). Loaded from instrumentation.ts with
 * webpackIgnore so Next does not bundle child_process/fs/ssh into the
 * instrumentation graph.
 */
export async function registerNode(): Promise<void> {
  const { runMigration } = await import('./lib/db/migrate');
  const { markStaleRunningBackups } = await import('./lib/backup/mark-stale-running');
  const { initializeScheduler } = await import('./lib/scheduler');
  const { startPeerSyncWorker } = await import('./lib/peer/sync-worker');

  console.log('🚀 Server starting - running database migrations...');
  await runMigration();
  console.log('✅ Database migrations completed');

  const staleCount = await markStaleRunningBackups();
  if (staleCount > 0) {
    console.log(`⚠️ Marked ${staleCount} stale running backup(s) as failed`);
  }

  console.log('🚀 Initializing server components...');
  await initializeScheduler();
  startPeerSyncWorker();
  console.log('✅ Server components initialized successfully');
}
