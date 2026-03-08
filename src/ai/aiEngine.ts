import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'

// Provider Configuration
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || ''

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)

// Helper to safely get the base URL for OpenAI (Vercel proxy)
const getOpenAIBaseURL = () => {
    if (typeof window === 'undefined') return undefined
    try {
        const origin = window.location.origin
        if (!origin || origin === 'null') return undefined
        // Ensure it's a valid absolute URL
        return new URL('/openai-api/v1', origin).toString()
    } catch (e) {
        return undefined
    }
}

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
    dangerouslyAllowBrowser: true,
    baseURL: getOpenAIBaseURL()
})

export type AIProvider = 'google' | 'openai'

export interface ModelConfig {
    provider: AIProvider
    modelName: string
    useTemperature?: boolean
}

export const STAGES = {
    INTRO: 'intro' as const,
    GOAL_DISCOVERY: 'goal_discovery' as const,
    MOTIVATION: 'motivation' as const,
    TRIAL_OFFER: 'trial_offer' as const,
    LEAD_CAPTURE_PHONE: 'lead_capture_phone' as const,
    COMPLETED: 'completed' as const
}

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

const SYSTEM_INSTRUCTION = `
You are a friendly, professional gym assistant. Your goal is to guide the user to sign up for a 3-day free trial.

### CONVERSATION FLOW (STAGES):
1. **intro**: Greet the user and ask how they are doing.
2. **goal_discovery**: Once greeted, ask about their specific fitness goals (e.g., weight loss, muscle gain).
3. **motivation**: After hearing their goals, ask "Why now?" or what motivates them to make a change.
4. **trial_offer**: Once rapport is built, offer the 3-day free trial and explain its benefits.
5. **lead_capture_phone**: If the user expresses interest or agrees to the trial, transition to this stage.
6. **completed**: Only used after the user has submitted their details through the form.

### POLICIES:
- Tone: Enthusiastic, supportive, and concise.
- Keep responses under 50 words.
- If the user asks non-fitness questions, politely redirect them back to the 3-day trial.
- **IMPORTANT**: To trigger the registration form, you MUST set "nextStage" to "lead_capture_phone".

### OUTPUT FORMAT: (JSON ONLY)
{
  "reply": "your message to the user",
  "nextStage": "the stage to move to",
  "triggerLeadCapture": boolean (true if nextStage is lead_capture_phone),
  "suggestions": ["suggested user reply 1", "suggested user reply 2"],
  "summary": "brief summary of user's goals/motivation"
}
`

async function callGemini(prompt: string, modelName: string, useTemperature: boolean = true): Promise<string> {
    const generationConfig: any = {
        responseMimeType: 'application/json',
    }

    if (useTemperature) {
        generationConfig.temperature = 0.1
    }

    const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig
    })

    const result = await model.generateContent({
        contents: [
            { role: 'user', parts: [{ text: SYSTEM_INSTRUCTION }] },
            { role: 'user', parts: [{ text: prompt }] }
        ]
    })
    return result.response.text()
}

async function callOpenAI(prompt: string, modelName: string, useTemperature: boolean = true): Promise<string> {
    const body: any = {
        model: modelName,
        messages: [
            { role: 'system', content: SYSTEM_INSTRUCTION },
            { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' }
    }

    if (useTemperature) {
        body.temperature = 0.1
    }

    const response = await openai.chat.completions.create(body)
    return response.choices[0].message.content || '{}'
}

export async function generateAIResponse(
    userMessage: string,
    conversationState: ConversationState,
    businessData: any,
    recentMessages: any[],
    modelConfig: ModelConfig = { provider: 'google', modelName: 'gemini-1.5-flash' }
): Promise<AIResponse> {
    try {
        const stage = conversationState.stage || STAGES.INTRO

        // Filter business data for tokens and security
        const context = {
            services: businessData.services,
            pricing: businessData.pricing_note,
            offer: businessData.offer,
            hours: businessData.hours,
            tone: businessData.tone
        };

        // History: Exclude the latest message if it's already in history to avoid duplication. 
        const historyText = recentMessages
            .filter(m => m.text !== userMessage)
            .slice(-4)
            .map(m => `${m.sender === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
            .join('\n')

        const prompt = `
Current Stage: ${stage}
Summary: ${conversationState.summary || 'None'}
Context: ${JSON.stringify(context)}
History:
${historyText}

User: ${userMessage}
`

        let responseText: string
        const useTemp = modelConfig.useTemperature !== false // Default to true if undefined

        if (modelConfig.provider === 'openai') {
            responseText = await callOpenAI(prompt, modelConfig.modelName, useTemp)
        } else {
            responseText = await callGemini(prompt, modelConfig.modelName, useTemp)
        }

        responseText = responseText.trim()
        try {
            const parsed = JSON.parse(responseText.replace(/```json|```/g, '')) as AIResponse

            // Maintain summary if AI doesn't update it
            if (!parsed.summary) {
                parsed.summary = conversationState.summary || ''
            }

            parsed.triggerLeadCapture = parsed.nextStage === STAGES.LEAD_CAPTURE_PHONE

            return parsed
        } catch (e) {
            console.error('Failed to parse AI JSON:', responseText)
            return {
                reply: "I'd love to help you with that! To get started, would you like to hear about our goals?",
                nextStage: stage,
                triggerLeadCapture: false,
                suggestions: ['Tell me more', 'Fitness goals']
            }
        }
    } catch (error) {
        console.error('Error in generateAIResponse:', error)
        return {
            reply: "I'm sorry, I'm having a bit of trouble right now. Can we try again?",
            nextStage: conversationState.stage || STAGES.INTRO,
            triggerLeadCapture: false
        }
    }
}
