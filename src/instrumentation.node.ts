/**
 * Node-only startup (migrations + cron). Loaded from instrumentation.ts with
 * webpackIgnore so Next does not bundle child_process/fs/ssh into the
 * instrumentation graph.
 */
export async function registerNode(): Promise<void> {
  const { runMigration } = await import('./lib/db/migrate');
  const { initializeScheduler } = await import('./lib/scheduler');

  console.log('🚀 Server starting - running database migrations...');
  await runMigration();
  console.log('✅ Database migrations completed');

  console.log('🚀 Initializing server components...');
  await initializeScheduler();
  console.log('✅ Server components initialized successfully');
}
