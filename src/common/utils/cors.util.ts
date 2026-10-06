type OriginCallback = (err: Error | null, allow?: boolean) => void;

/**
 * Turns CORS_ORIGINS into an origin checker shared by REST (Express) and
 * Socket.IO.
 *
 *  - empty / unset → every origin is allowed (development, Flutter web on a
 *    random localhost port).
 *  - comma-separated list → only those origins. `*` is a wildcard inside an
 *    entry, e.g. `http://localhost:*` or `https://*.shifaa.app`.
 *
 * Requests without an Origin header (mobile apps, curl, server-to-server) are
 * not browser cross-origin requests and are always allowed.
 */
export function corsOrigin(
  raw: string | undefined,
): true | ((origin: string | undefined, cb: OriginCallback) => void) {
  const entries = (raw ?? '')
    .split(',')
    .map((e) => e.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (entries.length === 0) return true;

  const patterns = entries.map(
    (entry) =>
      new RegExp(
        '^' +
          entry
            .split('*')
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('[^/]*') +
          '$',
      ),
  );
  return (origin, cb) => {
    if (!origin || patterns.some((p) => p.test(origin))) return cb(null, true);
    cb(null, false);
  };
}
