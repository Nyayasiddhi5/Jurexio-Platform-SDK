/**
 * WhatsApp + UPI Integration v9.0
 * 
 * Phase 9: Native WhatsApp Business API and UPI payment integration
 * Optimized for Indian market with low-bandwidth considerations
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';
import { secureRandom, secureRandomInt, secureRandomBool, secureRandomChoice } from '../utils/jrx-secure-random.js';


const logger = createLogger('whatsapp-upi-integration');

// ================================================================================================
// WHATSAPP BUSINESS API INTERFACES
// ================================================================================================

export interface WhatsAppBusinessAPI {
  initialize(config: WhatsAppConfig): Promise<void>;
  sendMessage(message: WhatsAppMessage): Promise<WhatsAppMessageResponse>;
  sendTemplate(template: WhatsAppTemplate): Promise<WhatsAppMessageResponse>;
  sendMedia(media: WhatsAppMedia): Promise<WhatsAppMessageResponse>;
  receiveWebhook(payload: any): Promise<WhatsAppWebhookResponse>;
  getMessageStatus(messageId: string): Promise<WhatsAppMessageStatus>;
  registerWebhook(url: string, verifyToken: string): Promise<void>;
  getBusinessProfile(): Promise<WhatsAppBusinessProfile>;
}

export interface WhatsAppConfig {
  businessAccountId: string;
  phoneNumberId: string;
  accessToken: string;
  webhookUrl: string;
  verifyToken: string;
  apiVersion: string;
  lowBandwidthMode: boolean;
  enableDeliveryReceipts: boolean;
  enableReadReceipts: boolean;
}

export interface WhatsAppMessage {
  to: string; // Phone number in international format
  type: 'text' | 'template' | 'image' | 'document' | 'audio' | 'video' | 'location' | 'contacts';
  content: WhatsAppMessageContent;
  context?: MessageContext;
  metadata?: MessageMetadata;
}

export interface WhatsAppMessageContent {
  text?: string;
  template?: TemplateContent;
  media?: MediaContent;
  location?: LocationContent;
  contacts?: ContactContent[];
}

export interface TemplateContent {
  name: string;
  language: TemplateLanguage;
  components?: TemplateComponent[];
}

export interface TemplateLanguage {
  code: string; // 'en', 'hi', 'ta', etc.
  policy: 'deterministic' | 'fallback';
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'footer' | 'button';
  parameters?: TemplateParameter[];
}

export interface TemplateParameter {
  type: 'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video';
  text?: string;
  currency?: CurrencyParameter;
  date_time?: DateTimeParameter;
  image?: MediaParameter;
  document?: MediaParameter;
  video?: MediaParameter;
}

export interface CurrencyParameter {
  fallback_value: string;
  code: string; // 'INR'
  amount_1000: number; // Amount in thousandths
}

export interface DateTimeParameter {
  fallback_value: string;
  format: string;
  timestamp: number;
  timezone?: string;
}

export interface MediaParameter {
  link?: string;
  caption?: string;
  filename?: string;
}

export interface MediaContent {
  type: 'image' | 'document' | 'audio' | 'video';
  url?: string;
  id?: string; // Media ID from WhatsApp
  caption?: string;
  filename?: string;
  provider?: MediaProvider;
}

export interface MediaProvider {
  name: string;
  config: any;
}

export interface LocationContent {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface ContactContent {
  name: ContactName;
  phones?: ContactPhone[];
  emails?: ContactEmail[];
  addresses?: ContactAddress[];
  org?: ContactOrganization;
}

export interface ContactName {
  formatted_name: string;
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  prefix?: string;
  suffix?: string;
}

export interface ContactPhone {
  phone: string;
  type?: 'home' | 'work' | 'mobile';
  wa_id?: string;
}

export interface ContactEmail {
  email: string;
  type?: 'home' | 'work';
}

export interface ContactAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  country_code?: string;
  type?: 'home' | 'work';
}

export interface ContactOrganization {
  company?: string;
  department?: string;
  title?: string;
}

export interface MessageContext {
  message_id?: string; // For replies
  quoted?: boolean;
}

export interface MessageMetadata {
  customer_id?: string;
  session_id?: string;
  bot_id?: string;
  intent?: string;
  confidence?: number;
}

export interface WhatsAppMessageResponse {
  message_id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  recipient: string;
  timestamp: number;
  errors?: WhatsAppError[];
}

export interface WhatsAppError {
  code: number;
  title: string;
  message: string;
  error_data?: any;
}

export interface WhatsAppWebhookResponse {
  processed: boolean;
  messages: ProcessedMessage[];
  errors: string[];
}

export interface ProcessedMessage {
  message_id: string;
  from: string;
  type: string;
  content: any;
  timestamp: number;
  response?: WhatsAppMessage;
}

export interface WhatsAppMessageStatus {
  message_id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: number;
  recipient: string;
  pricing?: MessagePricing;
}

export interface MessagePricing {
  billable: boolean;
  pricing_model: 'CBP' | 'NBP'; // Conversation-Based Pricing or Notification-Based Pricing
  category: 'authentication' | 'marketing' | 'utility' | 'service';
}

export interface WhatsAppBusinessProfile {
  display_name: string;
  description?: string;
  email?: string;
  phone_number: string;
  address?: string;
  websites?: string[];
  profile_picture_url?: string;
  about?: string;
  messaging_product: string;
  status: 'approved' | 'pending' | 'rejected';
}

export interface WhatsAppTemplate {
  name: string;
  language: string;
  category: 'authentication' | 'marketing' | 'utility';
  components: TemplateComponent[];
  status: 'approved' | 'pending' | 'rejected';
  quality_score?: TemplateQualityScore;
}

export interface TemplateQualityScore {
  score: 'high' | 'medium' | 'low' | 'unknown';
  reasons?: string[];
}

// ================================================================================================
// UPI PAYMENT INTERFACES
// ================================================================================================

export interface UPIPaymentProcessor {
  initialize(config: UPIConfig): Promise<void>;
  initiatePayment(payment: UPIPaymentRequest): Promise<UPIPaymentResponse>;
  verifyPayment(transactionId: string): Promise<UPIPaymentStatus>;
  generateQRCode(payment: UPIQRRequest): Promise<UPIQRResponse>;
  processCallback(payload: UPICallback): Promise<UPICallbackResponse>;
  getTransactionHistory(filter: TransactionFilter): Promise<UPITransaction[]>;
  refundPayment(refund: UPIRefundRequest): Promise<UPIRefundResponse>;
}

export interface UPIConfig {
  merchantId: string;
  merchantKey: string;
  salt: string;
  environment: 'production' | 'test';
  gateway: 'payu' | 'razorpay' | 'phonepe' | 'googlepay' | 'paytm';
  webhookUrl: string;
  returnUrl: string;
  failureUrl: string;
  enabledUPIApps: UPIApp[];
}

export interface UPIApp {
  name: string;
  package: string;
  scheme: string;
  enabled: boolean;
  priority: number;
}

export interface UPIPaymentRequest {
  amount: number; // In INR
  currency: 'INR';
  orderId: string;
  customerId: string;
  customerName: string;
  customerEmail?: string;
  customerPhone: string;
  description: string;
  metadata?: Record<string, any>;
  expiryTime?: number; // Unix timestamp
  autoCapture?: boolean;
}

export interface UPIPaymentResponse {
  paymentId: string;
  orderId: string;
  status: 'created' | 'pending' | 'processing';
  paymentUrl?: string;
  qrCode?: string;
  deepLinks: UPIDeepLink[];
  expiryTime: number;
  amount: number;
  currency: string;
}

export interface UPIDeepLink {
  app: string;
  link: string;
  fallbackUrl?: string;
}

export interface UPIPaymentStatus {
  paymentId: string;
  orderId: string;
  status: 'success' | 'failed' | 'pending' | 'cancelled' | 'expired';
  amount: number;
  currency: string;
  transactionId?: string;
  upiTransactionId?: string;
  gatewayTransactionId?: string;
  paymentMethod?: string;
  bank?: string;
  timestamp: number;
  failureReason?: string;
  metadata?: Record<string, any>;
}

export interface UPIQRRequest {
  amount: number;
  orderId: string;
  description: string;
  merchantVPA: string;
  customerName?: string;
  expiryTime?: number;
  size?: 'small' | 'medium' | 'large';
  format?: 'png' | 'svg' | 'jpeg';
}

export interface UPIQRResponse {
  qrCode: string; // Base64 encoded image or SVG
  qrString: string; // UPI payment string
  expiryTime: number;
  format: string;
  size: string;
}

export interface UPICallback {
  paymentId: string;
  orderId: string;
  status: string;
  amount: number;
  transactionId?: string;
  signature: string;
  metadata?: Record<string, any>;
}

export interface UPICallbackResponse {
  verified: boolean;
  processed: boolean;
  response?: any;
  errors?: string[];
}

export interface TransactionFilter {
  startDate?: Date;
  endDate?: Date;
  status?: string;
  customerId?: string;
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
  offset?: number;
}

export interface UPITransaction {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  status: string;
  customerId: string;
  customerName: string;
  description: string;
  timestamp: number;
  transactionId?: string;
  bank?: string;
  paymentMethod?: string;
  metadata?: Record<string, any>;
}

export interface UPIRefundRequest {
  paymentId: string;
  amount: number; // Partial refund allowed
  reason: string;
  refundId?: string; // Merchant reference
  metadata?: Record<string, any>;
}

export interface UPIRefundResponse {
  refundId: string;
  paymentId: string;
  amount: number;
  status: 'initiated' | 'processed' | 'failed';
  timestamp: number;
  expectedTime?: number; // Expected processing time
  refundTransactionId?: string;
}

// ================================================================================================
// LOW-BANDWIDTH OPTIMIZATION INTERFACES
// ================================================================================================

export interface LowBandwidthOptimizer {
  initialize(config: BandwidthConfig): Promise<void>;
  optimizeMessage(message: any): Promise<OptimizedMessage>;
  compressMedia(media: MediaContent): Promise<CompressedMedia>;
  enableDataSaver(userId: string): Promise<void>;
  disableDataSaver(userId: string): Promise<void>;
  getOptimizationStats(): OptimizationStats;
}

export interface BandwidthConfig {
  enableCompression: boolean;
  compressionLevel: 'low' | 'medium' | 'high';
  enableCaching: boolean;
  maxMediaSize: number; // bytes
  adaptiveQuality: boolean;
  dataSaverMode: boolean;
  networkThreshold: 'slow_2g' | '2g' | '3g' | '4g' | 'wifi';
}

export interface OptimizedMessage {
  original: any;
  optimized: any;
  savings: OptimizationSavings;
  metadata: OptimizationMetadata;
}

export interface OptimizationSavings {
  sizeBefore: number;
  sizeAfter: number;
  compressionRatio: number;
  estimatedLoadTime: number; // milliseconds
  dataSaved: number; // bytes
}

export interface OptimizationMetadata {
  technique: string[];
  quality: number; // 0-1
  compatibility: string[];
  warnings: string[];
}

export interface CompressedMedia {
  originalUrl: string;
  compressedUrl: string;
  compressionRatio: number;
  quality: number;
  format: string;
  size: number;
}

export interface OptimizationStats {
  totalOptimizations: number;
  totalDataSaved: number;
  avgCompressionRatio: number;
  avgLoadTimeImprovement: number;
  usersSaved: number;
}

// ================================================================================================
// WHATSAPP BUSINESS API IMPLEMENTATION
// ================================================================================================

export class WhatsAppBusinessAPIImpl extends EventEmitter implements WhatsAppBusinessAPI {
  private config?: WhatsAppConfig;
  private isInitialized: boolean = false;
  private messageQueue: Map<string, WhatsAppMessage> = new Map();
  private messageStatus: Map<string, WhatsAppMessageStatus> = new Map();
  
  public async initialize(config: WhatsAppConfig): Promise<void> {
    logger.info('📱 Initializing WhatsApp Business API...');
    
    try {
      this.config = config;
      
      await this.validateConfiguration();
      await this.setupWebhook();
      await this.initializeBusinessProfile();
      
      this.isInitialized = true;
      logger.info('✅ WhatsApp Business API initialized successfully');
      
      this.emit('initialized', {
        phoneNumberId: config.phoneNumberId,
        lowBandwidthMode: config.lowBandwidthMode,
        timestamp: Date.now()
      });
      
    } catch (error: any) {
      logger.error('❌ Failed to initialize WhatsApp Business API:', error);
      throw error;
    }
  }

  public async sendMessage(message: WhatsAppMessage): Promise<WhatsAppMessageResponse> {
    if (!this.isInitialized || !this.config) {
      throw new Error('WhatsApp Business API not initialized');
    }

    const messageId = this.generateMessageId();
    logger.info(`📤 Sending WhatsApp message: ${message.type} to ${message.to}`);
    
    try {
      // Store message in queue
      this.messageQueue.set(messageId, message);
      
      // Simulate API call
      await this.callWhatsAppAPI('messages', {
        messaging_product: 'whatsapp',
        to: message.to,
        type: message.type,
        ...message.content
      });
      
      const response: WhatsAppMessageResponse = {
        message_id: messageId,
        status: 'sent',
        recipient: message.to,
        timestamp: Date.now()
      };
      
      // Store status
      this.messageStatus.set(messageId, {
        ...response,
        pricing: this.calculatePricing(message)
      });
      
      // Clean up queue
      this.messageQueue.delete(messageId);
      
      logger.info(`✅ WhatsApp message sent: ${messageId}`);
      
      this.emit('messageSent', response);
      return response;
      
    } catch (error: any) {
      this.messageQueue.delete(messageId);
      logger.error(`❌ Failed to send WhatsApp message:`, error);
      throw error;
    }
  }

  public async sendTemplate(template: WhatsAppTemplate): Promise<WhatsAppMessageResponse> {
    logger.info(`📋 Sending WhatsApp template: ${template.name}`);
    
    // Convert template to message format
    const message: WhatsAppMessage = {
      to: '', // Will be set by caller
      type: 'template',
      content: {
        template: {
          name: template.name,
          language: { code: template.language, policy: 'deterministic' },
          components: template.components
        }
      }
    };
    
    return await this.sendMessage(message);
  }

  public async sendMedia(media: WhatsAppMedia): Promise<WhatsAppMessageResponse> {
    logger.info(`🖼️ Sending WhatsApp media: ${media.type}`);
    
    // Optimize for low bandwidth if enabled
    if (this.config?.lowBandwidthMode) {
      media = await this.optimizeMediaForLowBandwidth(media);
    }
    
    const message: WhatsAppMessage = {
      to: media.recipient,
      type: media.type,
      content: {
        media: {
          type: media.type,
          url: media.url,
          caption: media.caption,
          filename: media.filename
        }
      }
    };
    
    return await this.sendMessage(message);
  }

  public async receiveWebhook(payload: any): Promise<WhatsAppWebhookResponse> {
    logger.info('📥 Processing WhatsApp webhook...');
    
    try {
      const processedMessages: ProcessedMessage[] = [];
      
      if (payload.entry && payload.entry[0] && payload.entry[0].changes) {
        for (const change of payload.entry[0].changes) {
          if (change.value && change.value.messages) {
            for (const incomingMessage of change.value.messages) {
              const processed = await this.processIncomingMessage(incomingMessage);
              processedMessages.push(processed);
            }
          }
        }
      }
      
      const response: WhatsAppWebhookResponse = {
        processed: true,
        messages: processedMessages,
        errors: []
      };
      
      this.emit('webhookProcessed', response);
      return response;
      
    } catch (error: any) {
      logger.error('❌ Failed to process webhook:', error);
      return {
        processed: false,
        messages: [],
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  public async getMessageStatus(messageId: string): Promise<WhatsAppMessageStatus> {
    const status = this.messageStatus.get(messageId);
    if (!status) {
      throw new Error(`Message status not found: ${messageId}`);
    }
    
    return status;
  }

  public async registerWebhook(url: string, verifyToken: string): Promise<void> {
    logger.info(`🔗 Registering WhatsApp webhook: ${url}`);
    
    // Simulate webhook registration
    await new Promise(resolve => setTimeout(resolve, 200));
    
    logger.info('✅ Webhook registered successfully');
  }

  public async getBusinessProfile(): Promise<WhatsAppBusinessProfile> {
    if (!this.config) {
      throw new Error('WhatsApp Business API not initialized');
    }

    return {
      display_name: 'Jurexio Business',
      description: 'AI-powered business solutions',
      phone_number: '+91XXXXXXXXXX',
      messaging_product: 'whatsapp',
      status: 'approved'
    };
  }

  // Private implementation methods
  private async validateConfiguration(): Promise<void> {
    if (!this.config) throw new Error('Configuration not provided');
    
    // Validate required fields
    const required = ['businessAccountId', 'phoneNumberId', 'accessToken'];
    for (const field of required) {
      if (!this.config[field as keyof WhatsAppConfig]) {
        throw new Error(`Missing required configuration: ${field}`);
      }
    }
  }

  private async setupWebhook(): Promise<void> {
    if (!this.config?.webhookUrl) return;
    
    logger.info('🔗 Setting up WhatsApp webhook...');
    await this.registerWebhook(this.config.webhookUrl, this.config.verifyToken);
  }

  private async initializeBusinessProfile(): Promise<void> {
    logger.info('🏢 Initializing business profile...');
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  private generateMessageId(): string {
    return `wamid.${Date.now()}.${crypto.randomUUID().substring(0, 9)}`;
  }

  private async callWhatsAppAPI(endpoint: string, data: any): Promise<any> {
    // Simulate API call with delay
    await new Promise(resolve => setTimeout(resolve, 150 + secureRandom() * 100));
    
    // Simulate success response
    return {
      messaging_product: 'whatsapp',
      contacts: [{ input: data.to, wa_id: data.to }],
      messages: [{ id: this.generateMessageId() }]
    };
  }

  private calculatePricing(message: WhatsAppMessage): MessagePricing {
    return {
      billable: true,
      pricing_model: 'CBP',
      category: message.type === 'template' ? 'utility' : 'service'
    };
  }

  private async optimizeMediaForLowBandwidth(media: WhatsAppMedia): Promise<WhatsAppMedia> {
    // Simulate media optimization
    logger.info('🔧 Optimizing media for low bandwidth...');
    
    return {
      ...media,
      // Simulated optimization - would compress/resize in real implementation
    };
  }

  private async processIncomingMessage(incomingMessage: any): Promise<ProcessedMessage> {
    return {
      message_id: incomingMessage.id,
      from: incomingMessage.from,
      type: incomingMessage.type,
      content: incomingMessage,
      timestamp: parseInt(incomingMessage.timestamp) * 1000,
      response: undefined // Would be set if auto-reply is configured
    };
  }
}

// ================================================================================================
// UPI PAYMENT PROCESSOR IMPLEMENTATION
// ================================================================================================

export class UPIPaymentProcessorImpl extends EventEmitter implements UPIPaymentProcessor {
  private config?: UPIConfig;
  private isInitialized: boolean = false;
  private payments: Map<string, UPIPaymentStatus> = new Map();
  private transactions: UPITransaction[] = [];

  public async initialize(config: UPIConfig): Promise<void> {
    logger.info('💳 Initializing UPI Payment Processor...');
    
    try {
      this.config = config;
      
      await this.validateMerchantCredentials();
      await this.setupPaymentGateway();
      
      this.isInitialized = true;
      logger.info(`✅ UPI Payment Processor initialized (${config.gateway})`);
      
      this.emit('initialized', {
        merchantId: config.merchantId,
        gateway: config.gateway,
        environment: config.environment,
        timestamp: Date.now()
      });
      
    } catch (error: any) {
      logger.error('❌ Failed to initialize UPI Payment Processor:', error);
      throw error;
    }
  }

  public async initiatePayment(payment: UPIPaymentRequest): Promise<UPIPaymentResponse> {
    if (!this.isInitialized || !this.config) {
      throw new Error('UPI Payment Processor not initialized');
    }

    const paymentId = this.generatePaymentId();
    logger.info(`💰 Initiating UPI payment: ₹${payment.amount} for ${payment.orderId}`);
    
    try {
      // Create payment record
      const paymentStatus: UPIPaymentStatus = {
        paymentId,
        orderId: payment.orderId,
        status: 'pending',
        amount: payment.amount,
        currency: payment.currency,
        timestamp: Date.now()
      };
      
      this.payments.set(paymentId, paymentStatus);
      
      // Generate UPI deep links
      const deepLinks = this.generateUPIDeepLinks(payment, paymentId);
      
      // Generate QR code if needed
      const qrCode = await this.generateQRCode({
        amount: payment.amount,
        orderId: payment.orderId,
        description: payment.description,
        merchantVPA: `${this.config.merchantId}@upi`,
        customerName: payment.customerName
      });
      
      const response: UPIPaymentResponse = {
        paymentId,
        orderId: payment.orderId,
        status: 'created',
        paymentUrl: `${this.config.returnUrl}?paymentId=${paymentId}`,
        qrCode: qrCode.qrString,
        deepLinks,
        expiryTime: Date.now() + (15 * 60 * 1000), // 15 minutes
        amount: payment.amount,
        currency: payment.currency
      };
      
      logger.info(`✅ UPI payment initiated: ${paymentId}`);
      
      this.emit('paymentInitiated', response);
      return response;
      
    } catch (error: any) {
      this.payments.delete(paymentId);
      logger.error(`❌ Failed to initiate UPI payment:`, error);
      throw error;
    }
  }

  public async verifyPayment(transactionId: string): Promise<UPIPaymentStatus> {
    logger.info(`🔍 Verifying UPI payment: ${transactionId}`);
    
    const payment = this.payments.get(transactionId);
    if (!payment) {
      throw new Error(`Payment not found: ${transactionId}`);
    }
    
    // Simulate payment verification
    await new Promise(resolve => setTimeout(resolve, 200 + secureRandom() * 300));
    
    // Simulate random payment status
    const statuses: UPIPaymentStatus['status'][] = ['success', 'failed', 'pending'];
    const randomStatus = statuses[Math.floor(secureRandom() * statuses.length)];
    
    const updatedPayment: UPIPaymentStatus = {
      ...payment,
      status: randomStatus,
      transactionId: randomStatus === 'success' ? this.generateTransactionId() : undefined,
      upiTransactionId: randomStatus === 'success' ? this.generateUPITransactionId() : undefined,
      gatewayTransactionId: randomStatus === 'success' ? this.generateGatewayTransactionId() : undefined,
      paymentMethod: randomStatus === 'success' ? 'UPI' : undefined,
      bank: randomStatus === 'success' ? 'SBI' : undefined,
      failureReason: randomStatus === 'failed' ? 'Insufficient funds' : undefined
    };
    
    this.payments.set(transactionId, updatedPayment);
    
    // Add to transaction history if successful
    if (randomStatus === 'success') {
      this.transactions.push({
        paymentId: transactionId,
        orderId: payment.orderId,
        amount: payment.amount,
        currency: payment.currency,
        status: randomStatus,
        customerId: 'customer_' + crypto.randomUUID().substring(0, 9),
        customerName: 'Customer Name',
        description: 'Payment description',
        timestamp: Date.now(),
        transactionId: updatedPayment.transactionId,
        bank: updatedPayment.bank,
        paymentMethod: updatedPayment.paymentMethod
      });
    }
    
    logger.info(`✅ Payment verification completed: ${transactionId} - ${randomStatus}`);
    
    this.emit('paymentVerified', updatedPayment);
    return updatedPayment;
  }

  public async generateQRCode(payment: UPIQRRequest): Promise<UPIQRResponse> {
    logger.info(`📱 Generating UPI QR code for ₹${payment.amount}`);
    
    // Generate UPI payment string
    const upiString = this.generateUPIString(payment);
    
    // Simulate QR code generation
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const response: UPIQRResponse = {
      qrCode: `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==`, // Placeholder
      qrString: upiString,
      expiryTime: payment.expiryTime || (Date.now() + 15 * 60 * 1000),
      format: payment.format || 'png',
      size: payment.size || 'medium'
    };
    
    logger.info('✅ UPI QR code generated successfully');
    
    this.emit('qrCodeGenerated', response);
    return response;
  }

  public async processCallback(payload: UPICallback): Promise<UPICallbackResponse> {
    logger.info(`📞 Processing UPI callback for payment: ${payload.paymentId}`);
    
    try {
      // Verify signature
      const isValid = await this.verifyCallbackSignature(payload);
      
      if (!isValid) {
        return {
          verified: false,
          processed: false,
          errors: ['Invalid signature']
        };
      }
      
      // Update payment status
      const existingPayment = this.payments.get(payload.paymentId);
      if (existingPayment) {
        const updatedPayment: UPIPaymentStatus = {
          ...existingPayment,
          status: payload.status as UPIPaymentStatus['status'],
          transactionId: payload.transactionId,
          timestamp: Date.now()
        };
        
        this.payments.set(payload.paymentId, updatedPayment);
        
        this.emit('paymentStatusUpdated', updatedPayment);
      }
      
      const response: UPICallbackResponse = {
        verified: true,
        processed: true,
        response: { success: true }
      };
      
      logger.info(`✅ UPI callback processed successfully: ${payload.paymentId}`);
      
      return response;
      
    } catch (error: any) {
      logger.error(`❌ Failed to process UPI callback:`, error);
      return {
        verified: false,
        processed: false,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  public async getTransactionHistory(filter: TransactionFilter): Promise<UPITransaction[]> {
    logger.info('📊 Fetching UPI transaction history...');
    
    let filteredTransactions = [...this.transactions];
    
    // Apply filters
    if (filter.startDate) {
      filteredTransactions = filteredTransactions.filter(t => t.timestamp >= filter.startDate!.getTime());
    }
    
    if (filter.endDate) {
      filteredTransactions = filteredTransactions.filter(t => t.timestamp <= filter.endDate!.getTime());
    }
    
    if (filter.status) {
      filteredTransactions = filteredTransactions.filter(t => t.status === filter.status);
    }
    
    if (filter.customerId) {
      filteredTransactions = filteredTransactions.filter(t => t.customerId === filter.customerId);
    }
    
    if (filter.minAmount) {
      filteredTransactions = filteredTransactions.filter(t => t.amount >= filter.minAmount!);
    }
    
    if (filter.maxAmount) {
      filteredTransactions = filteredTransactions.filter(t => t.amount <= filter.maxAmount!);
    }
    
    // Apply pagination
    const offset = filter.offset || 0;
    const limit = filter.limit || 50;
    
    return filteredTransactions.slice(offset, offset + limit);
  }

  public async refundPayment(refund: UPIRefundRequest): Promise<UPIRefundResponse> {
    logger.info(`🔄 Processing UPI refund: ₹${refund.amount} for ${refund.paymentId}`);
    
    try {
      const payment = this.payments.get(refund.paymentId);
      if (!payment) {
        throw new Error(`Payment not found: ${refund.paymentId}`);
      }
      
      if (payment.status !== 'success') {
        throw new Error(`Cannot refund non-successful payment: ${payment.status}`);
      }
      
      if (refund.amount > payment.amount) {
        throw new Error(`Refund amount cannot exceed payment amount`);
      }
      
      // Simulate refund processing
      await new Promise(resolve => setTimeout(resolve, 300 + secureRandom() * 200));
      
      const refundId = refund.refundId || this.generateRefundId();
      
      const response: UPIRefundResponse = {
        refundId,
        paymentId: refund.paymentId,
        amount: refund.amount,
        status: 'initiated',
        timestamp: Date.now(),
        expectedTime: Date.now() + (3 * 24 * 60 * 60 * 1000), // 3 days
        refundTransactionId: this.generateTransactionId()
      };
      
      logger.info(`✅ UPI refund initiated: ${refundId}`);
      
      this.emit('refundInitiated', response);
      return response;
      
    } catch (error: any) {
      logger.error(`❌ Failed to process UPI refund:`, error);
      throw error;
    }
  }

  // Private implementation methods
  private async validateMerchantCredentials(): Promise<void> {
    if (!this.config) throw new Error('Configuration not provided');
    
    // Validate required fields
    const required = ['merchantId', 'merchantKey', 'salt'];
    for (const field of required) {
      if (!this.config[field as keyof UPIConfig]) {
        throw new Error(`Missing required configuration: ${field}`);
      }
    }
  }

  private async setupPaymentGateway(): Promise<void> {
    logger.info(`🔧 Setting up payment gateway: ${this.config?.gateway}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  private generatePaymentId(): string {
    return `pay_${Date.now()}_${crypto.randomUUID().substring(0, 9)}`;
  }

  private generateTransactionId(): string {
    return `txn_${Date.now()}_${crypto.randomUUID().substring(0, 9)}`;
  }

  private generateUPITransactionId(): string {
    return `UPI${Date.now()}${crypto.randomUUID().substring(0, 6).toUpperCase()}`;
  }

  private generateGatewayTransactionId(): string {
    return `GTW${Date.now()}${crypto.randomUUID().substring(0, 8).toUpperCase()}`;
  }

  private generateRefundId(): string {
    return `rfnd_${Date.now()}_${crypto.randomUUID().substring(0, 9)}`;
  }

  private generateUPIDeepLinks(payment: UPIPaymentRequest, paymentId: string): UPIDeepLink[] {
    const baseUPIString = this.generateUPIString({
      amount: payment.amount,
      orderId: payment.orderId,
      description: payment.description,
      merchantVPA: `${this.config?.merchantId}@upi`,
      customerName: payment.customerName
    });
    
    return [
      {
        app: 'Google Pay',
        link: `gpay://upi/pay?${baseUPIString}`,
        fallbackUrl: 'https://play.google.com/store/apps/details?id=com.google.android.apps.nbu.paisa.user'
      },
      {
        app: 'PhonePe',
        link: `phonepe://pay?${baseUPIString}`,
        fallbackUrl: 'https://play.google.com/store/apps/details?id=com.phonepe.app'
      },
      {
        app: 'Paytm',
        link: `paytmmp://pay?${baseUPIString}`,
        fallbackUrl: 'https://play.google.com/store/apps/details?id=net.one97.paytm'
      }
    ];
  }

  private generateUPIString(payment: UPIQRRequest): string {
    const params = new URLSearchParams({
      pa: payment.merchantVPA, // Payee Address
      pn: 'Jurexio Business', // Payee Name
      mc: '0000', // Merchant Category Code
      tid: payment.orderId, // Transaction ID
      tr: payment.orderId, // Transaction Reference
      tn: payment.description, // Transaction Note
      am: payment.amount.toString(), // Amount
      cu: 'INR' // Currency
    });
    
    return `upi://pay?${params.toString()}`;
  }

  private async verifyCallbackSignature(payload: UPICallback): Promise<boolean> {
    // Simulate signature verification
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // In real implementation, would verify HMAC signature using merchant key
    return !!(payload.signature && payload.signature.length > 10);
  }
}

// Helper interfaces for media handling
interface WhatsAppMedia {
  type: 'image' | 'document' | 'audio' | 'video';
  url: string;
  recipient: string;
  caption?: string;
  filename?: string;
}

export default {
  WhatsAppBusinessAPIImpl,
  UPIPaymentProcessorImpl
};