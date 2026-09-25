import { NextResponse } from 'next/server'

const MODEL = 'gemini-3.1-flash-lite'

type Analysis = {
  risk: 'high' | 'safe' | 'low'
  summary: string
  confidence: 'High' | 'Medium' | 'Low'
  checks: number
  flags: Array<{ title: string; detail: string; confidence: 'High' | 'Medium' | 'Low' }>
  qualityNote?: string
}

function fallbackAnalysis(drug: string, photos: number): Analysis & { drug: string; photos: number; live: false } {
  return {
    risk: 'low',
    drug,
    photos,
    checks: 0,
    summary: `We couldn't complete the live ${drug} packaging comparison because the vision service is busy. No authenticity conclusion was made.`,
    confidence: 'Low',
    flags: [{
      title: 'Live comparison unavailable',
      detail: `Try again shortly, or confirm the ${drug} package with a pharmacist or the relevant regulator.`,
      confidence: 'Low',
    }],
    qualityNote: 'This is a service-load fallback, not a visual assessment.',
    live: false,
  }
}

const systemInstruction = `You are a packaging authenticity analyst. Evaluate every uploaded medicine-package image together and return only valid JSON.

Inspect these dimensions:
1. Registration number presence and format. Look for a NAFDAC registration number such as "NAFDAC Reg No. 04-8492" and report whether it is present, legible, and plausible.
2. Brand name, font alignment, spelling, logo placement, and manufacturer details. Compare the visible manufacturer against the supplied drug name and known packaging conventions; mention examples such as Drugfield Pharmaceuticals only when visible or relevant.
3. Packaging integrity and print quality across all panels: seals, holograms, tamper evidence, color consistency, sharpness, alignment, batch/expiry printing, and signs of reprint or alteration.

REGULATORY CONTEXT (NAFDAC / West Africa):
1. ALL pre-packaged food, drugs, medical devices, oral care products (including toothpastes), and cosmetics distributed in Nigeria legally REQUIRE a NAFDAC Registration Number or NAFDAC listing number.
2. Do NOT state that cosmetics or toothpastes are exempt from NAFDAC registration.
3. If toothpaste, soap, or cosmetic packaging is missing a NAFDAC number, flag it under "Regulatory Classification" or "Registration Status" as missing a required regional registration code.

Do not claim a medicine is safe or counterfeit with certainty. This is a visual screening only. Use confidence High, Medium, or Low for each finding. If image quality is insufficient, explain exactly what is not assessable.

Return this exact JSON shape:
{
  "risk": "high" | "safe" | "low",
  "summary": "short plain-language conclusion",
  "confidence": "High" | "Medium" | "Low",
  "checks": number,
  "flags": [{ "title": string, "detail": string, "confidence": "High" | "Medium" | "Low" }],
  "qualityNote": string | null
}
Use risk "high" when multiple credible inconsistencies are visible, "safe" only when the submitted panels appear consistent, and "low" when the evidence is insufficient.`

function extractJson(text: string) {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('Gemini returned an invalid analysis.')
  return JSON.parse(cleaned.slice(start, end + 1))
}

export async function POST(request: Request) {
  let requestedDrug = 'the submitted medicine'
  let imageCount = 0
  try {
    const body = await request.json()
    const images = Array.isArray(body.images) ? body.images : []
    imageCount = images.length
    const drug = typeof body.drugName === 'string' ? body.drugName.trim() : typeof body.drug === 'string' ? body.drug.trim() : ''
    requestedDrug = drug || requestedDrug

    if (!images.length || images.length > 3 || !drug) {
      return NextResponse.json(fallbackAnalysis(drug || 'the submitted medicine', images.length), { status: 200 })
    }
    if (images.some((image: unknown) => typeof image !== 'string' || !image.startsWith('data:image/'))) {
      return NextResponse.json({ error: 'Each image must be a base64 data URL.' }, { status: 400 })
    }
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(fallbackAnalysis(drug, images.length), { status: 200 })
    }

    const parts = [
      { text: `${systemInstruction}\n\nMedicine name supplied by the user: ${drug}` },
      ...images.map((image: string) => {
        const match = image.match(/^data:(image\/[\w.+-]+);base64,(.+)$/)
        if (!match) throw new Error('Invalid image data.')
        return { inline_data: { mime_type: match[1], data: match[2] } }
      }),
    ]

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`
    const requestBody = JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    })
    const maxRetries = 3
    let response: Response

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
      })

      if (![429, 503].includes(response.status) || attempt === maxRetries) break

      const delay = 1000 * 2 ** attempt
      console.warn(`[v0] Gemini returned ${response.status}; retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }

    if (!response!.ok) {
      const providerStatus = response!.status
      const providerError = await response!.text()
      console.error('[v0] Gemini provider response:', providerError)
      if ([429, 503].includes(providerStatus)) {
        return NextResponse.json(fallbackAnalysis(drug, images.length), { status: 200 })
      }
      throw new Error(`Gemini request failed (${providerStatus}). ${providerError.slice(0, 240)}`)
    }
    const data = await response!.json()
    const text = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('')
    if (!text) throw new Error('Gemini did not return an analysis.')

    const parsed = extractJson(text)
    return NextResponse.json({
      risk: ['high', 'safe', 'low'].includes(parsed.risk) ? parsed.risk : 'low',
      drug,
      photos: images.length,
      checks: Number.isFinite(parsed.checks) ? parsed.checks : parsed.flags?.length || 0,
      summary: typeof parsed.summary === 'string' ? parsed.summary : 'Review the findings below with a pharmacist.',
      confidence: ['High', 'Medium', 'Low'].includes(parsed.confidence) ? parsed.confidence : 'Low',
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
      qualityNote: parsed.qualityNote || undefined,
      live: true,
    })
  } catch (error) {
    console.error('[v0] Gemini analysis failed:', error)
    return NextResponse.json(fallbackAnalysis(requestedDrug, imageCount), { status: 200 })
  }
}

export const maxDuration = 60
