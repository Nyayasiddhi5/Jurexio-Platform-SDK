/**
 * NYV WebSocket Job Progress Service v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-time job progress notification system using WebSockets.
 *
 * FEATURES:
 *   - Per-job progress updates pushed to subscribed clients
 *   - Per-user subscription management (a user can subscribe to all their jobs)
 *   - JWT authentication required before subscribing
 *   - Heartbeat/ping-pong to detect dead connections
 *   - Auto-cleanup on connection close
 *   - Message queuing for offline clients (reconnect within 5 min)
 *   - Job event types: started, progress, completed, failed, cancelled
 *
 * INTEGRATION:
 *   - nv-job-worker.ts calls jobProgressBroadcaster.publish() after each step
 *   - WebSocket server mounts on /ws/nyv/jobs
 *   - Client connects with JWT: { type: 'auth', token: 'JWT' }
 *   - Client subscribes to jobs: { type: 'subscribe', jobId: 'UUID' }
 *   - Server pushes progress: { type: 'job_progress', jobId, progress: 0-100, status, message }
 *
 * MESSAGE PROTOCOL:
 *   Client → Server:
 *     { type: 'auth', token: string }
 *     { type: 'subscribe', jobId: string }
 *     { type: 'unsubscribe', jobId: string }
 *     { type: 'subscribe_all' }        // All jobs belonging to this user
 *     { type: 'ping' }
 *
 *   Server → Client:
 *     { type: 'auth_success', userId: string }
 *     { type: 'subscribed', jobId: string }
 *     { type: 'job_progress', jobId, progress, status, message, data? }
 *     { type: 'job_complete', jobId, result? }
 *     { type: 'job_failed', jobId, error }
 *     { type: 'pong', timestamp: number }
 *     { type: 'error', message: string }
 *
 * @module nyv-ws-job-progress
 * @version 1.0.0
 */

import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('nyv-ws-jobs');

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.NYV_JWT_SECRET || process.env.JWT_SECRET || process.env.NS_JWT_SECRET || '';
const HEARTBEAT_INTERVAL_MS = 30_000;
const AUTH_TIMEOUT_MS = 15_000;
const MAX_SUBSCRIPTIONS_PER_CLIENT = 50;
const MAX_QUEUED_MESSAGES = 100;
const RECONNECT_QUEUE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type JobStatus = 'queued' | 'started' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface JobProgressEvent {
  jobId: string;
  status: JobStatus;
  progress: number;          // 0-100
  message?: string;
  step?: string;             // Current step label (e.g., "OCR", "Embedding", "Indexing")
  totalSteps?: number;
  currentStep?: number;
  estimatedSecondsRemaining?: number;
  data?: Record<string, any>;
  timestamp: number;
  userId?: string;
  orgId?: string;
  platform?: string;
}

interface ClientSession {
  ws: WebSocket;
  userId: string;
  orgId?: string;
  platform?: string;
  authenticated: boolean;
  subscribedJobs: Set<string>;
  subscribedAll: boolean;
  lastPing: number;
  isAlive: boolean;
  sessionId: string;
}

interface QueuedMessage {
  event: JobProgressEvent;
  queuedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB PROGRESS BROADCASTER
// ─────────────────────────────────────────────────────────────────────────────

export class NyvJobProgressBroadcaster extends EventEmitter {
  private clients: Map<string, ClientSession> = new Map();   // sessionId → ClientSession
  private userSessions: Map<string, Set<string>> = new Map(); // userId → Set<sessionId>
  private jobSubscribers: Map<string, Set<string>> = new Map(); // jobId → Set<sessionId>
  private offlineQueue: Map<string, QueuedMessage[]> = new Map(); // userId → queued messages
  private wss?: WebSocketServer;
  private heartbeatInterval?: NodeJS.Timeout;
  private static instance: NyvJobProgressBroadcaster;

  static getInstance(): NyvJobProgressBroadcaster {
    if (!NyvJobProgressBroadcaster.instance) {
      NyvJobProgressBroadcaster.instance = new NyvJobProgressBroadcaster();
    }
    return NyvJobProgressBroadcaster.instance;
  }

  // ─── SETUP ────────────────────────────────────────────────────────────────

  setup(server: HttpServer): void {
    if (this.wss) return; // Already initialized

    this.wss = new WebSocketServer({ server, path: '/ws/nyv/jobs' });
    this.wss.on('connection', (ws: WebSocket) => this.handleConnection(ws));
    this.startHeartbeat();
    logger.info('[WS Jobs] WebSocket job progress server started on /ws/nyv/jobs');
  }

  // ─── CONNECTION HANDLER ────────────────────────────────────────────────────

