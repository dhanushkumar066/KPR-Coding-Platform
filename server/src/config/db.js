import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 8000,

    /*
     * Sized per worker, because every worker opens its own pool.
     *
     * Mongoose defaults to 100 connections per process, which is right for one
     * process and wrong for twelve — 1,200 sockets against one mongod, each
     * costing it about a megabyte, to serve requests that spend under a
     * millisecond in the database. The exam workload is many small indexed
     * reads and writes, so a modest pool per worker keeps far more headroom
     * than a large one and leaves the database able to breathe.
     */
    maxPoolSize: env.mongoPoolSize,
    minPoolSize: 2,
    // Fail a checkout rather than pile up behind an exhausted pool: a request
    // that waits 30s has already lost the student, and the retry will land on
    // a worker with a free connection.
    waitQueueTimeoutMS: 5000,
  });
  console.log(`[db] connected to ${mongoose.connection.name}`);

  mongoose.connection.on('error', (err) => console.error('[db] error', err.message));
  mongoose.connection.on('disconnected', () => console.warn('[db] disconnected'));
}
