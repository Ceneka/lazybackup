import { initializeScheduler } from './scheduler';

let initialized = false;

export async function initializeServer(force = false) {
  if (initialized && !force) return { success: true, message: 'Server already initialized' };
  
  try {
    console.log('Initializing server...');
    
    // Initialize the scheduler
    await initializeScheduler();
    
    initialized = true;
    console.log('Server initialized successfully');
    return { success: true, message: 'Server initialized successfully' };
  } catch (error) {
    console.error('Failed to initialize server:', error);
    return { 
      success: false, 
      message: error instanceof Error ? error.message : 'Unknown error',
      error
    };
  }
} 
