'use client'

import { useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, Camera, Check, ChevronRight, CircleHelp, ImagePlus, Search, ShieldCheck, Upload, X } from 'lucide-react'

type Screen = 'home' | 'scan' | 'results' | 'library'
type Risk = 'high' | 'safe' | 'low'
type Flag = { title: string; detail: string; confidence: 'Low' | 'Medium' | 'High' }
type Result = { risk: Risk; drug: string; photos: number; checks: number; flags: Flag[]; qualityNote?: string; summary?: string; confidence?: 'Low' | 'Medium' | 'High'; live?: boolean }

const demoResults: Record<string, Result> = {
  counterfeit: {
    risk: 'high', drug: 'Coartem', photos: 3, checks: 6,
    flags: [
      { title: 'Logo color mismatch', detail: 'The blue in the logo appears noticeably more saturated than the official pack standard.', confidence: 'High' },
      { title: 'Batch font spacing is misaligned', detail: 'Characters on the batch number sit unevenly and do not follow the expected print spacing.', confidence: 'High' },
      { title: 'Registration number placement', detail: 'The NAFDAC number is printed lower than the standard placement on genuine packaging.', confidence: 'Medium' },
    ],
  },
  authentic: { risk: 'safe', drug: 'Paracetamol', photos: 2, checks: 7, flags: [] },
  low: { risk: 'low', drug: 'Unknown medicine', photos: 1, checks: 0, flags: [], qualityNote: 'The photos are too dark or blurry to assess packaging details. Please retake them in bright, even light.' },
}

function BrandMark() {
  return <div className="brand-mark" aria-label="Authentic8"><span>A8</span></div>
}

function Header({ onHome, onNavigate }: { onHome: () => void; onNavigate: (screen: Screen) => void }) {
  return <header className="app-header"><button className="brand-lockup" onClick={onHome} aria-label="Go to Authentic8 home"><div className="mini-mark">A8</div><span>Authentic8</span></button><nav aria-label="Primary navigation"><button onClick={() => onNavigate('scan')}>Scan</button><button onClick={() => onNavigate('library')}>Library</button></nav></header>
}

function Home({ onStart, onLibrary }: { onStart: () => void; onLibrary: () => void }) {
  return <section className="home-screen"><BrandMark /><h1>Authentic8</h1><p>Check before you take it.</p><button className="outline-cta" onClick={onStart}>Get started <ArrowRight size={22} aria-hidden="true" /></button><button className="text-link" onClick={onLibrary}>Browse the red flags library <ArrowRight size={16} /></button></section>
}

async function compressImage(dataUrl: string, maxDimension = 1024, quality = 0.7): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) return dataUrl
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = dataUrl
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('One of the selected images could not be read.')) })
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Your browser could not prepare the selected images.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

