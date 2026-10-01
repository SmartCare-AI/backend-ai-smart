/**
 * PM2 process definition for the ML triage service (used by deploy.sh).
 * Internal-only: bound to 127.0.0.1, never exposed through nginx.
 */
module.exports = {
  apps: [
    {
      name: 'smartcare-ml',
      cwd: __dirname,
      script: '.venv/bin/uvicorn',
      args: `src.service:app --host 127.0.0.1 --port ${process.env.ML_PORT || 8000}`,
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
    },
  ],
};
