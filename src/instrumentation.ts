import { runMigration } from './lib/db/migrate';
import { initializeServer } from './lib/init';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      console.log('🚀 Server starting - running database migrations...');
      await runMigration();
      console.log('✅ Database migrations completed');
      
      console.log('🚀 Initializing server components...');
      const result = await initializeServer();
      
      if (result.success) {
        console.log('✅ Server components initialized successfully');
      } else {
        console.error('❌ Failed to initialize server components:', result.message);
      }
    } catch (error) {
      console.error('❌ Error during server initialization:', error);
    }
  }
} 
