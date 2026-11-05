import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from '../../src/modules/auth/schemas';
import { createUserSchema, updateUserSchema } from '../../src/modules/users/schemas';

const farmer = {
  email: '  Farmer@Example.COM ',
  password: 'a-long-enough-password',
  fullName: 'Ravi Kumar',
  phone: '98765 43210',
  village: 'Razole',
  district: 'Konaseema',
  state: 'Andhra Pradesh',
};

describe('registerSchema', () => {
  it('normalises email and phone', () => {
    const parsed = registerSchema.parse(farmer);
    expect(parsed.email).toBe('farmer@example.com');
    expect(parsed.phone).toBe('9876543210');
  });
  it('rejects role injection and other unknown fields', () => {
    expect(registerSchema.safeParse({ ...farmer, role: 'ADMIN' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...farmer, status: 'ACTIVE' }).success).toBe(false);
  });
  it('rejects weak or oversized passwords and bad phones', () => {
    expect(registerSchema.safeParse({ ...farmer, password: 'short' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...farmer, password: 'x'.repeat(129) }).success).toBe(false);
    expect(registerSchema.safeParse({ ...farmer, phone: '12345' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...farmer, password: 'farmer@example.com' }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('requires email and password only', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x', admin: true }).success).toBe(false);
  });
});

describe('user administration schemas', () => {
  it('admins cannot create farmer accounts through the staff endpoint', () => {
    const base = { email: 'a@b.co', password: 'a-long-enough-password', fullName: 'Staff Person' };
    expect(createUserSchema.safeParse({ ...base, role: 'FARMER' }).success).toBe(false);
    for (const role of ['PURCHASE_MANAGER', 'FIELD_OFFICER', 'TRANSPORT_OFFICER', 'SECURITY_OFFICER', 'FACTORY_OPERATOR', 'ADMIN']) {
      expect(createUserSchema.safeParse({ ...base, role }).success).toBe(true);
    }
  });
  it('updates need at least one known field', () => {
    expect(updateUserSchema.safeParse({}).success).toBe(false);
    expect(updateUserSchema.safeParse({ status: 'DISABLED' }).success).toBe(true);
    expect(updateUserSchema.safeParse({ passwordHash: 'x' }).success).toBe(false);
  });
});
