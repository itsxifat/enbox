/**
 * What request log lines may contain. Headers never (the Authorization header carries session
 * tokens), and URLs without secrets: a webhook's execute URL ends in its token.
 */

/** `/api/webhooks/<id>/<token>[/…]` → `/api/webhooks/<id>/[redacted][/…]`. */
export function redactUrl(url: string): string {
  return url.replace(/^(\/api\/webhooks\/[^/?#]+\/)[^/?#]+/, '$1[redacted]');
}

interface LoggedRequest {
  id?: unknown;
  method?: string;
  url?: string;
  remoteAddress?: string;
}

/** pino-http serializers: method, redacted URL and address for requests; status for responses. */
export const requestLogSerializers = {
  req: (req: LoggedRequest) => ({
    id: req.id,
    method: req.method,
    url: redactUrl(req.url ?? ''),
    remoteAddress: req.remoteAddress,
  }),
  res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
};
