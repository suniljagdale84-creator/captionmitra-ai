'use client';

import { useState } from "react";
import { UploadCloud, Captions, Languages, Download, Sparkles, Loader2, FileVideo, CheckCircle2 } from "lucide-react";

type Segment = { start: number; end: number; text: string };

const languages = [
  { value: "Hindi", label: "Hindi" },
  { value: "Marathi", label: "Marathi" },
  { value: "Hinglish", label: "Hinglish (Roman Hindi)" },
  { value: "English", label: "English" },
];

function stamp(seconds: number) {
  const ms = Math.max(0, Math.floor(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(milli).padStart(3,"0")}`;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("Hindi");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function generate() {
    if (!file) { setError("Please select a video or audio file first."); return; }
    setBusy(true); setError(""); setDone(false); setSegments([]);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("language", language);
      const response = await fetch("/api/captions", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Caption generation failed.");
      setSegments(data.segments || []);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally { setBusy(false); }
  }

  function download(kind: "srt" | "txt") {
    const content = kind === "srt"
      ? segments.map((s, i) => `${i+1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${s.text}`).join("\n\n")
      : segments.map(s => s.text).join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `captionmitra.${kind}`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="page">
      <nav className="nav"><div className="brand"><span className="brandIcon"><Captions size={22}/></span> CaptionMitra <b>AI</b></div><span className="navTag">AI VIDEO CAPTIONS</span></nav>
      <section className="hero">
        <div className="eyebrow"><Sparkles size={15}/> YOUR VIDEO, EVERY LANGUAGE</div>
        <h1>Make every word<br/><span>count.</span></h1>
        <p className="sub">Generate accurate subtitles and translate your videos into the languages your audience speaks.</p>
        <div className="languagePills"><span>Hindi</span><span>Marathi</span><span>Hinglish</span><span>English</span></div>
      </section>
      <section className="workspace">
        <div className="sectionHead"><div><h2>Create captions</h2><p>Upload your video or audio and choose your output language.</p></div><div className="step">01 <span>/ 02</span></div></div>
        <label className="uploadBox">
          <input type="file" accept="video/*,audio/*" onChange={e => {setFile(e.target.files?.[0] || null); setError(""); setDone(false);}}/>
          <span className="uploadIcon"><UploadCloud size={27}/></span>
          <strong>{file ? file.name : "Choose a video or audio file"}</strong>
          <small>{file ? `${(file.size / (1024*1024)).toFixed(1)} MB selected` : "MP4, MOV, MP3, WAV and more · Max 25 MB"}</small>
          <span className="browse">Browse files</span>
        </label>
        <div className="formRow">
          <label className="fieldLabel" htmlFor="language"><Languages size={16}/> OUTPUT LANGUAGE</label>
          <select id="language" value={language} onChange={e => setLanguage(e.target.value)}>{languages.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</select>
        </div>
        <button className="generate" onClick={generate} disabled={busy}>{busy ? <><Loader2 className="spin" size={18}/> Generating captions...</> : <><Sparkles size={18}/> Generate captions</>}</button>
        {error && <div className="error">{error}</div>}
        {done && <div className="success"><CheckCircle2 size={17}/> Captions generated. Review and edit the text below.</div>}
      </section>
      {segments.length > 0 && <section className="results">
        <div className="sectionHead"><div><h2>Your subtitles</h2><p>{segments.length} caption segments · You can edit each line.</p></div></div>
        {segments.map((s,i) => <div className="segment" key={i}><span>{stamp(s.start).slice(0,8)}</span><textarea value={s.text} onChange={e => setSegments(old => old.map((x,j) => j===i ? {...x,text:e.target.value} : x))}/></div>)}
        <div className="downloads"><button onClick={() => download("srt")}><Download size={16}/> Download SRT</button><button onClick={() => download("txt")}><Download size={16}/> Download TXT</button></div>
      </section>}
      <footer><span>© 2026 CaptionMitra AI</span><span>Made for creators <FileVideo size={14}/></span></footer>
    </main>
  );
}
