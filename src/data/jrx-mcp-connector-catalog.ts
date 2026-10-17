/**
 * NV-MCP-CONNECTOR-CATALOG-001 — Priority legaltech integration connectors.
 * OAuth/API-key connectors for storage, collaboration, drafting, CRM, finance.
 * Linked MCP tool IDs route through nv-mcp-connector-service + nv-mcp-legal-delegate.
 */

export type ConnectorAuthType = 'oauth2' | 'api_key' | 'platform' | 'webhook';
export type ConnectorCategory =
  | 'storage' | 'collaboration' | 'email' | 'calendar' | 'esign'
  | 'crm' | 'finance' | 'marketing' | 'hr' | 'project' | 'intelligence';

export interface LegaltechConnectorDef {
  id: string;
  name: string;
  category: ConnectorCategory;
  authType: ConnectorAuthType;
  /** Env var NAME for API key (never value). */
  envKey?: string;
  jurisdictions: string[];
  mcpToolIds: string[];
  oauthScopes?: string[];
  docsUrl?: string;
  description: string;
  /** Honest implementation status — stub until OAuth/provider REST is wired. */
  implementationStatus: 'live' | 'stub' | 'platform';
}

export const LEGALTECH_CONNECTORS: LegaltechConnectorDef[] = [
  { id: 'google-drive', name: 'Google Drive', category: 'storage', authType: 'oauth2', envKey: 'GOOGLE_DRIVE_CLIENT_ID', jurisdictions: ['IN', 'UK', 'US', 'EU', 'GC', 'SG'], mcpToolIds: ['google_drive_list', 'google_drive_download'], oauthScopes: ['https://www.googleapis.com/auth/drive.readonly'], docsUrl: 'https://developers.google.com/drive', description: 'List and fetch legal matter files from Google Drive.', implementationStatus: 'stub' },
  { id: 'microsoft-onedrive', name: 'Microsoft OneDrive', category: 'storage', authType: 'oauth2', envKey: 'MICROSOFT_CLIENT_ID', jurisdictions: ['IN', 'UK', 'US', 'EU', 'GC', 'SG'], mcpToolIds: ['microsoft_onedrive_list', 'microsoft_onedrive_download'], oauthScopes: ['Files.Read'], docsUrl: 'https://learn.microsoft.com/graph/onedrive', description: 'OneDrive document access for M365 legal teams.', implementationStatus: 'stub' },
  { id: 'sharepoint', name: 'Microsoft SharePoint', category: 'storage', authType: 'oauth2', envKey: 'MICROSOFT_CLIENT_ID', jurisdictions: ['IN', 'UK', 'US', 'EU', 'GC', 'SG'], mcpToolIds: ['sharepoint_list', 'sharepoint_download'], oauthScopes: ['Sites.Read.All'], description: 'SharePoint matter libraries and DMS sites.', implementationStatus: 'stub' },
  { id: 'aws-s3', name: 'AWS S3 (Platform)', category: 'storage', authType: 'platform', jurisdictions: ['IN', 'UK', 'US', 'EU', 'GC', 'SG'], mcpToolIds: ['aws_s3_list', 'aws_s3_download'], description: 'Platform document bucket — live when NYV_STORAGE_BACKEND=s3.', implementationStatus: 'platform' },
  { id: 'box', name: 'Box', category: 'storage', authType: 'oauth2', envKey: 'BOX_CLIENT_ID', jurisdictions: ['US', 'UK', 'EU'], mcpToolIds: ['box_storage_list'], description: 'Enterprise legal DMS on Box.', implementationStatus: 'stub' },
  { id: 'dropbox', name: 'Dropbox Business', category: 'storage', authType: 'oauth2', envKey: 'DROPBOX_APP_KEY', jurisdictions: ['US', 'UK', 'EU'], mcpToolIds: ['dropbox_list_files'], description: 'Dropbox shared folders for legal teams.', implementationStatus: 'stub' },
  { id: 'imanage', name: 'iManage Work', category: 'storage', authType: 'oauth2', envKey: 'IMANAGE_CLIENT_ID', jurisdictions: ['US', 'UK', 'EU', 'IN'], mcpToolIds: ['imanage_workspace_list', 'imanage_document_download'], oauthScopes: ['user'], docsUrl: 'https://developers.imanage.com/', description: 'iManage Work DMS — matter workspaces and document export. OAuth stub until IMANAGE_CLIENT_ID + provider REST handlers are configured.', implementationStatus: 'stub' },
  { id: 'netdocuments', name: 'NetDocuments', category: 'storage', authType: 'oauth2', envKey: 'NETDOCUMENTS_CLIENT_ID', jurisdictions: ['US', 'UK', 'EU'], mcpToolIds: ['netdocuments_cabinet_list', 'netdocuments_document_fetch'], oauthScopes: ['full'], docsUrl: 'https://developer.netdocuments.com/', description: 'NetDocuments cloud DMS — cabinet browse and matter file fetch. OAuth stub until NETDOCUMENTS_CLIENT_ID + cabinet API handlers are wired.', implementationStatus: 'stub' },
  { id: 'slack', name: 'Slack', category: 'collaboration', authType: 'oauth2', envKey: 'SLACK_CLIENT_ID', jurisdictions: ['IN', 'UK', 'US', 'EU', 'GC', 'SG'], mcpToolIds: ['slack_post_message'], oauthScopes: ['chat:write'], description: 'Post matter updates to Slack channels.', implementationStatus: 'stub' },
  { id: 'microsoft-teams', name: 'Microsoft Teams', category: 'collaboration', authType: 'oauth2', envKey: 'MICROSOFT_CLIENT_ID', jurisdictions: ['IN', 'UK', 'US', 'EU', 'GC', 'SG'], mcpToolIds: ['microsoft_teams_post_message'], description: 'Teams channel notifications for legal ops.', implementationStatus: 'stub' },
  { id: 'notion', name: 'Notion', category: 'collaboration', authType: 'oauth2', envKey: 'NOTION_CLIENT_ID', jurisdictions: ['IN', 'UK', 'US', 'EU'], mcpToolIds: ['notion_fetch_page'], description: 'Fetch playbooks and matter wikis from Notion.', implementationStatus: 'stub' },
  { id: 'gmail', name: 'Gmail', category: 'email', authType: 'oauth2', envKey: 'GOOGLE_GMAIL_CLIENT_ID', jurisdictions: ['IN', 'UK', 'US', 'EU', 'GC', 'SG'], mcpToolIds: ['gmail_create_draft'], oauthScopes: ['https://www.googleapis.com/auth/gmail.compose'], description: 'Create legal correspondence drafts in Gmail.', implementationStatus: 'stub' },
  { id: 'outlook', name: 'Microsoft Outlook', category: 'email', authType: 'oauth2', envKey: 'MICROSOFT_CLIENT_ID', jurisdictions: ['IN', 'UK', 'US', 'EU', 'GC', 'SG'], mcpToolIds: ['outlook_create_draft'], description: 'Outlook draft emails for firm correspondence.', implementationStatus: 'stub' },
  { id: 'google-calendar', name: 'Google Calendar', category: 'calendar', authType: 'oauth2', envKey: 'GOOGLE_CALENDAR_CLIENT_ID', jurisdictions: ['IN', 'UK', 'US', 'EU', 'GC', 'SG'], mcpToolIds: ['google_calendar_create_event'], description: 'Schedule hearings, depositions, and filing deadlines.', implementationStatus: 'stub' },
  { id: 'outlook-calendar', name: 'Outlook Calendar', category: 'calendar', authType: 'oauth2', envKey: 'MICROSOFT_CLIENT_ID', jurisdictions: ['IN', 'UK', 'US', 'EU', 'GC', 'SG'], mcpToolIds: ['outlook_calendar_create_event'], description: 'Outlook calendar events for court dates.', implementationStatus: 'stub' },
  { id: 'docusign', name: 'DocuSign', category: 'esign', authType: 'oauth2', envKey: 'DOCUSIGN_INTEGRATION_KEY', jurisdictions: ['IN', 'UK', 'US', 'EU'], mcpToolIds: ['docusign_envelope_status'], description: 'Track e-signature envelope status.', implementationStatus: 'stub' },
  { id: 'adobe-sign', name: 'Adobe Sign', category: 'esign', authType: 'oauth2', envKey: 'ADOBE_SIGN_CLIENT_ID', jurisdictions: ['US', 'UK', 'EU', 'IN'], mcpToolIds: ['adobe_sign_status'], description: 'Adobe Sign agreement status for contracts.', implementationStatus: 'stub' },
  { id: 'salesforce', name: 'Salesforce Legal', category: 'crm', authType: 'oauth2', envKey: 'SALESFORCE_CLIENT_ID', jurisdictions: ['IN', 'UK', 'US', 'EU'], mcpToolIds: ['salesforce_matter_sync'], description: 'Sync matters and accounts with Salesforce.', implementationStatus: 'stub' },
  { id: 'hubspot', name: 'HubSpot', category: 'crm', authType: 'oauth2', envKey: 'HUBSPOT_CLIENT_ID', jurisdictions: ['US', 'UK', 'EU', 'IN'], mcpToolIds: ['hubspot_contact_lookup'], description: 'CRM contact lookup for client intake.', implementationStatus: 'stub' },
  { id: 'razorpay', name: 'Razorpay', category: 'finance', authType: 'api_key', envKey: 'RAZORPAY_KEY_ID', jurisdictions: ['IN'], mcpToolIds: ['razorpay_payment_status'], description: 'Payment status for Indian legal billing.', implementationStatus: 'stub' },
  { id: 'stripe', name: 'Stripe', category: 'finance', authType: 'api_key', envKey: 'STRIPE_SECRET_KEY', jurisdictions: ['US', 'UK', 'EU', 'SG'], mcpToolIds: ['stripe_invoice_fetch'], description: 'Invoice and subscription status (global).', implementationStatus: 'stub' },
  { id: 'zoom', name: 'Zoom', category: 'collaboration', authType: 'oauth2', envKey: 'ZOOM_CLIENT_ID', jurisdictions: ['IN', 'UK', 'US', 'EU'], mcpToolIds: ['zoom_meeting_create'], description: 'Schedule client calls and depositions.', implementationStatus: 'stub' },
  { id: 'asana', name: 'Asana', category: 'project', authType: 'oauth2', envKey: 'ASANA_CLIENT_ID', jurisdictions: ['US', 'UK', 'EU', 'IN'], mcpToolIds: ['asana_task_create'], description: 'Create legal ops tasks in Asana.', implementationStatus: 'stub' },
  { id: 'jira', name: 'Jira', category: 'project', authType: 'oauth2', envKey: 'JIRA_CLIENT_ID', jurisdictions: ['IN', 'UK', 'US', 'EU'], mcpToolIds: ['jira_issue_create'], description: 'Track legal engineering and compliance tickets.', implementationStatus: 'stub' },
  { id: 'trello', name: 'Trello', category: 'project', authType: 'oauth2', envKey: 'TRELLO_API_KEY', jurisdictions: ['US', 'UK', 'EU', 'IN'], mcpToolIds: ['trello_card_create'], description: 'Kanban cards for matter workflows.', implementationStatus: 'stub' },
  { id: 'perplexity-web', name: 'Perplexity Web Search', category: 'intelligence', authType: 'api_key', envKey: 'PERPLEXITY_API_KEY', jurisdictions: ['IN', 'UK', 'US', 'EU', 'GC', 'SG'], mcpToolIds: ['web_search', 'legal_news_search'], description: 'Live web intelligence for legal research.', implementationStatus: 'stub' },
  { id: 'bright-data', name: 'Bright Data Unlocker', category: 'intelligence', authType: 'api_key', envKey: 'BRIGHT_DATA_API_TOKEN', jurisdictions: ['IN', 'UK', 'US', 'EU', 'GC', 'SG'], mcpToolIds: ['regulatory_gazette_search'], description: 'Scrape regulatory gazettes behind bot protection.', implementationStatus: 'stub' },
];

export const CONNECTOR_BY_ID = Object.fromEntries(
  LEGALTECH_CONNECTORS.map(c => [c.id, c]),
) as Record<string, LegaltechConnectorDef>;

export const MCP_TOOL_TO_CONNECTOR: Record<string, string> = Object.fromEntries(
  LEGALTECH_CONNECTORS.flatMap(c => c.mcpToolIds.map(tid => [tid, c.id])),
);
