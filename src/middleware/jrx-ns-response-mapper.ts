import { Request, Response, NextFunction } from 'express';

const ENTITY_ID_MAP: Record<string, string> = {
  id: 'nyayasiddhi_id',
  matter_id: 'nyayasiddhi_case_id',
  matterId: 'nyayasiddhi_case_id',
  client_id: 'nyayasiddhi_client_id',
  clientId: 'nyayasiddhi_client_id',
  draft_id: 'nyayasiddhi_document_id',
  draftId: 'nyayasiddhi_document_id',
  invoice_id: 'nyayasiddhi_invoice_id',
  invoiceId: 'nyayasiddhi_invoice_id',
  org_id: 'nyayasiddhi_org_id',
  organization_id: 'nyayasiddhi_org_id',
  organizationId: 'nyayasiddhi_org_id',
  user_id: 'nyayasiddhi_auth_user_id',
  userId: 'nyayasiddhi_auth_user_id',
  tenant_id: 'nyayasiddhi_tenant_id',
  tenantId: 'nyayasiddhi_tenant_id',
  plan_id: 'nyayasiddhi_plan_id',
  planId: 'nyayasiddhi_plan_id',
  subscription_id: 'nyayasiddhi_subscription_id',
  subscriptionId: 'nyayasiddhi_subscription_id',
  slot_id: 'nyayasiddhi_slot_id',
  slotId: 'nyayasiddhi_slot_id',
  appointment_id: 'nyayasiddhi_appointment_id',
  appointmentId: 'nyayasiddhi_appointment_id',
  channel_id: 'nyayasiddhi_channel_id',
  channelId: 'nyayasiddhi_channel_id',
  message_id: 'nyayasiddhi_message_id',
  messageId: 'nyayasiddhi_message_id',
  task_id: 'nyayasiddhi_task_id',
  taskId: 'nyayasiddhi_task_id',
  rule_id: 'nyayasiddhi_rule_id',
  ruleId: 'nyayasiddhi_rule_id',
  agent_id: 'nyayasiddhi_agent_id',
  agentId: 'nyayasiddhi_agent_id',
  execution_id: 'nyayasiddhi_execution_id',
  executionId: 'nyayasiddhi_execution_id',
  kb_entry_id: 'nyayasiddhi_kb_entry_id',
  kbEntryId: 'nyayasiddhi_kb_entry_id',
  hearing_id: 'nyayasiddhi_hearing_id',
  hearingId: 'nyayasiddhi_hearing_id',
  lawyer_id: 'nyayasiddhi_lawyer_id',
  lawyerId: 'nyayasiddhi_lawyer_id',
  notification_id: 'nyayasiddhi_notification_id',
  notificationId: 'nyayasiddhi_notification_id',
  audit_id: 'nyayasiddhi_audit_id',
  auditId: 'nyayasiddhi_audit_id',
  file_id: 'nyayasiddhi_file_id',
  fileId: 'nyayasiddhi_file_id',
  job_id: 'nyayasiddhi_job_id',
  jobId: 'nyayasiddhi_job_id',
  document_id: 'nyayasiddhi_document_id',
  documentId: 'nyayasiddhi_document_id',
  usage_id: 'nyayasiddhi_usage_id',
  usageId: 'nyayasiddhi_usage_id',
};

function mapEntityIds(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(mapEntityIds);
  if (typeof obj !== 'object') return obj;

  const mapped: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const mappedKey = ENTITY_ID_MAP[key] || key;
    mapped[mappedKey] = typeof value === 'object' ? mapEntityIds(value) : value;
  }
  return mapped;
}

export function nsResponseMapper() {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    res.json = function (body: any) {
      if (body && typeof body === 'object' && body.success !== undefined) {
        if (body.data) {
          body.data = mapEntityIds(body.data);
        }
      }
      return originalJson(body);
    };

    next();
  };
}

export function mapMatterToCaseResponse(matter: any): any {
  if (!matter) return matter;

  const mapped: any = {
    nyayasiddhi_case_id: matter.id,
    title: matter.title,
    case_type: matter.matter_type || matter.case_type || matter.type,
    case_status: matter.status || 'new',
    case_number: matter.case_number || matter.matter_number || null,
    filing_status: matter.filing_status || 'pre_filing',
    court_type: matter.court_type || null,
    court_name: matter.court_name || null,
    priority: matter.priority || 'normal',
    practice_area: matter.practice_area || null,
    jurisdiction: matter.jurisdiction || null,
    nyayasiddhi_org_id: matter.organization_id,
    nyayasiddhi_tenant_id: matter.organization_id,
    created_by: matter.created_by,
    assigned_to: matter.assigned_to_user_id || null,
    filed_at: matter.filing_date || null,
    closed_at: matter.closed_at || null,
    created_at: matter.created_at,
    updated_at: matter.updated_at,
  };

  if (matter.client_name) mapped.client_name = matter.client_name;
  if (matter.description) mapped.description = matter.description;
  if (matter.ai_summary) mapped.ai_summary = matter.ai_summary;
  if (matter.risk_level) mapped.risk_level = matter.risk_level;
  if (matter.parent_matter_id) mapped.parent_case_id = matter.parent_matter_id;

  return mapped;
}

export function mapClientResponse(client: any): any {
  if (!client) return client;

  return {
    nyayasiddhi_client_id: client.id,
    client_name: client.name || client.client_name,
    client_type: client.client_type || 'individual',
    client_code: client.client_code || null,
    email: client.email,
    mobile: client.phone,
    city: client.city || null,
    state: client.state || null,
    country: client.country || 'India',
    company_name: client.company_name || null,
    gst_number: client.gst_number || null,
    pan_number: client.pan_number || null,
    source: client.source || 'direct',
    notes: client.notes || null,
    nyayasiddhi_org_id: client.organization_id,
    nyayasiddhi_tenant_id: client.organization_id,
    created_by: client.created_by,
    created_at: client.created_at,
    status: client.status,
  };
}

export function mapDocumentResponse(draft: any): any {
  if (!draft) return draft;

  return {
    nyayasiddhi_document_id: draft.id,
    file_name: draft.title || draft.file_name,
    document_type: draft.document_type || draft.type || 'draft_pleading',
    category: draft.category || null,
    content: draft.content,
    version: draft.version || 1,
    status: draft.status || 'draft',
    file_path: draft.file_path || null,
    file_size: draft.file_size || null,
    mime_type: draft.mime_type || null,
    ai_generated: draft.ai_generated || false,
    nyayasiddhi_case_id: draft.matter_id,
    nyayasiddhi_org_id: draft.organization_id,
    nyayasiddhi_tenant_id: draft.organization_id,
    created_by: draft.created_by,
    created_at: draft.created_at,
    updated_at: draft.updated_at,
  };
}

export { ENTITY_ID_MAP, mapEntityIds };
