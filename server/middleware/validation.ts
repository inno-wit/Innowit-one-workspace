import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // zod v4 renamed `errors` to `issues`; support both defensively (audit fix VAL-1)
        const issues: Array<{ path: (string | number | symbol)[]; message: string }> =
          (error as any).issues ?? (error as any).errors ?? [];
        res.status(400).json({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: issues.map((e) => ({
            field: e.path.map(String).join('.'),
            message: e.message,
          })),
        });
        return;
      }
      next(error);
    }
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // zod v4 renamed `errors` to `issues`; support both defensively (audit fix VAL-1)
        const issues: Array<{ path: (string | number | symbol)[]; message: string }> =
          (error as any).issues ?? (error as any).errors ?? [];
        res.status(400).json({
          error: 'Query validation failed',
          code: 'VALIDATION_ERROR',
          details: issues.map((e) => ({
            field: e.path.map(String).join('.'),
            message: e.message,
          })),
        });
        return;
      }
      next(error);
    }
  };
}

export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.params = schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // zod v4 renamed `errors` to `issues`; support both defensively (audit fix VAL-1)
        const issues: Array<{ path: (string | number | symbol)[]; message: string }> =
          (error as any).issues ?? (error as any).errors ?? [];
        res.status(400).json({
          error: 'Params validation failed',
          code: 'VALIDATION_ERROR',
          details: issues.map((e) => ({
            field: e.path.map(String).join('.'),
            message: e.message,
          })),
        });
        return;
      }
      next(error);
    }
  };
}