export async function register() {
  // `next build` executes this hook; migrations + cron must not run there or the build can hang
  // (DB missing/wrong path, scheduler, collecting route data, etc.).
  const isNextProductionBuild = process.env.NEXT_PHASE === 'phase-production-build';
  const isNpmBuildScript = process.env.npm_lifecycle_event === 'build';
  if (isNextProductionBuild || isNpmBuildScript) {
    return;
  }

  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  try {
    const { registerNode } = await import('./instrumentation.node');
    await registerNode();
  } catch (error) {
    console.error('❌ Error during server initialization:', error);
  }
}
