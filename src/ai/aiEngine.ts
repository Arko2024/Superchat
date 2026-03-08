import { GoogleGenerativeAI } from "@google/generative-ai"
import OpenAI from "openai"

// =====================
// ENV
// =====================

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || ""
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || ""
const ENV_BASE = import.meta.env.VITE_OPENAI_BASE_URL || "/api/openai-api"

// =====================
// SAFE BASE URL
// =====================

const getBaseURL = () => {
  try {
    if (typeof window !== "undefined") {
      return window.location.origin + ENV_BASE
    }
  } catch (e) {}

  return undefined
}

const OPENAI_BASE_URL = getBaseURL()

// =====================
// CLIENTS
// =====================

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
  baseURL: OPENAI_BASE_URL,
})

// =====================
// TYPES
// =====================

export type AIProvider = "google" | "openai"

export interface ModelConfig {
  provider: AIProvider
  modelName: string
  useTemperature?: boolean
}

export const STAGES = {
  INTRO: "intro",
  GOAL_DISCOVERY: "goal_discovery",
  MOTIVATION: "motivation",
  TRIAL_OFFER: "trial_offer",
  LEAD_CAPTURE_PHONE: "lead_capture_phone",
  COMPLETED: "completed",
} as const

export type Stage = typeof STAGES[keyof typeof STAGES]

export interface AIResponse {
  reply: string
  nextStage: Stage
  triggerLeadCapture: boolean
  suggestions?: string[]
  summary?: string
}

export interface ConversationState {
  stage: Stage
  leadData: Record<string, string>
  summary?: string
}

// =====================
// SYSTEM PROMPT
// =====================

const SYSTEM_INSTRUCTION = `
You are a friendly gym assistant.

Goal:
Guide the user to sign up for a 3-day free trial.

Stages:
intro
goal_discovery
motivation
trial_offer
lead_capture_phone
completed

Rules:
- Keep replies under 40 words
- Stay in funnel
- Return JSON only

Format:
{
 reply,
 nextStage,
 triggerLeadCapture,
 suggestions,
 summary
}
`

// =====================
// GEMINI
// =====================

async function callGemini(
  prompt: string,
  modelName: string,
  useTemperature = true
): Promise<string> {
  const generationConfig: any = {
    responseMimeType: "application/json",
  }

  if (useTemperature) {
    generationConfig.temperature = 0.1
  }

  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig,
  })

  const result = await model.generateContent({
    contents: [
      { role: "user", parts: [{ text: SYSTEM_INSTRUCTION }] },
      { role: "user", parts: [{ text: prompt }] },
    ],
  })

  return result.response.text()
}

// =====================
// OPENAI
// =====================

async function callOpenAI(
  prompt: string,
  modelName: string,
  useTemperature = true
): Promise<string> {
  const body: any = {
    model: modelName,
    messages: [
      { role: "system", content: SYSTEM_INSTRUCTION },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    max_tokens: 120,
  }

  if (useTemperature) {
    body.temperature = 0.1
  }

  const res = await openai.chat.completions.create(body)

  return res.choices[0]?.message?.content || "{}"
}

// =====================
// MAIN
// =====================

export async function generateAIResponse(
  userMessage: string,
  conversationState: ConversationState,
  businessData: any,
  recentMessages: any[],
  modelConfig: ModelConfig = {
    provider: "google",
    modelName: "gemini-2.5-flash",
  }
): Promise<AIResponse> {
  try {
    const stage = conversationState.stage || STAGES.INTRO

    const context = {
      services: businessData?.services,
      pricing: businessData?.pricing_note,
      offer: businessData?.offer,
      hours: businessData?.hours,
    }

    const history = recentMessages
      .slice(-4)
      .map(
        (m) =>
          `${m.sender === "user" ? "User" : "Assistant"}: ${m.text}`
      )
      .join("\n")

    const prompt = `
Stage: ${stage}

Summary: ${conversationState.summary || "none"}

Context:
${JSON.stringify(context)}

History:
${history}

User:
${userMessage}
`

    let text = ""

    if (modelConfig.provider === "openai") {
      text = await callOpenAI(
        prompt,
        modelConfig.modelName,
        modelConfig.useTemperature !== false
      )
    } else {
      text = await callGemini(
        prompt,
        modelConfig.modelName,
        modelConfig.useTemperature !== false
      )
    }

    const parsed = JSON.parse(
      text.replace(/```json|```/g, "")
    ) as AIResponse

    parsed.triggerLeadCapture =
      parsed.nextStage === STAGES.LEAD_CAPTURE_PHONE

    return parsed
  } catch (err) {
    console.error("AI ERROR", err)

    return {
      reply: "Something went wrong.",
      nextStage: conversationState.stage || STAGES.INTRO,
      triggerLeadCapture: false,
    }
  }
}