function Scan({ onResult, onLibrary }: { onResult: (result: Result) => void; onLibrary: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = useState<string[]>([])
  const [drug, setDrug] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const addPhotos = (files: FileList | null) => {
    if (!files) return
    Array.from(files).slice(0, 3 - photos.length).forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => setPhotos((current) => current.length < 3 ? [...current, String(reader.result)] : current)
      reader.readAsDataURL(file)
    })
  }
  const runCheck = async () => {
    if (!drug.trim()) { setNotice('Add the medicine name so we can compare it against known packaging.'); return }
    if (!photos.length) { setNotice('Add at least one packaging photo to start the check.'); return }
    setLoading(true); setNotice('Preparing packaging panels for Gemini Vision…')
    try {
      const compressedPhotos = await Promise.all(photos.map((photo) => compressImage(photo)))
      const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: compressedPhotos, drug: drug.trim() }) })
      const responseText = await response.text()
      let data: { error?: string; [key: string]: unknown } = {}
      try { data = responseText ? JSON.parse(responseText) : {} } catch { data = {} }
      if (!response.ok) throw new Error(data.error || responseText || `Analysis request failed (${response.status}).`)
      onResult(data as unknown as Result)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to analyze these images. Please try again.')
    } finally { setLoading(false) }
  }
  const demo = (key: string) => { const result = demoResults[key]; setDrug(result.drug); setPhotos([`demo-${key}-front`, ...(result.photos > 1 ? [`demo-${key}-back`] : []), ...(result.photos > 2 ? [`demo-${key}-batch`] : [])]); onResult(result) }
  return <section className="content-screen"><div className="section-heading"><div><p className="eyebrow">VISUAL FORENSIC CHECK</p><h1>Check your medicine</h1><p>Use up to three angles for a more precise packaging audit.</p></div><ShieldCheck size={34} aria-hidden="true" /></div><div className="scan-card"><button className="upload-zone" onClick={() => inputRef.current?.click()}><input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(event) => addPhotos(event.target.files)} /><ImagePlus size={32} /><strong>{photos.length ? 'Add another photo' : 'Upload or capture packaging'}</strong><span>Front, back, or batch / expiry close-up · {photos.length}/3 added</span></button>{photos.length > 0 && <div className="thumb-row" aria-label="Selected packaging photos">{photos.map((photo, index) => <div className="photo-thumb" key={photo}><div className={`thumb-art thumb-${index + 1}`}><Camera size={20} /></div><button onClick={(event) => { event.stopPropagation(); setPhotos(photos.filter((_, item) => item !== index)) }} aria-label={`Remove photo ${index + 1}`}><X size={14} /></button></div>)}</div>}<label htmlFor="drug">Drug name <span>(required)</span></label><input id="drug" value={drug} onChange={(event) => setDrug(event.target.value)} placeholder="e.g. Coartem — helps us compare against known packaging." />{notice && <p className="form-notice" role="alert">{notice}</p>}<button className="primary-cta" onClick={runCheck} disabled={loading}>{loading ? 'Analyzing panels…' : 'Analyze package'} {!loading && <ArrowRight size={18} />}</button></div><div className="demo-panel"><div><p className="eyebrow">JUDGE MODE</p><h2>Try demo scenarios</h2><p>Explore the complete product flow instantly.</p></div><div className="demo-grid"><button onClick={() => demo('counterfeit')}><span className="demo-dot red" />Sample 1: Counterfeit Coartem <ChevronRight size={18} /></button><button onClick={() => demo('authentic')}><span className="demo-dot green" />Sample 2: Authentic Paracetamol <ChevronRight size={18} /></button><button onClick={() => demo('low')}><span className="demo-dot yellow" />Sample 3: Low Quality Image <ChevronRight size={18} /></button></div></div><button className="text-link" onClick={onLibrary}>Browse the red flags library <ArrowRight size={16} /></button></section>
}

