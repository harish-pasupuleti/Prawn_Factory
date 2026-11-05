import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env';
import { AppError, unauthorized } from '../../lib/errors';
import { authenticate, requireCsrfHeader } from '../../middleware/auth';
import { loginSchema, registerSchema } from './schemas';
import * as service from './service';

export const REFRESH_COOKIE = 'pf_refresh';
const COOKIE_PATH = '/api/v1/auth';

const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: COOKIE_PATH,
};

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, { ...cookieOptions, maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000 });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
}

const readRefreshCookie = (req: Request): string | undefined => {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const limiter = (limit: number, windowMs: number) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.')),
  });

export interface AuthRouterOptions {
  loginMax?: number;
  registerMax?: number;
}

export function authRouter(options: AuthRouterOptions = {}): Router {
  const router = Router();
  const loginLimiter = limiter(options.loginMax ?? env.LOGIN_RATE_LIMIT_MAX, 15 * 60 * 1000);
  const registerLimiter = limiter(options.registerMax ?? env.REGISTER_RATE_LIMIT_MAX, 60 * 60 * 1000);
  const refreshLimiter = limiter(60, 15 * 60 * 1000);

  router.post('/register', registerLimiter, async (req, res) => {
    const input = registerSchema.parse(req.body);
    const user = await service.registerFarmer(input, req.ip);
    res.status(201).json({ data: { user } });
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const session = await service.login(input, req.ip);
    setRefreshCookie(res, session.refreshToken);
    res.json({ data: { accessToken: session.accessToken, expiresIn: session.expiresIn, user: session.user } });
  });

  router.post('/refresh', refreshLimiter, requireCsrfHeader, async (req, res) => {
    const token = readRefreshCookie(req);
    if (!token) throw unauthorized();
    try {
      const session = await service.refreshSession(token, req.ip);
      setRefreshCookie(res, session.refreshToken);
      res.json({ data: { accessToken: session.accessToken, expiresIn: session.expiresIn, user: session.user } });
    } catch (err) {
      clearRefreshCookie(res);
      throw err;
    }
  });

  router.post('/logout', requireCsrfHeader, async (req, res) => {
    await service.logout(readRefreshCookie(req), req.ip);
    clearRefreshCookie(res);
    res.status(204).end();
  });

  router.get('/me', authenticate, async (req, res) => {
    res.json({ data: { user: await service.getCurrentUser(req.user!.id) } });
  });

  return router;
}
