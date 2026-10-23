import { describe, expect, it } from 'vitest';
import { redactUrl, requestLogSerializers } from '../../src/lib/redact.js';

describe('request log lines', () => {
  it('redact webhook secrets from URLs and keep everything else', () => {
    expect(redactUrl('/api/webhooks/7d3c/abcDEF_123')).toBe('/api/webhooks/7d3c/[redacted]');
    expect(redactUrl('/api/webhooks/7d3c/abcDEF_123?wait=true')).toBe(
      '/api/webhooks/7d3c/[redacted]?wait=true',
    );
    expect(redactUrl('/api/webhooks/7d3c/abc/messages/m1')).toBe(
      '/api/webhooks/7d3c/[redacted]/messages/m1',
    );
    expect(redactUrl('/api/webhooks/7d3c')).toBe('/api/webhooks/7d3c');
    expect(redactUrl('/api/chats/c1/messages')).toBe('/api/chats/c1/messages');
  });

  it('never include headers (session tokens) in the serialized request', () => {
    const line = requestLogSerializers.req({
      id: 1,
      method: 'POST',
      url: '/api/webhooks/w/secret',
      remoteAddress: '203.0.113.5',
      headers: { authorization: 'Bearer session-token' },
    } as never);
    expect(line).toEqual({
      id: 1,
      method: 'POST',
      url: '/api/webhooks/w/[redacted]',
      remoteAddress: '203.0.113.5',
    });
    expect(JSON.stringify(line)).not.toContain('session-token');
  });
});
