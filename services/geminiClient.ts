import { GoogleGenAI } from '@google/genai';

let client: GoogleGenAI | undefined;

export const getGeminiClient = (): GoogleGenAI => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('未配置 Gemini API Key。请在 .env.local 中设置 VITE_GEMINI_API_KEY，然后重启开发服务；本地转换无需 API Key。');
  }

  client ??= new GoogleGenAI({ apiKey });
  return client;
};
