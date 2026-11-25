'use client';

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { uploadPresigned } from "@vercel/blob/client";
import { UploadCloud, Captions, Languages, Loader2, FileVideo, CheckCircle2, ShieldCheck } from "lucide-react";

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "video/mp4", "video/quicktime", "video/webm", "video/x-msvideo",
  "video/x-matroska", "audio/mpeg", "audio/mp3", "audio/wav",
  "audio/x-wav", "audio/mp4", "audio/aac", "audio/ogg",
  "audio/flac", "audio/webm",
]);
const languages = [
  { value: "Hindi", label: "Hindi" },
  { value: "Marathi", label: "Marathi" },
  { value: "Hinglish", label: "Hinglish (Roman Hindi)" },
  { value: "English", label: "English" },
];

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string;
        callback: (token: string) => void;
        "expired-callback"?: () => void;
        "error-callback"?: () => void;
        theme?: "light" | "dark" | "auto";
      }) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("Hindi");
  const [siteKey, setSiteKey] = useState("");
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState(false);
  const captchaRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/upload", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load upload security settings.");
        if (!cancelled) setSiteKey(data.siteKey);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load upload settings.");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!turnstileReady || !siteKey || !captchaRef.current || !window.turnstile || widgetIdRef.current) return;
    widgetIdRef.current = window.turnstile.render(captchaRef.current, {
      sitekey: siteKey,
      theme: "auto",
      callback: (token) => { setCaptchaToken(token); setError(""); },
      "expired-callback": () => setCaptchaToken(""),
      "error-callback": () => { setCaptchaToken(""); setError("Security check failed. Please refresh the CAPTCHA."); },
    });
    return () => {
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [turnstileReady, siteKey]);

  function chooseFile(next: File | null) {
    setFile(next);
    setError("");
    setUploaded(false);
    setProgress(0);
    setCaptchaToken("");
    if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
    if (!next) return;
    if (next.size > MAX_FILE_SIZE) {
      setError("File 200 MB se bada hai. Kripya 200 MB ya usse chhoti file select karein.");
      setFile(null);
      return;
    }
    if (!ALLOWED_TYPES.has(next.type)) {
      setError("This file format is not supported. Please choose MP4, MOV, WebM, AVI, MKV, MP3, WAV, AAC, OGG or FLAC.");
      setFile(null);
    }
  }

  async function uploadForStaging() {
    if (!file) { setError("Please select a video or audio file first."); return; }
    if (!captchaToken) { setError("Please complete the security check first."); return; }
    setBusy(true);
    setError("");
    setUploaded(false);
    setProgress(0);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "media-upload";
      const result = await uploadPresigned(`incoming/${Date.now()}-${safeName}`, file, {
        access: "private",
        // Vercel recommends multipart for files larger than 100 MB. The SDK splits and retries parts automatically.\n        multipart: file.size > 100 * 1024 * 1024,
        contentType: file.type,
        handleUploadUrl: "/api/upload",
        clientPayload: JSON.stringify({ turnstileToken: captchaToken }),
        onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
      });
      if (!result.pathname) throw new Error("Upload completed without a storage reference.");
      setUploaded(true);
      setProgress(100);
      setCaptchaToken("");
      if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
      setCaptchaToken("");
      if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setTurnstileReady(true)}
        onError={() => setError("Security verification could not load. Please refresh the page.")}
      />
      <nav className="nav"><div className="brand"><span className="brandIcon"><Captions size={22}/></span> CaptionMitra <b>AI</b></div><span className="navTag">AI VIDEO CAPTIONS</span></nav>
      <section className="hero">
        <div className="eyebrow"><ShieldCheck size={15}/> SECURE VIDEO UPLOAD</div>
        <h1>Make every word<br/><span>count.</span></h1>
        <p className="sub">Upload your video securely and prepare it for captions in the language your audience speaks.</p>
        <div className="languagePills"><span>Hindi</span><span>Marathi</span><span>Hinglish</span><span>English</span></div>
      </section>
      <section className="workspace">
        <div className="sectionHead"><div><h2>Upload your media</h2><p>Choose a video or audio file up to 200 MB. Files above 100 MB upload in automatic parts.</p></div><div className="step">01 <span>/ 03</span></div></div>
        <label className="uploadBox">
          <input type="file" accept="video/mp4,video/quicktime,video/webm,video/x-msvideo,video/x-matroska,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg,audio/flac,audio/webm" onChange={e => chooseFile(e.target.files?.[0] || null)} disabled={busy}/>
          <span className="uploadIcon"><UploadCloud size={27}/></span>
          <strong>{file ? file.name : "Choose a video or audio file"}</strong>
          <small>{file ? `${(file.size / (1024*1024)).toFixed(1)} MB selected` : "MP4, MOV, WebM, AVI, MKV, MP3, WAV and more · Max 200 MB · Large files split automatically"}</small>
          <span className="browse">Browse files</span>
        </label>
        <div className="formRow">
          <label className="fieldLabel" htmlFor="language"><Languages size={16}/> OUTPUT LANGUAGE</label>
          <select id="language" value={language} onChange={e => setLanguage(e.target.value)} disabled={busy}>{languages.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</select>
        </div>
        <p className="fieldLabel">SECURITY VERIFICATION</p>
        <div ref={captchaRef} />
        {!siteKey && <small>Loading secure verification…</small>}
        {busy && <div className="success"><Loader2 className="spin" size={17}/> Uploading securely… {progress}%</div>}
        {busy && <div style={{height:8,background:"#e5e7eb",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",width:`${progress}%`,background:"#2563eb",transition:"width .2s"}} /></div>}
        <button className="generate" onClick={uploadForStaging} disabled={busy || !file || !captchaToken}>
          {busy ? <><Loader2 className="spin" size={18}/> Uploading…</> : <><UploadCloud size={18}/> Upload securely</>}
        </button>
        {error && <div className="error">{error}</div>}
        {uploaded && <div className="success"><CheckCircle2 size={17}/> File uploaded to private temporary storage. Caption processing is the next setup stage and is not enabled yet.</div>}
        <p className="sub" style={{fontSize:13,marginTop:16}}>Your file is stored privately. Do not upload confidential material during this setup test. Automatic deletion will be connected with the processing worker before launch.</p>
      </section>
      <footer><span>© 2026 CaptionMitra AI</span><span>Made for creators <FileVideo size={14}/></span></footer>
    </main>
  );
}
