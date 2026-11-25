"use client";
import { useEffect, useState } from "react";
import { Search, ShieldCheck, Clock3, CheckCircle2, AlertCircle } from "lucide-react";

type JobStatus = {
  jobId: string; status: string; outputLanguage: string;
  durationSeconds: number | null; amountPaise: number | null; currency: string;
  createdAt: string; updatedAt: string; expiresAt: string; downloadReady: boolean;
};

const labels: Record<string,string> = {
  awaiting_upload: "Waiting for upload", uploaded: "Uploaded",
  awaiting_payment: "Payment pending", payment_failed: "Payment failed",
  paid: "Payment successful", queued: "Waiting in processing queue",
  processing: "Processing", completed: "Completed",
  processing_failed: "Processing failed", refunded: "Refunded",
  expired: "Expired", cancelled: "Cancelled"
};

export default function JobStatusPage() {
  const [jobId,setJobId]=useState("");
  const [token,setToken]=useState("");
  const [job,setJob]=useState<JobStatus|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [lastChecked,setLastChecked]=useState<string>("");

  async function refreshStatus(silent = false) {
    if (!jobId.trim() || !token) return;
    if (!silent) setBusy(true);
    if (!silent) setError("");
    try {
      const response=await fetch(`/api/jobs/${encodeURIComponent(jobId.trim())}/status`,{
        method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",
        body:JSON.stringify({customerAccessToken:token})
      });
      const data=await response.json();
      if(!response.ok) throw new Error(data.error || "Could not find this job.");
      setJob(data);
      setLastChecked(new Date().toLocaleTimeString());
    } catch(err) { if (!silent) setError(err instanceof Error?err.message:"Could not retrieve status."); }
    finally { if (!silent) setBusy(false); }
  }

  async function lookup(e: React.FormEvent) {
    e.preventDefault(); setJob(null);
    await refreshStatus(false);
  }

  useEffect(() => {
    if (!job || ["completed","payment_failed","processing_failed","refunded","expired","cancelled"].includes(job.status)) return;
    const timer = window.setInterval(() => { void refreshStatus(true); }, 8000);
    return () => window.clearInterval(timer);
  }, [job?.status, jobId, token]);

  return <main style={{maxWidth:680,margin:"48px auto",padding:24,fontFamily:"Arial,sans-serif"}}>
    <a href="/" style={{color:"#2563eb",textDecoration:"none"}}>← CaptionMitra</a>
    <h1 style={{fontSize:32,marginBottom:8}}>Track your video</h1>
    <p style={{color:"#64748b"}}>Enter your Job ID and one-time access key to securely check the latest status.</p>
    <form onSubmit={lookup} style={{display:"grid",gap:14,marginTop:24}}>
      <label>Job ID<input required value={jobId} onChange={e=>setJobId(e.target.value)} style={field}/></label>
      <label>One-time access key<input required type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} style={field}/></label>
      <button disabled={busy} style={button}>{busy?"Checking…":<><Search size={17} style={{verticalAlign:"middle"}}/> Check status</>}</button>
    </form>
    {error&&<p role="alert" style={{color:"#b91c1c"}}><AlertCircle size={16}/> {error}</p>}
    {job&&<section style={{border:"1px solid #e2e8f0",borderRadius:16,padding:20,marginTop:24}}>
      <div style={{display:"flex",alignItems:"center",gap:8,color:"#0f766e"}}><ShieldCheck size={20}/> Verified job</div>
      <h2 style={{fontSize:24,margin:"12px 0"}}>{labels[job.status]||job.status}</h2>
      <p><strong>Job ID:</strong> {job.jobId}</p>
      <p><strong>Language:</strong> {job.outputLanguage}</p>
      <p><strong>Duration:</strong> {job.durationSeconds===null?"Pending":`${Math.floor(job.durationSeconds/60)}m ${Math.round(job.durationSeconds%60)}s`}</p>
      <p><strong>Amount:</strong> {job.amountPaise===null?"Pending":new Intl.NumberFormat("en-IN",{style:"currency",currency:job.currency}).format(job.amountPaise/100)}</p>
      <p><strong>Last updated:</strong> {new Date(job.updatedAt).toLocaleString()}</p>
      <p><strong>Expiry:</strong> {new Date(job.expiresAt).toLocaleString()}</p>
      {job.downloadReady&&<p style={{color:"#0f766e"}}><CheckCircle2 size={17}/> Your result is ready. Secure download integration is the next storage-dependent step.</p>}
      {!job.downloadReady&&<p style={{color:"#64748b"}}><Clock3 size={17}/> This page checks automatically every 8 seconds while your job is active.</p>}
      {lastChecked&&<p style={{fontSize:12,color:"#64748b"}}>Last checked: {lastChecked}</p>}
      <button type="button" onClick={()=>void refreshStatus(false)} disabled={busy} style={{...button,background:"#475569",marginTop:8}}>Refresh now</button>
    </section>}
    <p style={{fontSize:12,color:"#64748b",marginTop:24}}>Keep your access key private. It is sent securely for verification and is not stored in this page.</p>
  </main>;
}
const field={display:"block",width:"100%",padding:12,marginTop:6,border:"1px solid #cbd5e1",borderRadius:8,boxSizing:"border-box" as const};
const button={padding:13,border:0,borderRadius:8,background:"#1d4ed8",color:"white",fontWeight:600,cursor:"pointer"};
