import { subscribeBackupEvents, type BackupEvent } from '@/lib/events/backup-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function encodeSse(chunk: string): Uint8Array {
  return new TextEncoder().encode(chunk);
}

function formatEvent(event: BackupEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** GET /api/events — SSE stream of backup start/finish (session or API token). */
export async function GET(request: Request) {
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const sendRaw = (chunk: string) => {
        try {
          controller.enqueue(encodeSse(chunk));
        } catch {
          cleanup?.();
        }
      };

      const unsub = subscribeBackupEvents((event) => {
        sendRaw(formatEvent(event));
      });

      const ping = setInterval(() => {
        sendRaw(': ping\n\n');
      }, 25_000);

      cleanup = () => {
        clearInterval(ping);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      request.signal.addEventListener('abort', () => cleanup?.(), { once: true });
      sendRaw(': connected\n\n');
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
