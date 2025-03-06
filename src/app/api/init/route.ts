import { NextResponse } from 'next/server';
import { initializeServer } from '@/lib/init';

// GET /api/init - Initialize the server
export async function GET() {
  try {
    const result = await initializeServer();
    
    if (result.success) {
      return NextResponse.json({ success: true, message: result.message });
    } else {
      console.error('Failed to initialize server:', result.message);
      return NextResponse.json(
        { success: false, error: result.message },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Unexpected error initializing server:', error);
    return NextResponse.json(
      { success: false, error: 'Unexpected error initializing server' },
      { status: 500 }
    );
  }
} 
