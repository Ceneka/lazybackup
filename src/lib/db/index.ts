import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

// Create a database client
const client = createClient({
  url: process.env.DATABASE_URL || 'file:./data.db',
});

// Create a drizzle instance
export const db = drizzle(client, { schema }); 
