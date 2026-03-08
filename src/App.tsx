import { useState, useEffect } from 'react'
import { Send } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'
import { generateAIResponse, STAGES, type ConversationState, type ModelConfig } from './ai/aiEngine.ts'

// Basic type for a message
type Message = {
    id: string
    text: string
    sender: 'user' | 'bot'
    suggestions?: string[]
}

// Initialize Supabase client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null

export default function App() {
    const [messages, setMessages] = useState<Message[]>([])
    const [inputValue, setInputValue] = useState('')
    const [loading, setLoading] = useState(true)
    const [isBotTyping, setIsBotTyping] = useState(false)
    const [businessData, setBusinessData] = useState<any>(null)
    const [error, setError] = useState<string | null>(null)
    const [conversationState, setConversationState] = useState<ConversationState>({
        stage: STAGES.INTRO,
        leadData: {},
        summary: ''
    })

    const [modelConfig, setModelConfig] = useState<ModelConfig>({
        provider: (import.meta.env.VITE_DEFAULT_AI_PROVIDER as any) || 'google',
        modelName: import.meta.env.VITE_DEFAULT_AI_MODEL || 'gemini-1.5-flash',
        useTemperature: true
    })

    const [leadName, setLeadName] = useState('')
    const [leadPhone, setLeadPhone] = useState('')
    const [isSubmittingLead, setIsSubmittingLead] = useState(false)
    const [submissionStatus, setSubmissionStatus] = useState<'idle' | 'success' | 'error'>('idle')

    useEffect(() => {
        const fetchBusiness = async () => {
            const urlParams = new URLSearchParams(window.location.search)
            const slug = urlParams.get('slug')

            if (!slug) {
                setError('Business not found.')
                setLoading(false)
                return
            }

            if (!supabase) {
                setError('Supabase connection not configured.')
                setLoading(false)
                return
            }

            try {
                const { data, error: fetchError } = await supabase
                    .from('businesses')
                    .select("*")
                    .eq('id', slug)
                    .single()

                if (fetchError || !data) {
                    setError('Business not found.')
                } else {
                    setBusinessData(data)
                    setMessages([
                        {
                            id: '1',
                            text: `Hi 👋 Welcome to ${data.name}. How are you doing today?`,
                            sender: 'bot',
                            suggestions: ['I am good!', 'Looking for a gym', 'Just browsing']
                        }
                    ])
                }
            } catch (err) {
                setError('Business not found.')
            } finally {
                setLoading(false)
            }
        }

        fetchBusiness()
    }, [])

    const handleLeadSubmit = async () => {
        if (!leadName.trim() || leadPhone.length < 10) return

        setIsSubmittingLead(true)
        setSubmissionStatus('idle')

        try {
            // Send Telegram notification directly
            const { telegram_bot_token, telegram_chat_id, name: gymName } = businessData

            if (telegram_bot_token && telegram_chat_id) {
                const timestamp = new Date().toLocaleString()
                const messageText = `🔥 New Gym Lead\n\nGym: ${gymName}\nGym ID: ${businessData.id}\nName: ${leadName}\nPhone: ${leadPhone}\nTime: ${timestamp}`

                const tgRes = await fetch(`https://api.telegram.org/bot${telegram_bot_token}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: telegram_chat_id,
                        text: messageText,
                        parse_mode: 'HTML'
                    })
                })

                if (!tgRes.ok) throw new Error('Telegram notification failed')
            }

            setSubmissionStatus('success')
            setConversationState(prev => ({ ...prev, stage: STAGES.COMPLETED }))
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                text: "Thank you! Amader team shighroi contact korbe.",
                sender: 'bot'
            }])

        } catch (err) {
            console.error("Lead submission error:", err)
            setSubmissionStatus('error')
        } finally {
            setIsSubmittingLead(false)
        }
    }

    const handleSend = async (text: string) => {
        if (!text.trim() || isBotTyping || conversationState.stage === STAGES.COMPLETED) return

        const userMsg: Message = {
            id: Date.now().toString(),
            text,
            sender: 'user',
        }

        setMessages(prev => [...prev, userMsg])
        setInputValue('')
        setIsBotTyping(true)

        try {
            // Pass messages (previous history) instead of newMessages to avoid duplication
            const result = await generateAIResponse(text, conversationState, businessData, messages, modelConfig)

            setConversationState(prev => ({
                ...prev,
                stage: result.nextStage,
                summary: result.summary || prev.summary
            }))

            const botMsg: Message = {
                id: (Date.now() + 1).toString(),
                text: result.reply,
                sender: 'bot',
                suggestions: result.suggestions
            }
            setMessages((prev) => [...prev, botMsg])

        } catch (err) {
            console.error("Failed to generate response:", err)
        } finally {
            setIsBotTyping(false)
        }
    }

    const handleSuggestionClick = (suggestion: string) => {
        handleSend(suggestion)
    }

    if (loading) {
        return (
            <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <h2>Loading...</h2>
            </div>
        )
    }

    if (error) {
        return (
            <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <h2>{error}</h2>
            </div>
        )
    }

    return (
        <div className="app-container">
            <div className="chat-window">
                <div className="chat-header">
                    <h2>{businessData?.name || 'SuperChat'} Assistant</h2>
                    <div className="model-selector">
                        <select
                            value={`${modelConfig.provider}:${modelConfig.modelName}`}
                            onChange={(e) => {
                                const [provider, modelName] = e.target.value.split(':')
                                setModelConfig(prev => ({ ...prev, provider: provider as any, modelName }))
                            }}
                        >
                            <option value="google:gemini-1.5-flash">Gemini 1.5 Flash</option>
                            <option value="google:gemini-2.0-flash-exp">Gemini 2.0 Flash</option>
                            <option value="openai:gpt-4o">GPT-4o</option>
                            <option value="openai:gpt-4o-mini">GPT-4o-mini</option>
                        </select>
                        <label className="temp-toggle">
                            <input
                                type="checkbox"
                                checked={modelConfig.useTemperature}
                                onChange={(e) => setModelConfig(prev => ({ ...prev, useTemperature: e.target.checked }))}
                            />
                            AI Temp
                        </label>
                    </div>
                </div>

                <div className="chat-messages">
                    {messages.map((msg) => (
                        <div
                            key={msg.id}
                            className={`message-wrapper ${msg.sender === 'user' ? 'right' : 'left'}`}
                        >
                            <div className={`message-bubble ${msg.sender}`}>
                                {msg.text}
                            </div>
                        </div>
                    ))}

                    {isBotTyping && (
                        <div className="message-wrapper left">
                            <div className="message-bubble bot typing">...</div>
                        </div>
                    )}

                    {/* Lead Capture Form */}
                    {!isBotTyping && conversationState.stage === STAGES.LEAD_CAPTURE_PHONE && submissionStatus !== 'success' && (
                        <div className="lead-capture-form">
                            <h3>Register for Free Trial</h3>
                            <input
                                type="text"
                                placeholder="Your Name"
                                value={leadName}
                                onChange={(e) => setLeadName(e.target.value)}
                                disabled={isSubmittingLead}
                            />
                            <input
                                type="tel"
                                placeholder="Phone Number (10+ digits)"
                                value={leadPhone}
                                onChange={(e) => setLeadPhone(e.target.value)}
                                disabled={isSubmittingLead}
                            />
                            {submissionStatus === 'error' && <p className="error-msg">Failed to submit. Please try again.</p>}
                            <button
                                onClick={handleLeadSubmit}
                                disabled={isSubmittingLead || !leadName.trim() || leadPhone.length < 10}
                                className="submit-lead-btn"
                            >
                                {isSubmittingLead ? 'Submitting...' : 'Claim Free Trial'}
                            </button>
                        </div>
                    )}

                    {!isBotTyping && messages[messages.length - 1]?.sender === 'bot' && messages[messages.length - 1]?.suggestions && conversationState.stage !== STAGES.LEAD_CAPTURE_PHONE && conversationState.stage !== STAGES.COMPLETED && (
                        <div className="suggestions-container">
                            {messages[messages.length - 1].suggestions?.map((sugg) => (
                                <button
                                    key={sugg}
                                    className="suggestion-btn"
                                    onClick={() => handleSuggestionClick(sugg)}
                                >
                                    {sugg}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="chat-input-area">
                    <input
                        type="text"
                        className="chat-input"
                        placeholder={conversationState.stage === STAGES.COMPLETED ? "Chat completed" : "Type your message..."}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                handleSend(inputValue)
                            }
                        }}
                        disabled={isBotTyping || conversationState.stage === STAGES.COMPLETED || conversationState.stage === STAGES.LEAD_CAPTURE_PHONE}
                    />
                    <button
                        className="send-btn"
                        onClick={() => handleSend(inputValue)}
                        disabled={isBotTyping || !inputValue.trim() || conversationState.stage === STAGES.COMPLETED || conversationState.stage === STAGES.LEAD_CAPTURE_PHONE}
                    >
                        <Send size={20} />
                    </button>
                </div>
            </div>
        </div>
    )
}
