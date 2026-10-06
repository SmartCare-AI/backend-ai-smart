import { corsOrigin } from './cors.util';

function allows(raw: string, origin: string | undefined): boolean {
  const checker = corsOrigin(raw);
  if (checker === true) return true;
  let result = false;
  checker(origin, (_err, allow) => (result = !!allow));
  return result;
}

describe('corsOrigin', () => {
  it('allows everything when unset', () => {
    expect(corsOrigin('')).toBe(true);
    expect(corsOrigin(undefined)).toBe(true);
  });

  it('matches exact origins and wildcards', () => {
    const list = 'https://admin.shifaa.app, http://localhost:*';
    expect(allows(list, 'https://admin.shifaa.app')).toBe(true);
    expect(allows(list, 'http://localhost:53122')).toBe(true);
    expect(allows(list, 'https://evil.example')).toBe(false);
    expect(allows(list, 'https://admin.shifaa.app.evil.example')).toBe(false);
  });

  it('allows requests without an Origin header (mobile apps)', () => {
    expect(allows('https://admin.shifaa.app', undefined)).toBe(true);
  });
});
