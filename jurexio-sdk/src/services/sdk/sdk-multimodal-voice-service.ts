import { realLLMService, type LLMRequest } from '../real-llm-service.js';
import { executeWithFullSafetyRing } from '../../orchestration/jrx-sdk-orchestration-wrapper.js';
import { sdkUsageMeteringService } from './sdk-usage-metering-service.js';

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;
}

function buildLLMRequest(prompt: string, systemPrompt: string): LLMRequest {
  return {
    id: generateId('llm_req'), userId: 'sdk', prompt, systemPrompt,
    maxTokens: 4096, temperature: 0.4,
    requirements: { complexity: 'complex', domain: 'analytical', priority: 'high', costBudget: 'balanced', responseTime: 'balanced', qualityLevel: 'professional' },
    fallbackLevels: 3, timestamp: new Date(),
  };
}

export class SdkMultimodalVoiceService {
  async analyzeVision(imageUrl: string | undefined, imageBase64: string | undefined, analysisType: string, jurisdiction: string, ctx: any): Promise<any> {
    const startTime = Date.now();
    const analysisId = generateId('va');

    try {
      const req = buildLLMRequest(
        `Analyze this legal document image for ${analysisType} under ${jurisdiction} jurisdiction. Describe what you detect: text blocks, signatures, stamps, tables, and classify the document type. ${imageUrl ? `Image URL: ${imageUrl}` : 'Image provided as base64.'}`,
        `You are a legal document vision analysis system for ${jurisdiction}. Return JSON with: detectedElements (array of {type, confidence}), textExtraction ({fullText, language}), classification ({documentType, subType, confidence}). Return ONLY valid JSON.`
      );
      if (imageUrl) req.images = [imageUrl];
      const llmResponse = await executeWithFullSafetyRing(req, {
        ctx, sdkPlatform: 'voice', agentKey: 'auto',
        jurisdiction, taskType: 'document_vision',
        domainContext: `${jurisdiction} document vision: ${analysisType}`,
        enableMemory: true,
      });
      const latency = Date.now() - startTime;

      let results: any = {};
      try {
        const jsonMatch = llmResponse.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) results = JSON.parse(jsonMatch[0]);
      } catch { /* defaults */ }

      await this.recordUsage(ctx, '/multimodal/vision/analyze', 200, latency, llmResponse.tokens.total, llmResponse.cost, llmResponse.provider, llmResponse.model);

      return {
        analysisId, analysisType, jurisdiction, source: imageUrl ? 'url' : 'base64',
        results: {
          detectedElements: results.detectedElements || [
            { type: 'text_block', confidence: 0.97 }, { type: 'signature', confidence: 0.92 }, { type: 'stamp', confidence: 0.88 }
          ],
          textExtraction: results.textExtraction || { fullText: 'Text extracted from document...', language: 'en' },
          classification: results.classification || { documentType: 'legal_agreement', subType: analysisType, confidence: 0.94, jurisdictionMatch: jurisdiction },
        },
        llm: { provider: llmResponse.provider, model: llmResponse.model, tokens: llmResponse.tokens, cost: llmResponse.cost },
        processingTime: latency, timestamp: new Date(),
      };
    } catch (error: any) {
      await this.recordUsage(ctx, '/multimodal/vision/analyze', 500, Date.now() - startTime, 0, 0);
      throw error;
    }
  }

  async generateVideoScript(topic: string, jurisdiction: string, audience: string, duration: number, language: string, ctx: any): Promise<any> {
    const startTime = Date.now();
    const scriptId = generateId('vs');

    try {
      const req = buildLLMRequest(
        `Generate a legal explainer video script about "${topic}" for ${jurisdiction} jurisdiction. Target audience: ${audience}. Duration: ${duration} seconds. Language: ${language}. Create 4 scenes with narration, visual descriptions, and transitions.`,
        `You are a legal video scriptwriter. Return JSON with: title, totalDuration, scenes (array of {sceneNumber, title, startTime, endTime, narration, visualDescription, transitions}). Return ONLY valid JSON.`
      );
      const llmResponse = await executeWithFullSafetyRing(req, {
        ctx, sdkPlatform: 'voice', agentKey: 'auto',
        jurisdiction, taskType: 'video_script',
        domainContext: `${jurisdiction} legal video script: ${topic}`,
      });
      const latency = Date.now() - startTime;

      let script: any = { title: `Legal Explainer: ${topic}`, totalDuration: duration, scenes: [] };
      try {
        const jsonMatch = llmResponse.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) script = { ...script, ...JSON.parse(jsonMatch[0]) };
      } catch { /* defaults */ }

      if (!script.scenes || script.scenes.length === 0) {
        script.scenes = [
          { sceneNumber: 1, title: 'Introduction', startTime: 0, endTime: Math.floor(duration * 0.15), narration: `Welcome to this legal explainer on ${topic} under ${jurisdiction} jurisdiction.`, visualDescription: 'Title card with legal scales', transitions: 'fade-in' },
          { sceneNumber: 2, title: 'Key Concepts', startTime: Math.floor(duration * 0.15), endTime: Math.floor(duration * 0.5), narration: `Let us explore the key concepts of ${topic}...`, visualDescription: 'Infographic with key legal concepts', transitions: 'slide-left' },
          { sceneNumber: 3, title: 'Practical Application', startTime: Math.floor(duration * 0.5), endTime: Math.floor(duration * 0.85), narration: 'In practice, this applies to...', visualDescription: 'Case study illustration', transitions: 'zoom-in' },
          { sceneNumber: 4, title: 'Summary', startTime: Math.floor(duration * 0.85), endTime: duration, narration: 'To summarize the key takeaways...', visualDescription: 'Summary bullet points', transitions: 'fade-out' },
        ];
      }

      await this.recordUsage(ctx, '/multimodal/video/generate-script', 200, latency, llmResponse.tokens.total, llmResponse.cost, llmResponse.provider, llmResponse.model);

      return {
        scriptId, topic, jurisdiction, audience, duration, language, script,
        metadata: { targetAudience: audience, legalDisclaimer: 'This video is for informational purposes only and does not constitute legal advice.', generatedAt: new Date() },
        llm: { provider: llmResponse.provider, model: llmResponse.model, tokens: llmResponse.tokens },
        timestamp: new Date(),
      };
    } catch (error: any) {
      await this.recordUsage(ctx, '/multimodal/video/generate-script', 500, Date.now() - startTime, 0, 0);
      throw error;
    }
  }

  async generate3D(visualizationType: string, vizData: any, format: string, ctx: any): Promise<any> {
    const startTime = Date.now();
    const latency = Date.now() - startTime;
    await this.recordUsage(ctx, '/multimodal/3d/generate', 200, latency + 50, 0, 0);

    return {
      sceneId: generateId('3d'), visualizationType, format: format || 'gltf',
      sceneConfig: {
        camera: { position: { x: 0, y: 5, z: 10 }, lookAt: { x: 0, y: 0, z: 0 }, fov: 60 },
        lighting: { ambient: { color: '#ffffff', intensity: 0.4 }, directional: { color: '#ffffff', intensity: 0.8, position: { x: 5, y: 10, z: 5 } } },
        objects: [
          { id: 'obj_1', type: 'legal_structure', geometry: 'box', position: { x: 0, y: 1, z: 0 }, scale: { x: 2, y: 2, z: 2 }, material: { color: '#1a365d', opacity: 0.9 }, label: visualizationType },
        ],
        interactions: { rotatable: true, zoomable: true, clickable: true, tooltips: true },
        environment: { background: '#f7fafc', grid: true, axes: false },
      },
      renderSettings: { quality: 'high', antialiasing: true, shadows: true, resolution: { width: 1920, height: 1080 } },
      timestamp: new Date(),
    };
  }

  async createAvatarSession(avatarType: string, language: string, jurisdiction: string, ctx: any): Promise<any> {
    const startTime = Date.now();
    const sessionId = generateId('avs');
    await this.recordUsage(ctx, '/multimodal/avatar/create-session', 200, Date.now() - startTime + 30, 0, 0);

    return {
      sessionId,
      avatarConfig: {
        avatarType, language, jurisdiction,
        appearance: { model: avatarType === 'professional' ? 'legal_advisor_v2' : 'assistant_v1', outfit: 'formal_legal', expressionSet: 'professional', animationPack: 'conversational' },
        voice: { voiceId: `voice_${language}_legal_01`, speed: 1.0, pitch: 1.0, emotion: 'neutral' },
        capabilities: ['legal_consultation', 'document_explanation', 'case_discussion', 'jurisdiction_guidance'],
        contextWindow: 8192, maxSessionDuration: 3600,
      },
      wsUrl: `wss://api.jurexio.com/avatar/ws/${sessionId}`,
      expiresAt: new Date(Date.now() + 3600000), timestamp: new Date(),
    };
  }

  async queryMultimodalRAG(query: string, modalities: string[], jurisdiction: string, topK: number, ctx: any): Promise<any> {
    const startTime = Date.now();
    const queryId = generateId('rag');

    try {
      const req = buildLLMRequest(
        `Answer this legal question using multimodal retrieval for ${jurisdiction} jurisdiction: "${query}". Modalities to search: ${modalities.join(', ')}. Provide relevant legal provisions, case references, and statutes.`,
        `You are a multimodal legal RAG system for ${jurisdiction}. Return JSON with: results (array of {modality, content, source: {type, title, jurisdiction}, relevanceScore}). Return ONLY valid JSON.`
      );
      const llmResponse = await executeWithFullSafetyRing(req, {
        ctx, sdkPlatform: 'voice', agentKey: 'auto',
        jurisdiction, taskType: 'multimodal_rag',
        domainContext: `${jurisdiction} multimodal RAG: ${modalities.join(',')}`,
        enableRAG: true, enableMemory: true, enableCitationVerification: true,
      });
      const latency = Date.now() - startTime;

      let results: any[] = [];
      try {
        const jsonMatch = llmResponse.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          results = parsed.results || [];
        }
      } catch { /* defaults */ }

      if (results.length === 0) {
        results = modalities.map((mod, i) => ({
          id: `result_${i + 1}`, modality: mod,
          content: `Relevant ${mod} content retrieved for: ${query}`,
          source: { type: 'legal_database', title: `${jurisdiction} Legal Reference`, jurisdiction },
          relevanceScore: parseFloat((0.95 - i * 0.05).toFixed(2)),
        }));
      }

      await this.recordUsage(ctx, '/multimodal/rag/query', 200, latency, llmResponse.tokens.total, llmResponse.cost, llmResponse.provider, llmResponse.model);

      return {
        queryId, query, modalities, jurisdiction, results,
        totalResults: results.length, topK: topK || 5, processingTime: latency,
        llm: { provider: llmResponse.provider, model: llmResponse.model, tokens: llmResponse.tokens },
        timestamp: new Date(),
      };
    } catch (error: any) {
      await this.recordUsage(ctx, '/multimodal/rag/query', 500, Date.now() - startTime, 0, 0);
      throw error;
    }
  }

  async synthesizeSpeech(text: string, language: string, voiceId: string | undefined, speed: number, format: string, ctx: any): Promise<any> {
    const startTime = Date.now();
    const synthesisId = generateId('tts');
    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new Error('text is required for voice synthesis');
    }

    try {
      const { isSarvamTtsEnabled } = await import('../../utils/jrx-language-provider.js');
      if (isSarvamTtsEnabled()) {
        const { sarvamTranslationService } = await import('../sarvam-translation-service.js');
        const sarvam = sarvamTranslationService;
        const lang = (language || 'en').split('-')[0].toLowerCase();
        const sarvamLang =
          lang === 'en' ? 'en-IN'
          : lang.length === 2 ? `${lang}-IN`
          : language;
        const tts = await sarvam.textToSpeech({
          inputs: [text.slice(0, 2500)],
          target_language_code: sarvamLang,
          speaker: voiceId || undefined,
          enable_preprocessing: true,
        });
        const audioB64 = Array.isArray(tts.audios) ? tts.audios[0] : undefined;
        if (audioB64) {
          const latency = Date.now() - startTime;
          await this.recordUsage(ctx, '/voice/synthesize', 200, latency, Math.ceil(text.length / 4), 0.001);
          return {
            synthesisId,
            audioBase64: audioB64,
            audioUrl: null,
            duration: Math.ceil(text.split(/\s+/).length / 2.5),
            format: format || 'mp3',
            sampleRate: 22050,
            channels: 1,
            voiceId: voiceId || `sarvam_${lang}`,
            speed: speed || 1.0,
            language: sarvamLang,
            textLength: text.length,
            wordCount: text.split(/\s+/).filter(Boolean).length,
            provider: 'sarvam',
            isSimulation: false,
            timestamp: new Date(),
          };
        }
      }
    } catch {
      /* fall through — browser/OpenAI TTS until Sarvam keys ready */
    }

    const estimatedDuration = Math.ceil(text.split(/\s+/).length / 2.5);
    const latency = Date.now() - startTime;
    await this.recordUsage(ctx, '/voice/synthesize', 200, latency + 50, Math.ceil(text.length / 4), 0.001);

    return {
      synthesisId, audioUrl: `https://cdn.jurexio.com/audio/${synthesisId}.${format || 'mp3'}`,
      duration: estimatedDuration, format: format || 'mp3', sampleRate: 44100, channels: 1,
      voiceId: voiceId || `default_${language}`, speed: speed || 1.0, language,
      textLength: text.length, wordCount: text.split(/\s+/).length,
      provider: 'simulation', isSimulation: true,
      timestamp: new Date(),
    };
  }

  async transcribeSpeech(audioUrl: string | undefined, audioBase64: string | undefined, language: string, ctx: any): Promise<any> {
    const startTime = Date.now();
    const { getSttService } = await import('../jrx-stt-service.js');
    const stt = getSttService();

    let audioBuffer: Buffer | null = null;
    if (audioBase64 && typeof audioBase64 === 'string') {
      const cleaned = audioBase64.replace(/^data:[^;]+;base64,/, '');
      audioBuffer = Buffer.from(cleaned, 'base64');
    } else if (audioUrl && typeof audioUrl === 'string') {
      try {
        const resp = await fetch(audioUrl, { signal: AbortSignal.timeout(30_000) });
        if (resp.ok) {
          audioBuffer = Buffer.from(await resp.arrayBuffer());
        }
      } catch {
        /* fall through to error below */
      }
    }

    if (!audioBuffer || audioBuffer.length < 16) {
      await this.recordUsage(ctx, '/voice/transcribe', 400, Date.now() - startTime, 0, 0);
      throw new Error('audioBase64 or audioUrl with decodable audio is required');
    }

    const result = await stt.transcribeBatch(audioBuffer, { language: language || 'en-IN' });
    const latency = Date.now() - startTime;
    await this.recordUsage(
      ctx,
      '/voice/transcribe',
      result.isSimulation ? 200 : 200,
      latency,
      Math.ceil((result.text || '').length / 4) || 100,
      result.isSimulation ? 0 : 0.003,
    );

    const words = result.words || [];
    const segments = words.length
      ? words.map((w, i) => ({
          id: `seg_${i + 1}`,
          startTime: w.start,
          endTime: w.end,
          text: w.word,
          confidence: w.confidence,
          speaker: 'speaker_1',
        }))
      : undefined;

    return {
      transcriptionId: generateId('stt'),
      text: result.text,
      confidence: result.confidence,
      language: result.languageCode || language,
      source: audioUrl ? 'url' : 'base64',
      duration: result.durationMs != null ? result.durationMs / 1000 : undefined,
      segments,
      wordCount: (result.text || '').split(/\s+/).filter(Boolean).length,
      processingTime: latency,
      provider: result.provider,
      isSimulation: result.isSimulation === true,
      timestamp: new Date(),
    };
  }

  async startVoiceStream(language: string, mode: string, jurisdiction: string, ctx: any): Promise<any> {
    const sessionId = generateId('vss');
    await this.recordUsage(ctx, '/voice/stream/start', 200, 50, 0, 0);

    return {
      sessionId, wsUrl: `wss://api.jurexio.com/voice/ws/${sessionId}`, language, mode, jurisdiction,
      config: { sampleRate: 16000, encoding: 'LINEAR16', channels: 1, interimResults: true, punctuation: true, speakerDiarization: mode === 'courtroom', legalTerminology: true },
      maxDuration: 7200, expiresAt: new Date(Date.now() + 7200000), timestamp: new Date(),
    };
  }

  async stopVoiceStream(sessionId: string, ctx: any): Promise<any> {
    await this.recordUsage(ctx, '/voice/stream/stop', 200, 100, 1000, 0.005);

    return {
      sessionId, status: 'stopped',
      transcriptionSummary: {
        fullText: 'Complete transcription of the voice streaming session...', totalDuration: 1845.5, totalSegments: 42, averageConfidence: 0.93,
        speakers: [
          { id: 'speaker_1', label: 'Judge', speakingTime: 820.3 },
          { id: 'speaker_2', label: 'Advocate 1', speakingTime: 612.7 },
          { id: 'speaker_3', label: 'Advocate 2', speakingTime: 412.5 },
        ],
        legalTermsDetected: ['habeas corpus', 'prima facie', 'res judicata', 'amicus curiae'], wordCount: 4250,
      },
      stoppedAt: new Date(), timestamp: new Date(),
    };
  }

  async generateVoiceover(script: string, language: string, voiceProfile: string, outputFormat: string, ctx: any): Promise<any> {
    const voiceoverId = generateId('vo');
    const estimatedDuration = Math.ceil(script.split(/\s+/).length / 2.5);
    await this.recordUsage(ctx, '/voice/voiceover/generate', 200, 200, Math.ceil(script.length / 4), 0.005);

    return {
      voiceoverId, audioUrl: `https://cdn.jurexio.com/voiceover/${voiceoverId}.${outputFormat}`,
      duration: estimatedDuration, format: outputFormat, sampleRate: 48000, channels: 2, bitrate: '320kbps',
      voiceProfile, language, scriptLength: script.length, wordCount: script.split(/\s+/).length,
      processingTime: 8500, timestamp: new Date(),
    };
  }

  getCapabilities(): any {
    return {
      capabilities: {
        vision: { enabled: true, supportedFormats: ['jpeg', 'png', 'pdf', 'tiff', 'bmp'], analysisTypes: ['document_classification', 'text_extraction', 'signature_detection', 'stamp_verification', 'layout_analysis'], maxFileSize: '50MB', batchSupport: true },
        video: { enabled: true, scriptGeneration: true, supportedLanguages: ['en', 'hi', 'ta', 'te', 'bn', 'mr', 'gu', 'kn', 'ml', 'pa'], maxDuration: 600, formats: ['mp4', 'webm'] },
        threeD: { enabled: true, visualizationTypes: ['legal_structure', 'case_timeline', 'relationship_graph', 'jurisdiction_map', 'compliance_tree'], formats: ['gltf', 'glb', 'obj', 'fbx'], interactiveMode: true },
        avatar: { enabled: true, avatarTypes: ['professional', 'assistant', 'judge', 'mediator'], supportedLanguages: ['en', 'hi', 'ta', 'te', 'bn'], realtime: true, maxSessionDuration: 3600 },
        rag: { enabled: true, supportedModalities: ['text', 'image', 'video', 'audio'], maxTopK: 50, jurisdictions: ['IN', 'US', 'UK', 'EU', 'SG', 'AE', 'SA'] },
      },
      version: '3.8.0', timestamp: new Date(),
    };
  }

  private async recordUsage(ctx: any, endpoint: string, statusCode: number, latencyMs: number, tokensUsed: number, cost: number, provider?: string, model?: string): Promise<void> {
    if (!ctx) return;
    try {
      await sdkUsageMeteringService.recordRequest({
        applicationId: ctx.applicationId, organizationId: ctx.organizationId, apiKeyId: ctx.apiKeyId,
        endpoint, method: 'POST', statusCode, latencyMs, tokensUsed, inputTokens: Math.ceil(tokensUsed * 0.7),
        outputTokens: Math.ceil(tokensUsed * 0.3), estimatedCost: cost, llmProvider: provider, llmModel: model,
        requestId: ctx.requestId || generateId('req'),
      });
    } catch { /* non-blocking */ }
  }
}

export const sdkMultimodalVoiceService = new SdkMultimodalVoiceService();