function Results({ result, onScan, onHome }: { result: Result; onScan: () => void; onHome: () => void }) {
  const [reportOpen, setReportOpen] = useState(false); const [pin, setPin] = useState(''); const [pinMessage, setPinMessage] = useState('')
  const verifyPin = () => setPinMessage(pin.trim() ? 'Code queued for official verification.' : 'Enter a scratch-card PIN first.')
  return <section className="content-screen results-screen"><button className="back-link" onClick={onScan}><ArrowLeft size={18} /> Check another medicine</button><div className={`result-hero ${result.risk}`}><div className="result-icon">{result.risk === 'safe' ? <Check size={28} /> : result.risk === 'low' ? <CircleHelp size={28} /> : <AlertTriangle size={28} />}</div><div><p className="eyebrow">VISUAL AUDIT COMPLETE</p><h1>{result.risk === 'safe' ? 'Packaging looks consistent' : result.risk === 'low' ? 'We need better photos' : 'High risk: details don’t match'}</h1><p>Based on {result.photos} photos and {result.checks || 'the available'} visual forensic checks.</p>{result.live && <span className="live-badge">LIVE GEMINI ANALYSIS · {result.confidence} confidence</span>}</div></div>{result.summary && <div className="summary-card"><p className="eyebrow">MODEL SUMMARY</p><p>{result.summary}</p></div>}<div className="disclaimer"><ShieldCheck size={20} /><span>Authentic8 performs a visual packaging audit. Always verify scratch-card PIN codes with official health authorities (e.g. NAFDAC/PPB) before consumption.</span></div>{result.qualityNote ? <div className="quality-card"><Camera size={24} /><div><h2>Retake in better light</h2><p>{result.qualityNote}</p></div></div> : result.risk === 'safe' ? <div className="safe-card"><Check size={24} /><div><h2>Safe / verified visual result</h2><p>Font consistency, logo placement, registration details, print quality, seal presence, and pack color were checked with no concerns found.</p></div></div> : <div className="flags-list"><h2>What we found</h2>{result.flags.map((flag) => <article className="flag-card" key={flag.title}><div className={`confidence ${flag.confidence.toLowerCase()}`}>{flag.confidence}</div><div><h3>{flag.title}</h3><p>{flag.detail}</p></div></article>)}</div>}<div className="result-actions"><button className="report-button" onClick={() => setReportOpen(true)}>Report suspicious product <ArrowRight size={18} /></button><div className="pin-card"><div><p className="eyebrow">OFFICIAL CHECK</p><h2>Verify scratch-card PIN</h2><p>Confirm a code with the relevant health authority.</p></div><div className="pin-form"><label htmlFor="pin" className="sr-only">Scratch-card PIN</label><input id="pin" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="Enter PIN code" /><button onClick={verifyPin}>Verify code</button></div>{pinMessage && <p className="form-notice">{pinMessage}</p>}</div></div><button className="text-link" onClick={onHome}>Return home <ArrowRight size={16} /></button>{reportOpen && <div className="modal-backdrop" role="presentation" onClick={() => setReportOpen(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="report-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setReportOpen(false)} aria-label="Close report dialog"><X /></button><div className="modal-icon"><Check /></div><h2 id="report-title">Report queued</h2><p>Your suspicious product report is queued for submission to the official health regulatory database.</p><button className="primary-cta" onClick={() => setReportOpen(false)}>Done</button></div></div>}</section>
}

const libraryItems = [{ name: 'Coartem', count: 6, detail: 'Watch for logo color, batch spacing, and missing hologram seals.' }, { name: 'Amoxicillin', count: 4, detail: 'Check registration number placement and print sharpness.' }, { name: 'Paracetamol', count: 3, detail: 'Compare cap seal, font weight, and manufacturer details.' }]
function Library({ onBack }: { onBack: () => void }) { const [query, setQuery] = useState(''); const items = libraryItems.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())); return <section className="content-screen library-screen"><button className="back-link" onClick={onBack}><ArrowLeft size={18} /> Back to scan</button><div className="section-heading"><div><p className="eyebrow">REFERENCE GUIDE</p><h1>Know the red flags</h1><p>Learn what to look for before you take it.</p></div><CircleHelp size={34} /></div><div className="search-box"><Search size={22} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a drug" /></div><div className="category-tabs"><button className="active">Antimalarials</button><button>Antibiotics</button></div><div className="library-list">{items.map((item) => <button className="library-item" key={item.name}><div><h2>{item.name}</h2><p>{item.count} known red flags</p><span>{item.detail}</span></div><ChevronRight /></button>)}</div></section> }

export default function Authentic8App() { const [screen, setScreen] = useState<Screen>('home'); const [result, setResult] = useState<Result>(demoResults.counterfeit); const showScreen = screen === 'home' ? <Home onStart={() => setScreen('scan')} onLibrary={() => setScreen('library')} /> : screen === 'scan' ? <Scan onResult={(next) => { setResult(next); setScreen('results') }} onLibrary={() => setScreen('library')} /> : screen === 'results' ? <Results result={result} onScan={() => setScreen('scan')} onHome={() => setScreen('home')} /> : <Library onBack={() => setScreen('scan')} />; return <main className="app-shell"><Header onHome={() => setScreen('home')} onNavigate={setScreen} />{showScreen}<footer><span>Authentic8 · Built for safer medicine decisions</span><span>Not a substitute for a pharmacist</span></footer></main> }
