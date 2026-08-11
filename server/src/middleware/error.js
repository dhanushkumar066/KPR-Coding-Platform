import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

export function notFound(_req, _res, next) {
  next(new ApiError(404, 'Route not found'));
}

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity.
export function errorHandler(err, req, res, _next) {
  // Turn schema failures into something a teacher can act on.
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({
      field: i.path.join('.') || '(body)',
      message: i.message,
    }));
    return res.status(400).json({ error: details[0]?.message || 'Invalid request', details });
  }

  // Bad ObjectId in a route param.
  if (err.name === 'CastError' && err.kind === 'ObjectId') {
    return res.status(400).json({ error: 'That id is not valid' });
  }

  if (err.code === 11000) {
    return res.status(409).json({ error: 'That record already exists', details: err.keyValue });
  }

  // Multer size/count limits.
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That file is too large (max 5 MB)' });
  }

  const status = err instanceof ApiError ? err.status : err.status || 500;
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }

  res.status(status).json({
    error: status >= 500 && env.isProd ? 'Internal server error' : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}