  private handleConnection(ws: WebSocket): void {
    const sessionId = `sess_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;

    const session: ClientSession = {
      ws,
      userId: '',
      authenticated: false,
      subscribedJobs: new Set(),
      subscribedAll: false,
      lastPing: Date.now(),
      isAlive: true,
      sessionId,
    };

    this.clients.set(sessionId, session);

    // Authentication timeout
    const authTimeout = setTimeout(() => {
      if (!session.authenticated) {
        this.send(ws, { type: 'error', message: 'Authentication timeout — send { type: "auth", token: "JWT" } within 15s' });
        ws.close(1008, 'Auth timeout');
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('pong', () => {
      session.isAlive = true;
      session.lastPing = Date.now();
    });

    ws.on('message', async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        await this.handleMessage(session, msg, authTimeout);
      } catch {
        this.send(ws, { type: 'error', message: 'Invalid JSON message' });
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      this.removeClient(session);
    });

    ws.on('error', (err) => {
      logger.warn(`[WS Jobs] Client error (${sessionId}): ${err.message}`);
      this.removeClient(session);
    });
  }

  // ─── MESSAGE HANDLER ───────────────────────────────────────────────────────

  private async handleMessage(session: ClientSession, msg: any, authTimeout: ReturnType<typeof setTimeout>): Promise<void> {
    const { ws } = session;

    // Auth message
    if (msg.type === 'auth') {
      try {
        const decoded = jwt.verify(msg.token, JWT_SECRET) as any;
        session.userId = decoded.userId || decoded.id || decoded.sub || 'unknown';
        session.orgId = decoded.orgId;
        session.platform = decoded.platform;
        session.authenticated = true;
        clearTimeout(authTimeout);

        // Register in user session index
        if (!this.userSessions.has(session.userId)) {
          this.userSessions.set(session.userId, new Set());
        }
        this.userSessions.get(session.userId)!.add(session.sessionId);

        // Flush offline queue
        const queued = this.offlineQueue.get(session.userId) || [];
        const now = Date.now();
        for (const item of queued) {
          if (now - item.queuedAt < RECONNECT_QUEUE_TTL_MS) {
            this.send(ws, { type: 'job_progress', ...item.event });
          }
        }
        this.offlineQueue.delete(session.userId);

        this.send(ws, {
          type: 'auth_success',
          userId: session.userId,
          sessionId: session.sessionId,
          wsVersion: '1.0',
          features: ['subscribe', 'subscribe_all', 'ping'],
        });
        logger.debug(`[WS Jobs] Authenticated user ${session.userId} (session ${session.sessionId})`);
      } catch {
        this.send(ws, { type: 'error', message: 'Invalid or expired token' });
        ws.close(1008, 'Invalid token');
      }
      return;
    }

    if (!session.authenticated) {
      this.send(ws, { type: 'error', message: 'Not authenticated. Send auth message first.' });
      return;
    }

    switch (msg.type) {
      case 'subscribe': {
        const jobId = String(msg.jobId || '').trim();
        if (!jobId) { this.send(ws, { type: 'error', message: 'jobId is required for subscribe' }); return; }
        if (session.subscribedJobs.size >= MAX_SUBSCRIPTIONS_PER_CLIENT) {
          this.send(ws, { type: 'error', message: `Maximum ${MAX_SUBSCRIPTIONS_PER_CLIENT} subscriptions per client` });
          return;
        }
        session.subscribedJobs.add(jobId);
        if (!this.jobSubscribers.has(jobId)) this.jobSubscribers.set(jobId, new Set());
        this.jobSubscribers.get(jobId)!.add(session.sessionId);
        this.send(ws, { type: 'subscribed', jobId });
        break;
      }

      case 'unsubscribe': {
        const jobId = String(msg.jobId || '').trim();
        session.subscribedJobs.delete(jobId);
        this.jobSubscribers.get(jobId)?.delete(session.sessionId);
        this.send(ws, { type: 'unsubscribed', jobId });
        break;
      }

      case 'subscribe_all': {
        session.subscribedAll = true;
        this.send(ws, { type: 'subscribed_all', userId: session.userId });
        break;
      }

      case 'ping': {
        this.send(ws, { type: 'pong', timestamp: Date.now(), sessionId: session.sessionId });
        break;
      }

      default: {
        this.send(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
      }
    }
  }

  // ─── BROADCAST ─────────────────────────────────────────────────────────────

  /**
   * Publish a job progress event to all subscribed clients.
   * Called by nv-job-worker.ts after each processing step.
   *
   * @example
   * jobProgressBroadcaster.publish({
   *   jobId: 'uuid',
   *   status: 'processing',
   *   progress: 45,
   *   step: 'Embedding chunks',
   *   currentStep: 2,
   *   totalSteps: 4,
   *   userId: 'user-123',
   *   timestamp: Date.now(),
   * });
   */
  publish(event: JobProgressEvent): void {
    const { jobId, userId } = event;
    let delivered = 0;

    // 1. Push to job-specific subscribers
    const jobSubs = this.jobSubscribers.get(jobId) || new Set();
    for (const sessionId of jobSubs) {
      const session = this.clients.get(sessionId);
      if (session?.authenticated && session.ws.readyState === WebSocket.OPEN) {
        this.send(session.ws, { type: this.getEventType(event.status), ...event });
        delivered++;
      }
    }

    // 2. Push to subscribe_all sessions for this user
    if (userId) {
      const userSess = this.userSessions.get(userId) || new Set();
      for (const sessionId of userSess) {
        const session = this.clients.get(sessionId);
        if (session?.subscribedAll && session.ws.readyState === WebSocket.OPEN) {
          this.send(session.ws, { type: this.getEventType(event.status), ...event });
          delivered++;
        }
      }

      // 3. If no live clients, queue for reconnect
      if (delivered === 0 && userId) {
        if (!this.offlineQueue.has(userId)) this.offlineQueue.set(userId, []);
        const queue = this.offlineQueue.get(userId)!;
        if (queue.length < MAX_QUEUED_MESSAGES) {
          queue.push({ event, queuedAt: Date.now() });
        }
      }
    }

    // 4. Emit locally for in-process listeners
    this.emit('job:progress', event);

    logger.debug(`[WS Jobs] Published ${event.status} for job ${jobId} → ${delivered} client(s)`);
  }

  private getEventType(status: JobStatus): string {
    switch (status) {
      case 'completed': return 'job_complete';
      case 'failed': return 'job_failed';
      case 'cancelled': return 'job_cancelled';
      default: return 'job_progress';
    }
  }

  // ─── CONVENIENCE METHODS ───────────────────────────────────────────────────

  publishStart(jobId: string, userId: string, jobType: string, orgId?: string, platform?: string): void {
    this.publish({ jobId, status: 'started', progress: 0, step: 'Initializing', message: `Starting ${jobType}...`, userId, orgId, platform, timestamp: Date.now() });
  }

  publishProgress(jobId: string, userId: string, progress: number, step: string, currentStep?: number, totalSteps?: number): void {
    this.publish({ jobId, status: 'processing', progress, step, currentStep, totalSteps, message: step, userId, timestamp: Date.now() });
  }

  publishComplete(jobId: string, userId: string, result?: Record<string, any>): void {
    this.publish({ jobId, status: 'completed', progress: 100, step: 'Complete', message: 'Job completed successfully', data: result, userId, timestamp: Date.now() });
  }

  publishFailed(jobId: string, userId: string, error: string): void {
    this.publish({ jobId, status: 'failed', progress: 0, step: 'Failed', message: error, userId, timestamp: Date.now() });
  }

  // ─── CLEANUP ───────────────────────────────────────────────────────────────

  private removeClient(session: ClientSession): void {
    this.clients.delete(session.sessionId);
    this.userSessions.get(session.userId)?.delete(session.sessionId);
    for (const jobId of session.subscribedJobs) {
      this.jobSubscribers.get(jobId)?.delete(session.sessionId);
    }
    logger.debug(`[WS Jobs] Client ${session.sessionId} (${session.userId}) disconnected`);
  }

  private send(ws: WebSocket, data: Record<string, any>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // ─── HEARTBEAT ─────────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [sessionId, session] of this.clients) {
        if (!session.isAlive) {
          session.ws.terminate();
          this.removeClient(session);
          continue;
        }
        session.isAlive = false;
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.ping();
        }
      }

      // Clean up expired offline queue entries
      const now = Date.now();
      for (const [userId, queue] of this.offlineQueue) {
        const fresh = queue.filter(item => now - item.queuedAt < RECONNECT_QUEUE_TTL_MS);
        if (fresh.length === 0) this.offlineQueue.delete(userId);
        else this.offlineQueue.set(userId, fresh);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  // ─── STATS ─────────────────────────────────────────────────────────────────

  getStats() {
    return {
      connectedClients: this.clients.size,
      authenticatedClients: [...this.clients.values()].filter(s => s.authenticated).length,
      activeJobSubscriptions: this.jobSubscribers.size,
      usersWithOfflineQueue: this.offlineQueue.size,
      totalQueuedMessages: [...this.offlineQueue.values()].reduce((s, q) => s + q.length, 0),
    };
  }

  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
    for (const session of this.clients.values()) {
      session.ws.close(1001, 'Server shutdown');
    }
    this.wss?.close();
    logger.info('[WS Jobs] WebSocket job progress server shut down');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export const jobProgressBroadcaster = NyvJobProgressBroadcaster.getInstance();
export default jobProgressBroadcaster;
