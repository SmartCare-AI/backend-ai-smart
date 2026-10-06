/**
 * Runs before every e2e test file. The suite TRUNCATES the database it runs
 * against, so it refuses to start unless TEST_DATABASE_URL points at a
 * database whose name contains "test".
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/smartcare_test npm run test:e2e
 */
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    'Set TEST_DATABASE_URL to a disposable database (its name must contain "test"). Run `npx prisma migrate deploy` against it first.',
  );
}
if (!/test/i.test(new URL(url).pathname)) {
  throw new Error(
    `Refusing to run e2e tests against "${new URL(url).pathname}": the database name must contain "test".`,
  );
}

// process.env wins over .env (dotenv never overrides existing variables).
process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';
process.env.THROTTLE_DISABLED = 'true';
process.env.REDIS_URL = '';
process.env.AI_SERVICE_URL = ''; // deterministic rules engine
process.env.MAIL_PASSWORD = ''; // emails print to the console
process.env.FIREBASE_CLIENT_EMAIL = '';
process.env.FIREBASE_PRIVATE_KEY = '';
process.env.STORAGE_DRIVER = 'local';
process.env.CORS_ORIGINS = '';
