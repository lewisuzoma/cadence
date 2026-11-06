import { describe, expect, it } from 'vitest';
import {
  courseQuerySchema,
  formatDuration,
  formatTimecode,
  lessonInputSchema,
  loginSchema,
  registerSchema,
  saveProgressSchema,
  slugify,
} from '@cadence/shared';

/**
 * The shared schemas are the contract between client and server, so the rules
 * that matter are asserted directly rather than only through the API.
 */

describe('registerSchema', () => {
  const valid = {
    firstName: 'Ada',
    lastName: 'Okafor',
    email: 'Ada@Cadence.DEV',
    password: 'Password123',
    confirmPassword: 'Password123',
  };

  it('accepts a valid registration and lowercases the email', () => {
    expect(registerSchema.parse(valid).email).toBe('ada@cadence.dev');
  });

  it('requires the passwords to match, reporting it on confirmPassword', () => {
    const result = registerSchema.safeParse({ ...valid, confirmPassword: 'Different1' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['confirmPassword']);
    }
  });

  it('requires a letter and a number in the password', () => {
    expect(
      registerSchema.safeParse({ ...valid, password: 'password', confirmPassword: 'password' })
        .success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ ...valid, password: '12345678', confirmPassword: '12345678' })
        .success,
    ).toBe(false);
  });

  it('requires at least 8 characters', () => {
    expect(
      registerSchema.safeParse({ ...valid, password: 'Pass123', confirmPassword: 'Pass123' })
        .success,
    ).toBe(false);
  });

  it('has no role field at all, so a role cannot be injected', () => {
    const parsed = registerSchema.parse({ ...valid, role: 'ADMIN' });
    expect('role' in parsed).toBe(false);
  });
});

describe('loginSchema', () => {
  it('rejects an invalid email', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
  });
});

describe('courseQuerySchema', () => {
  it('applies defaults', () => {
    const parsed = courseQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.sort).toBe('newest');
  });

  it('coerces the numeric strings that arrive on a query string', () => {
    const parsed = courseQuerySchema.parse({ page: '3', pageSize: '24' });
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(24);
  });

  it('caps pageSize, so a client cannot ask for the whole table', () => {
    expect(courseQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });

  it('treats an empty filter string as absent', () => {
    const parsed = courseQuerySchema.parse({ search: '', category: '' });
    expect(parsed.search).toBeUndefined();
    expect(parsed.category).toBeUndefined();
  });
});

describe('lessonInputSchema', () => {
  const valid = {
    title: 'Validating input with Zod',
    description: 'A lesson',
    videoUrl: 'https://example.test/a.mp4',
    durationSeconds: 860,
  };

  it('accepts a root-relative media path as well as an absolute URL', () => {
    expect(lessonInputSchema.safeParse({ ...valid, videoUrl: '/videos/a.mp4' }).success).toBe(
      true,
    );
  });

  it('rejects a zero or negative duration, which the completion maths divides by', () => {
    expect(lessonInputSchema.safeParse({ ...valid, durationSeconds: 0 }).success).toBe(false);
    expect(lessonInputSchema.safeParse({ ...valid, durationSeconds: -5 }).success).toBe(false);
  });

  it('defaults isPreview to false', () => {
    expect(lessonInputSchema.parse(valid).isPreview).toBe(false);
  });
});

describe('saveProgressSchema', () => {
  it('defaults the event to heartbeat', () => {
    expect(saveProgressSchema.parse({ positionSeconds: 10 }).event).toBe('heartbeat');
  });

  it('rejects a negative position', () => {
    expect(saveProgressSchema.safeParse({ positionSeconds: -1 }).success).toBe(false);
  });

  it('has no completion field: the server decides what a position means', () => {
    const parsed = saveProgressSchema.parse({ positionSeconds: 10, isCompleted: true });
    expect('isCompleted' in parsed).toBe(false);
  });
});

describe('formatting helpers', () => {
  it('formats durations the way the catalog does', () => {
    expect(formatDuration(15600)).toBe('4h 20m');
    expect(formatDuration(860)).toBe('14m 20s');
    expect(formatDuration(45)).toBe('45s');
  });

  it('formats timecodes the way the player does', () => {
    expect(formatTimecode(522)).toBe('08:42');
    expect(formatTimecode(860)).toBe('14:20');
    expect(formatTimecode(3723)).toBe('1:02:03');
  });

  it('slugifies titles', () => {
    expect(slugify('TypeScript for Production APIs')).toBe('typescript-for-production-apis');
    expect(slugify('  Spaces & symbols!  ')).toBe('spaces-symbols');
  });
});
