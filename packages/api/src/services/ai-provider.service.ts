import type { FastifyInstance } from 'fastify';
import type { AiProvider } from '@fittrackr/shared';
import { ValidationError, AppError } from '../utils/errors.js';
import { decrypt } from '../utils/encryption.js';
import { logger } from '../utils/logger.js';

export type AiTier = 'light' | 'heavy' | 'vision';

interface AiResult {
  content: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
}

/** Strip markdown code fences that LLMs sometimes wrap around JSON responses */
function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

const MODEL_MAP: Record<AiProvider, Record<AiTier, string>> = {
  OPENAI: {
    light: 'gpt-4o-mini',
    heavy: 'gpt-4o',
    vision: 'gpt-4o',
  },
  ANTHROPIC: {
    light: 'claude-haiku-4-5-20251001',
    heavy: 'claude-sonnet-4-6',
    vision: 'claude-sonnet-4-6',
  },
  GEMINI: {
    light: 'gemini-2.0-flash',
    heavy: 'gemini-2.5-pro',
    vision: 'gemini-2.0-flash',
  },
};

async function resolveProviderAndKey(
  fastify: FastifyInstance,
  userId: string,
): Promise<{ provider: AiProvider; apiKey: string }> {
  const settings = await fastify.prisma.userSettings.findUnique({ where: { userId } });
  if (!settings) {
    throw new ValidationError('No AI provider configured. Please add an API key in settings.');
  }

  const provider = (settings.aiProvider as AiProvider) ?? 'OPENAI';

  let encryptedKey: string | null = null;
  switch (provider) {
    case 'OPENAI':
      encryptedKey = settings.openaiApiKey;
      break;
    case 'ANTHROPIC':
      encryptedKey = settings.anthropicApiKey;
      break;
    case 'GEMINI':
      encryptedKey = settings.geminiApiKey;
      break;
  }

  if (!encryptedKey) {
    const names: Record<AiProvider, string> = {
      OPENAI: 'OpenAI',
      ANTHROPIC: 'Anthropic',
      GEMINI: 'Google Gemini',
    };
    throw new ValidationError(
      `No ${names[provider]} API key configured. Please add your API key in settings.`,
    );
  }

  // decrypt() throws a raw crypto error if the stored ciphertext can't be
  // opened — most often because ENCRYPTION_KEY changed since the key was
  // saved. Left unwrapped that surfaces as a bare 500, which tells the user
  // nothing actionable.
  let apiKey: string;
  try {
    apiKey = decrypt(encryptedKey);
  } catch (err) {
    logger.error(
      { err: (err as Error)?.message, provider, userId },
      'Failed to decrypt stored AI API key',
    );
    throw new ValidationError(
      'Your saved API key could not be decrypted. This usually means the server ENCRYPTION_KEY changed. Please re-enter your API key in settings.',
    );
  }
  if (!apiKey.trim()) {
    throw new ValidationError('Your saved API key is empty. Please re-enter it in settings.');
  }

  return { provider, apiKey };
}

/**
 * Per-provider maximum output tokens. Requesting more than the model allows is
 * a hard API error, so callers' maxTokens is clamped to these.
 */
const MAX_OUTPUT_TOKENS: Record<AiProvider, number> = {
  OPENAI: 16_384,
  ANTHROPIC: 64_000,
  GEMINI: 65_535,
};

/** Raised when the model hit its output ceiling and the JSON is truncated. */
export class AiTruncatedError extends AppError {
  constructor(provider: string) {
    super(
      502,
      'AI_TRUNCATED',
      `The ${provider} response was cut off before it finished. Try a shorter program (fewer weeks or fewer days per week).`,
    );
  }
}

// ─── OpenAI ───────────────────────────────────────────────

async function openaiChat(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string,
  temperature: number,
  maxTokens: number,
): Promise<AiResult> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey, timeout: 120_000 });

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature,
    max_tokens: maxTokens,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new AppError(502, 'AI_ERROR', 'OpenAI returned an empty response');
  if (completion.choices[0]?.finish_reason === 'length') throw new AiTruncatedError('OpenAI');

  return {
    content,
    model,
    usage: {
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
    },
  };
}

async function openaiVision(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  imageBase64: string,
  model: string,
  temperature: number,
  maxTokens: number,
): Promise<AiResult> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey, timeout: 120_000 });

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: imageBase64, detail: 'high' } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    temperature,
    max_tokens: maxTokens,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new AppError(502, 'AI_ERROR', 'OpenAI returned an empty response');

  return {
    content,
    model,
    usage: {
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
    },
  };
}

// ─── Anthropic ────────────────────────────────────────────

