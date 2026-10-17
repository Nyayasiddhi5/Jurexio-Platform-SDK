/**
 * NV-MCP-CONNECTOR-SERVICE-001 — Runtime connector sessions + honest invoke.
 * Platform storage (S3) is live when configured; OAuth connectors require connect flow.
 */
import { createLogger } from '../../utils/logger.js';
import {
  CONNECTOR_BY_ID,
  LEGALTECH_CONNECTORS,
  MCP_TOOL_TO_CONNECTOR,
  type LegaltechConnectorDef,
} from '../../data/jrx-mcp-connector-catalog.js';

const logger = createLogger('./jrx-mcp-connector-service');

export interface ConnectorSession {
  connectorId: string;
  orgId: string;
  connected: boolean;
  authType: string;
  connectedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ConnectorInvokeResult {
  status: 'ok' | 'oauth_required' | 'api_key_missing' | 'platform_unconfigured' | 'unsupported_action' | 'error';
  connectorId: string;
  action: string;
  data?: unknown;
  connectPath?: string;
  note?: string;
  error?: string;
}

const sessions = new Map<string, ConnectorSession>();

function sessionKey(orgId: string, connectorId: string): string {
  return `${orgId}::${connectorId}`;
}

function envConfigured(def: LegaltechConnectorDef): boolean {
  if (def.authType === 'platform') return process.env.NYV_STORAGE_BACKEND === 's3' || !!process.env.AWS_ACCESS_KEY_ID;
  if (!def.envKey) return true;
  return !!process.env[def.envKey];
}

export const nvMcpConnectorService = {
  listConnectors(orgId = 'platform') {
    return LEGALTECH_CONNECTORS.map((def: LegaltechConnectorDef) => {
      const sk = sessionKey(orgId, def.id);
      const session = sessions.get(sk);
      const credsReady = envConfigured(def);
      let status: 'connected' | 'configured' | 'oauth_required' | 'api_key_missing' = 'oauth_required';
      if (def.authType === 'platform') {
        status = credsReady ? (session?.connected ? 'connected' : 'configured') : 'api_key_missing';
      } else if (def.authType === 'api_key') {
        status = credsReady ? (session?.connected ? 'connected' : 'configured') : 'api_key_missing';
      } else {
        status = session?.connected ? 'connected' : credsReady ? 'oauth_required' : 'api_key_missing';
      }
      return {
        ...def,
        status,
        implementationStatus: def.implementationStatus,
        mcpToolCount: def.mcpToolIds.length,
        connectPath: `/api/jrx/mcp/connectors/${def.id}/connect`,
      };
    });
  },

  getConnector(connectorId: string, orgId = 'platform') {
    const def = CONNECTOR_BY_ID[connectorId];
    if (!def) return null;
    const session = sessions.get(sessionKey(orgId, connectorId));
    return { ...def, session: session ?? null, envConfigured: envConfigured(def) };
  },

  async connect(connectorId: string, orgId: string, credentials?: Record<string, unknown>) {
    const def = CONNECTOR_BY_ID[connectorId];
    if (!def) throw new Error(`Unknown connector: ${connectorId}`);

    if (def.authType === 'api_key' && !envConfigured(def)) {
      return {
        success: false,
        status: 'api_key_missing',
        connectorId,
        note: `Set ${def.envKey} in environment to enable ${def.name}.`,
      };
    }

    if (def.authType === 'oauth2' && !credentials?.accessToken && !envConfigured(def)) {
      return {
        success: false,
        status: 'oauth_required',
        connectorId,
        oauthUrl: `/api/jrx/mcp/connectors/${connectorId}/oauth/start`,
        note: `Complete OAuth for ${def.name}. Client ID env: ${def.envKey ?? 'N/A'}.`,
      };
    }

    sessions.set(sessionKey(orgId, connectorId), {
      connectorId,
      orgId,
      connected: true,
      authType: def.authType,
      connectedAt: new Date().toISOString(),
      metadata: credentials ? { hasToken: !!credentials.accessToken } : { platform: true },
    });

    logger.info('[MCP-Connector] connected', { connectorId, orgId, authType: def.authType });
    return { success: true, connectorId, status: 'connected', connectedAt: new Date().toISOString() };
  },

  async disconnect(connectorId: string, orgId: string) {
    sessions.delete(sessionKey(orgId, connectorId));
    return { success: true, connectorId };
  },

  async healthCheck(connectorId: string, orgId: string) {
    const def = CONNECTOR_BY_ID[connectorId];
    if (!def) return { healthy: false, error: 'unknown_connector' };
    const session = sessions.get(sessionKey(orgId, connectorId));
    const configured = envConfigured(def);
    return {
      connectorId,
      healthy: def.authType === 'platform' ? configured : !!(session?.connected || configured),
      connected: !!session?.connected,
      envConfigured: configured,
      authType: def.authType,
      checkedAt: new Date().toISOString(),
    };
  },

  /** Invoke connector-backed MCP tool action. */
  async invokeForTool(toolId: string, input: Record<string, unknown>, orgId = 'platform'): Promise<ConnectorInvokeResult | null> {
    const connectorId = MCP_TOOL_TO_CONNECTOR[toolId];
    if (!connectorId) return null;
    const def = CONNECTOR_BY_ID[connectorId];
    if (!def) return null;

    const action = toolId.replace(/^(google_drive|microsoft_onedrive|sharepoint|aws_s3|box_storage|dropbox|slack|microsoft_teams|notion|gmail|outlook|google_calendar|outlook_calendar|docusign|adobe_sign|salesforce|hubspot|razorpay|stripe|zoom|asana|jira|trello)_/, '');
    return this.invoke(connectorId, action || toolId, input, orgId);
  },

  async invoke(connectorId: string, action: string, input: Record<string, unknown>, orgId = 'platform'): Promise<ConnectorInvokeResult> {
    const def = CONNECTOR_BY_ID[connectorId];
    if (!def) {
      return { status: 'error', connectorId, action, error: 'unknown_connector' };
    }

    // Platform S3 — live list/download when storage backend configured
    if (connectorId === 'aws-s3') {
      if (!envConfigured(def)) {
        return {
          status: 'platform_unconfigured',
          connectorId,
          action,
          note: 'Set NYV_STORAGE_BACKEND=s3 and AWS credentials for live S3 MCP tools.',
        };
      }
      try {
        const { nyvDocumentStorage } = await import('../nyv-document-storage-service.js');
        const org = String(input.orgId ?? 'platform');
        const platform = String(input.platform ?? 'nyv');
        const userId = String(input.userId ?? 'mcp-system');
        if (action.includes('list') || toolActionIs(action, 'list')) {
          const listed = await nyvDocumentStorage.listUserDocuments(org, platform, userId, Number(input.limit ?? 50));
          return { status: 'ok', connectorId, action, data: { items: listed.items, prefix: `orgs/${org}/${platform}/users/${userId}/documents` } };
        }
        if (action.includes('download') || toolActionIs(action, 'download')) {
          const path = String(input.path ?? input.key ?? '');
          const downloaded = await nyvDocumentStorage.download(path);
          const size = Buffer.isBuffer(downloaded) ? downloaded.length : (downloaded as { content?: Buffer }).content?.length ?? 0;
          return {
            status: 'ok',
            connectorId,
            action,
            data: { path, size, contentType: 'application/octet-stream', note: 'Binary returned server-side; use document pipeline for full parse.' },
          };
        }
      } catch (err: any) {
        return { status: 'error', connectorId, action, error: err?.message || 's3_error' };
      }
    }

    const session = sessions.get(sessionKey(orgId, connectorId));
    if (def.authType === 'oauth2' && !session?.connected) {
      return {
        status: 'oauth_required',
        connectorId,
        action,
        connectPath: `/api/jrx/mcp/connectors/${connectorId}/connect`,
        note: `Connect ${def.name} via POST ${`/api/jrx/mcp/connectors/${connectorId}/connect`} with OAuth token or use Console → MCP Connectors.`,
      };
    }

    if (def.authType === 'api_key' && !envConfigured(def)) {
      return {
        status: 'api_key_missing',
        connectorId,
        action,
        note: `Set ${def.envKey} to enable ${def.name}.`,
      };
    }

    // API-key connectors — structured honest payloads (live HTTP deferred per provider onboarding)
    if (connectorId === 'razorpay' && action.includes('payment')) {
      return {
        status: 'ok',
        connectorId,
        action,
        data: {
          paymentId: input.paymentId,
          status: 'lookup_ready',
          source: 'razorpay',
          note: 'Razorpay REST /payments/:id — credentials configured.',
        },
      };
    }
    if (connectorId === 'stripe' && action.includes('invoice')) {
      return {
        status: 'ok',
        connectorId,
        action,
        data: {
          invoiceId: input.invoiceId,
          status: 'lookup_ready',
          source: 'stripe',
          note: 'Stripe REST /v1/invoices/:id — credentials configured.',
        },
      };
    }

    // OAuth-connected — acknowledge action with routing metadata (extensible to live REST)
    return {
      status: session?.connected || def.authType === 'api_key' ? 'ok' : 'oauth_required',
      connectorId,
      action,
      data: {
        input,
        routed: true,
        provider: def.name,
        message: session?.connected
          ? `${def.name} action '${action}' accepted — extend nv-mcp-connector-service for provider-specific REST.`
          : undefined,
      },
      connectPath: session?.connected ? undefined : `/api/jrx/mcp/connectors/${connectorId}/connect`,
    };
  },

  stats() {
    return {
      total: LEGALTECH_CONNECTORS.length,
      connectedSessions: sessions.size,
      categories: [...new Set(LEGALTECH_CONNECTORS.map((c: LegaltechConnectorDef) => c.category))],
    };
  },
};

function toolActionIs(action: string, verb: string): boolean {
  return action === verb || action.endsWith(`_${verb}`) || action.startsWith(`${verb}_`);
}
