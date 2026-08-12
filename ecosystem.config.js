/**
 * PM2 process definition for the production server.
 * Used by `npm run deploy` / `npm run redeploy`.
 * PORT and all other settings come from the server's .env file.
 */
module.exports = {
  apps: [
    {
      name: 'smartcare-api',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