async function anthropicChat(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string,
  temperature: number,
  maxTokens: number,
): Promise<AiResult> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, timeout: 120_000 });

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt + '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no code fences, just raw JSON.',
    messages: [{ role: 'user', content: userPrompt }],
  });

  const block = message.content[0];
  const content = block?.type === 'text' ? block.text : null;
  if (!content) throw new AppError(502, 'AI_ERROR', 'Anthropic returned an empty response');
  if (message.stop_reason === 'max_tokens') throw new AiTruncatedError('Anthropic');

  return {
    content,
    model,
    usage: {
      promptTokens: message.usage?.input_tokens ?? 0,
      completionTokens: message.usage?.output_tokens ?? 0,
    },
  };
}

async function anthropicVision(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  imageBase64: string,
  model: string,
  temperature: number,
  maxTokens: number,
): Promise<AiResult> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, timeout: 120_000 });

  // imageBase64 is typically "data:image/...;base64,<data>"
  let mediaType = 'image/jpeg';
  let base64Data = imageBase64;
  const match = imageBase64.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (match) {
    mediaType = match[1];
    base64Data = match[2];
  }

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt + '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no code fences, just raw JSON.',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: base64Data,
            },
          },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  });

  const block = message.content[0];
  const content = block?.type === 'text' ? block.text : null;
  if (!content) throw new AppError(502, 'AI_ERROR', 'Anthropic returned an empty response');

  return {
    content,
    model,
    usage: {
      promptTokens: message.usage?.input_tokens ?? 0,
      completionTokens: message.usage?.output_tokens ?? 0,
    },
  };
}

// ─── Gemini ───────────────────────────────────────────────

async function geminiChat(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string,
  temperature: number,
  maxTokens: number,
): Promise<AiResult> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
    },
  });

  const result = await genModel.generateContent(userPrompt);
  const content = result.response.text();
  if (!content) throw new AppError(502, 'AI_ERROR', 'Gemini returned an empty response');
  if (result.response.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
    throw new AiTruncatedError('Gemini');
  }

  const usage = result.response.usageMetadata;

  return {
    content,
    model,
    usage: {
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
    },
  };
}

async function geminiVision(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  imageBase64: string,
  model: string,
  temperature: number,
  maxTokens: number,
): Promise<AiResult> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
    },
  });

  // Parse data URI
  let mimeType = 'image/jpeg';
  let base64Data = imageBase64;
  const match = imageBase64.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (match) {
    mimeType = match[1];
    base64Data = match[2];
  }

  const result = await genModel.generateContent([
    userPrompt,
    { inlineData: { mimeType, data: base64Data } },
  ]);

  const content = result.response.text();
  if (!content) throw new AppError(502, 'AI_ERROR', 'Gemini returned an empty response');

  const usage = result.response.usageMetadata;

  return {
    content,
    model,
    usage: {
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
    },
  };
}

// ─── Error handler ────────────────────────────────────────

function handleProviderError(error: any, provider: AiProvider): never {
  if (error instanceof AppError) throw error;

  const providerNames: Record<AiProvider, string> = {
    OPENAI: 'OpenAI',
    ANTHROPIC: 'Anthropic',
    GEMINI: 'Google Gemini',
  };
  const name = providerNames[provider];

  // Module not found (SDK not installed)
  if (error?.code === 'MODULE_NOT_FOUND' || error?.code === 'ERR_MODULE_NOT_FOUND') {
    logger.error({ error: error?.message, provider }, 'AI SDK not installed');
    throw new AppError(502, 'AI_ERROR', `${name} SDK is not installed on the server.`);
  }

  // Auth errors
  if (error?.status === 401 || error?.status === 403 || error?.message?.includes('API key')) {
    throw new ValidationError(`Invalid ${name} API key. Please check your API key in settings.`);
  }

  // Rate limits
  if (error?.status === 429) {
    throw new AppError(429, 'RATE_LIMITED', `${name} rate limit reached. Please wait a moment and try again.`);
  }

  // Not found (bad model ID)
  if (error?.status === 404) {
    logger.error({ error: error?.message, provider }, 'AI model not found');
    throw new AppError(502, 'AI_ERROR', `${name} model not found. The configured model may be invalid.`);
  }

  // Connection / timeout errors
  if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND' || error?.code === 'ETIMEDOUT' || error?.name === 'AbortError') {
    logger.error({ error: error?.message, code: error?.code, provider }, 'AI provider connection error');
    throw new AppError(502, 'AI_ERROR', `Could not connect to ${name} API. The service may be unavailable.`);
  }

  logger.error({ error: error?.message, stack: error?.stack, status: error?.status, code: error?.code, provider }, 'AI provider error');
  throw new AppError(502, 'AI_ERROR', `${name} error: ${error?.message || 'Unknown error'}. Please try again.`);
}

