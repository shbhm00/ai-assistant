import { describe, expect, it } from 'vitest';
import { SensitiveDataFilter } from './SensitiveDataFilter';

describe('SensitiveDataFilter', () => {
  const filter = new SensitiveDataFilter({
    blockedFields: ['customSecret'],
  });

  it('redacts default sensitive keys case-insensitively', () => {
    const result = filter.redact({
      user: 'a',
      password: 'p',
      accessToken: 't',
      nested: { refreshToken: 'r', Authorization: 'Bearer x' },
    });

    expect(result).toEqual({
      user: 'a',
      password: '[REDACTED]',
      accessToken: '[REDACTED]',
      nested: {
        refreshToken: '[REDACTED]',
        Authorization: '[REDACTED]',
      },
    });
  });

  it('redacts custom blocked fields', () => {
    expect(filter.redact({ customSecret: 'x', ok: 1 })).toEqual({
      customSecret: '[REDACTED]',
      ok: 1,
    });
  });

  it('supports custom redactor', () => {
    const custom = new SensitiveDataFilter({
      customRedactor: (value, _path, key) =>
        key === 'email' ? '[EMAIL]' : undefined,
    });
    expect(custom.redact({ email: 'a@b.com', name: 'n' })).toEqual({
      email: '[EMAIL]',
      name: 'n',
    });
  });

  it('handles arrays', () => {
    expect(filter.redact([{ apiKey: 'k' }, { x: 1 }])).toEqual([
      { apiKey: '[REDACTED]' },
      { x: 1 },
    ]);
  });
});
