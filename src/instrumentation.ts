
export async function register() {

  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    console.error('❌ Not server environment');
  }

  const { runMigration } = await import('./lib/db/migrate');
  const { initializeScheduler } = await import('./lib/scheduler');


  try {
    console.log('🚀 Server starting - running database migrations...');
    await runMigration();
    console.log('✅ Database migrations completed');

    console.log('🚀 Initializing server components...');

    await initializeScheduler();

    console.log('✅ Server components initialized successfully');
  } catch (error) {
    console.error('❌ Error during server initialization:', error);
  }
}