// ─── Public API ───────────────────────────────────────────

export async function aiChatCompletion(
  fastify: FastifyInstance,
  userId: string,
  systemPrompt: string,
  userPrompt: string,
  options: {
    tier?: AiTier;
    temperature?: number;
    maxTokens?: number;
  } = {},
): Promise<AiResult> {
  const { provider, apiKey } = await resolveProviderAndKey(fastify, userId);
  const tier = options.tier ?? 'light';
  const model = MODEL_MAP[provider][tier];
  const temperature = options.temperature ?? 0.3;
  const maxTokens = Math.min(options.maxTokens ?? 1000, MAX_OUTPUT_TOKENS[provider]);

  logger.info({ provider, model, tier, maxTokens }, 'AI chat completion');

  try {
    let result!: AiResult;
    switch (provider) {
      case 'OPENAI':
        result = await openaiChat(apiKey, systemPrompt, userPrompt, model, temperature, maxTokens);
        break;
      case 'ANTHROPIC':
        result = await anthropicChat(apiKey, systemPrompt, userPrompt, model, temperature, maxTokens);
        break;
      case 'GEMINI':
        result = await geminiChat(apiKey, systemPrompt, userPrompt, model, temperature, maxTokens);
        break;
    }
    result.content = stripCodeFences(result.content);
    return result;
  } catch (error) {
    handleProviderError(error, provider);
  }
}

export async function aiVisionCompletion(
  fastify: FastifyInstance,
  userId: string,
  systemPrompt: string,
  userPrompt: string,
  imageBase64: string,
  options: {
    tier?: AiTier;
    temperature?: number;
    maxTokens?: number;
  } = {},
): Promise<AiResult> {
  const { provider, apiKey } = await resolveProviderAndKey(fastify, userId);
  const tier = options.tier ?? 'vision';
  const model = MODEL_MAP[provider][tier];
  const temperature = options.temperature ?? 0.2;
  const maxTokens = options.maxTokens ?? 1000;

  logger.info({ provider, model, tier }, 'AI vision completion');

  try {
    let result!: AiResult;
    switch (provider) {
      case 'OPENAI':
        result = await openaiVision(apiKey, systemPrompt, userPrompt, imageBase64, model, temperature, maxTokens);
        break;
      case 'ANTHROPIC':
        result = await anthropicVision(apiKey, systemPrompt, userPrompt, imageBase64, model, temperature, maxTokens);
        break;
      case 'GEMINI':
        result = await geminiVision(apiKey, systemPrompt, userPrompt, imageBase64, model, temperature, maxTokens);
        break;
    }
    result.content = stripCodeFences(result.content);
    return result;
  } catch (error) {
    handleProviderError(error, provider);
  }
}

// ─── PDF completion (Anthropic only) ──────────────────────────

export async function aiPdfCompletion(
  fastify: FastifyInstance,
  userId: string,
  systemPrompt: string,
  userPrompt: string,
  pdfBase64: string,
  options: {
    temperature?: number;
    maxTokens?: number;
  } = {},
): Promise<AiResult> {
  const { provider, apiKey } = await resolveProviderAndKey(fastify, userId);

  if (provider !== 'ANTHROPIC') {
    throw new AppError(
      400,
      'PDF_NOT_SUPPORTED',
      'PDF ingest requires Anthropic. Switch your AI provider in Profile → Settings.',
    );
  }

  const model = MODEL_MAP.ANTHROPIC.heavy;
  const temperature = options.temperature ?? 0.1;
  // Claude Sonnet supports up to 64k output tokens — needed for large nutrition docs
  const maxTokens = options.maxTokens ?? 32000;

  logger.info({ provider, model }, 'AI PDF completion');

  // Strip data: URI prefix if present
  let base64Data = pdfBase64;
  const match = pdfBase64.match(/^data:application\/pdf;base64,(.+)$/i);
  if (match) base64Data = match[1];

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey, timeout: 180_000 });

    const message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt + '\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no code fences, just raw JSON.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64Data,
              },
            },
            { type: 'text', text: userPrompt },
          ],
        },
      ],
    });

    const block = message.content[0];
    const content = block?.type === 'text' ? block.text : null;
    if (!content) throw new AppError(502, 'AI_ERROR', 'Anthropic returned an empty response');

    return {
      content: stripCodeFences(content),
      model,
      usage: {
        promptTokens: message.usage?.input_tokens ?? 0,
        completionTokens: message.usage?.output_tokens ?? 0,
      },
    };
  } catch (error) {
    handleProviderError(error, provider);
  }
}
