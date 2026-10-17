export interface GstInvoiceRequest {
  customer_name: string;
  customer_gstin?: string;
  customer_state_code?: string;
  customer_address?: string;
  supplier_gstin?: string;
  supplier_state_code?: string;
  plan_name: string;
  period: string;
  base_amount: number;
  is_b2b?: boolean;
  notes?: string;
  description?: string;
  hsn_code?: string;
}

export interface GstLineItem {
  description: string;
  hsn_code: string;
  quantity: number;
  rate: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface GstInvoiceResult {
  invoice_number: string;
  invoice_date: string;
  date: string;
  gst_type: 'IGST' | 'CGST+SGST';
  supply_type: 'intra-state' | 'inter-state';
  base_amount: number;
  total_gst: number;
  total_tax: number;
  total_amount: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  line_items?: GstLineItem[];
}

export interface CreditWallet {
  wallet_id: string;
  user_id: string;
  credits_balance: number;
  balance: number;
  reserved_credits: number;
  reserved: number;
  available_credits: number;
  available: number;
  credits_expiry: string | null;
  expiry: string | null;
  low_balance: boolean;
  last_updated: string;
}
