import { describe, expect, it } from 'vitest';
import { databaseWarnings } from '../../src/config/dbChecks';

const pooled = 'postgresql://u:secret@ep-cool-name-123456-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&connect_timeout=15';
const direct = 'postgresql://u:secret@ep-cool-name-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&connect_timeout=15';

describe('databaseWarnings', () => {
  it('is silent for a correct Neon setup', () => {
    expect(databaseWarnings(pooled, direct)).toEqual([]);
  });
  it('is silent for local PostgreSQL', () => {
    expect(databaseWarnings('postgresql://prawn:pw@localhost:5432/prawn_dev')).toEqual([]);
  });
  it('flags a non-pooled app URL, missing ssl and a pooled direct URL', () => {
    const w = databaseWarnings(direct.replace('sslmode=require', 'sslmode=prefer'), pooled);
    expect(w).toHaveLength(3);
  });
  it('flags a missing DIRECT_URL', () => {
    expect(databaseWarnings(pooled)).toHaveLength(1);
  });
  it('never leaks the password', () => {
    expect(JSON.stringify(databaseWarnings(direct, pooled))).not.toContain('secret');
  });
});
