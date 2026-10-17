import crypto from 'crypto';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-secure-collaboration-service');

interface ParticipantSpec {
  userId: string;
  role: 'host' | 'participant' | 'observer';
  email?: string;
}

interface Participant extends ParticipantSpec {
  joinedAt: Date | null;
  status: 'invited' | 'joined' | 'left';
}

interface SessionOptions {
  privilegeProtected: boolean;
  expiresInHours?: number;
  maxDocuments?: number;
}

interface SecureSession {
  id: string;
  hostUserId: string;
  participants: Participant[];
  status: 'pending' | 'active' | 'closed';
  encryptionKey: string;
  privilegeProtected: boolean;
  createdAt: Date;
  expiresAt: Date;
}

interface SharedDocumentRef {
  documentId: string;
  sessionId: string;
  accessLevel: 'view' | 'redline' | 'comment';
  sharedAt: Date;
  sharedBy: string;
}

interface PrivilegedAnnotation {
  documentId: string;
  content: string;
  privilegeType: 'attorney-client' | 'work-product';
  createdBy: string;
}

const sessions = new Map<string, SecureSession>();

class NvSecureCollaborationService {
  async createSecureSession(
    hostUserId: string,
    participants: ParticipantSpec[],
    options: SessionOptions
  ): Promise<SecureSession> {
    const sessionId = `sess-${crypto.randomBytes(12).toString('hex')}`;
    const encryptionKey = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + (options.expiresInHours || 24));

    const session: SecureSession = {
      id: sessionId,
      hostUserId,
      participants: participants.map(p => ({
        ...p,
        joinedAt: p.userId === hostUserId ? new Date() : null,
        status: p.userId === hostUserId ? 'joined' : 'invited',
      })),
      status: 'active',
      encryptionKey,
      privilegeProtected: options.privilegeProtected,
      createdAt: new Date(),
      expiresAt,
    };

    sessions.set(sessionId, session);
    logger.info({ method: 'createSecureSession', sessionId, hostUserId, participantCount: participants.length });

    const { encryptionKey: _redacted, ...safeSession } = session;
    return { ...safeSession, encryptionKey: '[REDACTED]' } as SecureSession;
  }

  async joinSession(sessionId: string, userId: string, inviteToken: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status !== 'active') throw new Error('Session is not active');
    if (new Date() > session.expiresAt) throw new Error('Session has expired');

    const participant = session.participants.find(p => p.userId === userId);
    if (!participant) throw new Error('User is not invited to this session');

    participant.joinedAt = new Date();
    participant.status = 'joined';
    logger.info({ method: 'joinSession', sessionId, userId });
  }

  async shareDocument(
    sessionId: string,
    documentId: string,
    accessLevel: 'view' | 'redline' | 'comment'
  ): Promise<SharedDocumentRef> {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    logger.info({ method: 'shareDocument', sessionId, documentId, accessLevel });

    return {
      documentId,
      sessionId,
      accessLevel,
      sharedAt: new Date(),
      sharedBy: session.hostUserId,
    };
  }

  async addPrivilegedAnnotation(sessionId: string, annotation: PrivilegedAnnotation): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (!session.privilegeProtected) throw new Error('Session is not privilege-protected');

    logger.info({ method: 'addPrivilegedAnnotation', sessionId, documentId: annotation.documentId, privilegeType: annotation.privilegeType });
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.status = 'closed';
    logger.info({ method: 'closeSession', sessionId });
  }

  async getSession(sessionId: string): Promise<SecureSession | null> {
    return sessions.get(sessionId) || null;
  }
}

export const nvSecureCollaborationService = new NvSecureCollaborationService();
