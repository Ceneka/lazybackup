import { NextResponse } from 'next/server';

/**
 * JSON 404 for unknown `/api/*` paths.
 *
 * Static and more specific routes always win over this catch-all, so it only
 * answers paths nothing else handles (previously the app returned the HTML
 * not-found page, which broke API clients). Middleware still runs first, so
 * the app-password gate is unchanged.
 */
function apiNotFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export {
  apiNotFound as GET,
  apiNotFound as POST,
  apiNotFound as PUT,
  apiNotFound as PATCH,
  apiNotFound as DELETE,
};
