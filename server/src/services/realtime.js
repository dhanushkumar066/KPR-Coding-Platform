import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/cluster-adapter';
import cookie from 'cookie';
import { env } from '../config/env.js';
import { verifySessionToken, SESSION_COOKIE } from '../middleware/auth.js';
import { Test } from '../models/Test.js';

/**
 * Live proctor feed. Teachers subscribe to a room per test and receive
 * connection, submission and violation events as they happen.
 *
 * This channel is one-way for exam data: students never join a proctor room,
 * and nothing a client sends here influences grading or violation counting.
 */

let io = null;

const roomFor = (testId) => `proctor:${testId}`;

export function initRealtime(httpServer, { clustered = false } = {}) {
  io = new Server(httpServer, {
    cors: {
      /*
       * Development accepts whatever origin the request came from, so a trial
       * run over the local network works without editing CLIENT_ORIGIN every
       * time the laptop's address changes. Production stays pinned to the one
       * configured origin — the proctor feed carries live exam data, and a
       * permissive origin there would let any page on the internet subscribe.
       */
      origin: env.isProd ? env.clientOrigin : true,
      credentials: true,
    },
    path: '/socket.io',
  });

  // Across workers, an event emitted by whichever worker handled a student's
  // submission has to reach the teacher watching from another. The adapter
  // relays it through the primary; without it the proctor feed silently shows
  // only the fraction of events that happened to land on the teacher's worker,
  // which is worse than no feed at all because it still looks like it works.
  if (clustered) io.adapter(createAdapter());

  io.use((socket, next) => {
    try {
      const raw = socket.handshake.headers.cookie || '';
      const token = cookie.parse(raw)[SESSION_COOKIE];
      const payload = token ? verifySessionToken(token) : null;
      if (!payload) return next(new Error('Not signed in'));
      socket.data.user = payload;
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on('connection', (socket) => {
    const { role, sub } = socket.data.user;

    socket.on('proctor:join', async (testId, ack) => {
      try {
        if (!['teacher', 'admin'].includes(role)) throw new Error('Not permitted');

        const test = await Test.findById(testId).select('createdBy');
        if (!test) throw new Error('Test not found');
        // A teacher may only watch tests they created; admins may watch any.
        if (role !== 'admin' && test.createdBy.toString() !== sub) {
          throw new Error('Not your test');
        }

        socket.join(roomFor(testId));
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('proctor:leave', (testId) => socket.leave(roomFor(testId)));
  });

  return io;
}

/** Broadcasts to the proctors watching one test. Safe to call before init. */
export function emitProctor(testId, event, payload) {
  if (!io) return;
  io.to(roomFor(testId)).emit(event, { testId: String(testId), at: new Date(), ...payload });
}
