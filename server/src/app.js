import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { notFound, errorHandler } from './middleware/error.js';
import { publicLanguages } from './config/languages.js';
import { executorHealth, executionStats } from './services/executor.js';
import { gradingStats } from './services/gradingQueue.js';
import { Submission } from './models/Submission.js';
import { FUNCTION_LANGUAGES, PARAM_TYPES, RETURN_TYPES } from './services/codegen/index.js';
import { UPLOAD_ROOT } from './services/uploads.js';

import authRoutes from './routes/auth.js';
import questionRoutes from './routes/questions.js';
import testRoutes from './routes/tests.js';
import examRoutes from './routes/exam.js';
import reviewRoutes from './routes/reviews.js';
import adminRoutes from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  // Student code and pasted allowlists can be sizeable; 100kb is not enough.
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  if (!env.isProd) app.use(morgan('dev'));

  // Question diagrams. Static files only — nothing here is executed, and the
  // filenames are server-generated so the path is not user-controlled.
  app.use(
    '/uploads',
    express.static(UPLOAD_ROOT, {
      maxAge: '7d',
      index: false,
      dotfiles: 'deny',
      setHeaders: (res) => res.setHeader('Content-Disposition', 'inline'),
    })
  );

  app.get('/api/health', async (_req, res) => {
    /*
     * Queue depth is the number to watch during an exam: a rising backlog means
     * the judge is the bottleneck, not the API.
     *
     * The in-process figures below belong to WHICHEVER WORKER answered this
     * request, not to the machine — the API runs one worker per core and each
     * keeps its own queue. Reading "4 queued" off a twelve-worker box and
     * concluding the backlog is small would be badly wrong, so the honest
     * whole-system number is counted from the database and reported separately.
     */
    const [pending, executor] = await Promise.all([
      Submission.countDocuments({ status: 'pending' }),
      executorHealth(),
    ]);

    res.json({
      ok: true,
      env: env.nodeEnv,
      executor,
      // Across every worker — this is the one to watch.
      pendingSubmissions: pending,
      worker: {
        pid: process.pid,
        execution: executionStats(),
        grading: gradingStats(),
      },
    });
  });

  app.get('/api/languages', (_req, res) =>
    res.json({
      languages: publicLanguages(),
      // Parameters and return values differ: `void` may only be returned, and a
      // single `node` may only be a parameter.
      functionTypes: PARAM_TYPES,
      returnTypes: RETURN_TYPES,
      functionLanguages: FUNCTION_LANGUAGES,
    })
  );

  app.use('/api/auth', authRoutes);
  app.use('/api/questions', questionRoutes);
  app.use('/api/tests', testRoutes);
  app.use('/api/exam', examRoutes);
  app.use('/api/reviews', reviewRoutes);
  app.use('/api/admin', adminRoutes);

  app.use('/api', notFound);

  /*
   * Serve the built client, when there is one.
   *
   * A production deployment normally puts nginx in front, and nginx serves
   * these files faster than Node will. This exists for the hosts that give you
   * a single process and no nginx — Render, Railway, Fly and the like — where
   * the alternative is deploying the front end and the API as two services on
   * two domains.
   *
   * That split is worse than it looks: the session cookie is SameSite=lax, so
   * the browser would refuse to send it from a front end on one domain to an
   * API on another, and every request would arrive signed-out. Serving both
   * from one origin sidesteps it entirely rather than weakening the cookie.
   *
   * Skipped silently when the client has not been built, so the API alone
   * still runs in development.
   */
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    // Anything not an API route is a client route — React Router owns it, so
    // hand back index.html and let the browser resolve it.
    app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use(errorHandler);

  return app;
}
