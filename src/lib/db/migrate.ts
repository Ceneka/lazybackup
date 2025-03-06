import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { join } from 'path';

// Create a database client
const client = createClient({
  url: process.env.DATABASE_URL || 'file:./data.db',
});

// Create a drizzle instance
const db = drizzle(client);

// Run migrations
async function main() {
  console.log('Running migrations...');
  
  try {
    await migrate(db, { migrationsFolder: join(process.cwd(), 'migrations') });
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Error running migrations:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

main(); 
