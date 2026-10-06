import { createTestApp, TestContext } from './helpers';

describe('AppController (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('/health (GET)', () => {
    return ctx
      .api()
      .get('/health')
      .expect(200)
      .expect({ status: 'ok', service: 'smartcare-api' });
  });
});
