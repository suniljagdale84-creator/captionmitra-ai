import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getCustomerDownload } from "../src/lib/customer-download.mjs";

const jobId="123e4567-e89b-12d3-a456-426614174000";
const token="a".repeat(40);
const hash=createHash("sha256").update(token).digest("hex");
function fakePool({rows=[{id:jobId,result_blob_path:"results/job-1.srt"}],recorded=true}={}) {
 const calls=[];
 return {calls,query:async(sql,args)=>{
  calls.push({sql,args});
  if(sql.includes("SELECT id, result_blob_path")) { assert.equal(args[0],jobId); assert.equal(args[1],hash); return {rows}; }
  if(sql.includes("UPDATE caption_jobs")) return {rows:recorded?[{customer_download_count:1}]:[]};
  throw new Error("Unexpected query");
 }};
}
test("authorizes completed job and requests private blob",async()=>{
 const pool=fakePool(); let opts;
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array([65]));c.close();}});
 const result=await getCustomerDownload(pool,async(path,options)=>{opts={path,options};return {statusCode:200,stream,blob:{contentType:"text/plain",pathname:"results/my file.srt",size:1}};},{jobId,accessToken:token});
 assert.equal(opts.path,"results/job-1.srt");
 assert.deepEqual(opts.options,{access:"private"});
 assert.equal(result.filename,"my_file.srt");
 assert.equal(result.downloadCount,1);
});
test("rejects invalid credentials before storage access",async()=>{
 let called=false;
 await assert.rejects(getCustomerDownload(fakePool(),async()=>{called=true;},{jobId,accessToken:"bad"}),/Invalid access key/);
 assert.equal(called,false);
});
test("rejects missing, expired, or incomplete jobs",async()=>{
 await assert.rejects(getCustomerDownload(fakePool({rows:[]}),async()=>null,{jobId,accessToken:token}),/not found or expired/);
});
test("does not serve if expiry or status changes before count is recorded",async()=>{
 const pool=fakePool({recorded:false});
 const stream=new ReadableStream({start(c){c.close();}});
 await assert.rejects(getCustomerDownload(pool,async()=>({statusCode:200,stream,blob:{pathname:"x.srt"}}),{jobId,accessToken:token}),/expired or access was revoked/);
});
