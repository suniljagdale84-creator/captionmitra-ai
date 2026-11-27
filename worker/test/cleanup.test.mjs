import test from "node:test";
import assert from "node:assert/strict";
import { runBlobCleanup } from "../src/cleanup.mjs";

function fakePool({ tasks = [], status = "completed", source = "private/source.mp4", result = "private/result.srt", expired = true } = {}) {
  const calls=[];
  const job={id:"job-1",status,expires_at:expired?new Date(Date.now()-1000):new Date(Date.now()+60000),source_blob_path:source,result_blob_path:result};
  const pool={
    calls,
    query:async(sql,args)=>{
      calls.push({sql,args});
      if(sql.includes("INSERT INTO caption_blob_cleanup_tasks")) return {rowCount:0,rows:[]};
      if(sql.includes("UPDATE caption_jobs")) return {rowCount:1,rows:[{id:"job-1"}]};
      if(sql.includes("DELETE FROM caption_blob_cleanup_tasks")) return {rowCount:1,rows:[]};
      return {rowCount:0,rows:[]};
    },
    connect:async()=>({
      query:async(sql,args)=>{
        calls.push({sql,args});
        if(sql==="BEGIN"||sql==="COMMIT"||sql==="ROLLBACK") return {rows:[]};
        if(sql.includes("SELECT id, job_id, blob_kind")) return {rows:tasks};
        if(sql.includes("SELECT j.id, j.status")) return {rows:[job]};
        return {rows:[]};
      },
      release(){}
    })
  };
  return pool;
}
test("rejects missing storage delete adapter",async()=>{
 await assert.rejects(runBlobCleanup(fakePool(),null),/adapter is required/);
});
test("does not enqueue source files for active processing jobs",async()=>{
 const pool=fakePool({status:"processing"});
 await runBlobCleanup(pool,async()=>{});
 const sourceInsert=pool.calls.find(c=>c.sql.includes("SELECT id, 'source'"));
 assert.ok(sourceInsert);
 assert.deepEqual(sourceInsert.args[0],["completed","payment_failed","processing_failed","refunded","expired","cancelled"]);
});
test("deletes eligible expired result and clears its database path",async()=>{
 const task={id:1,job_id:"job-1",blob_kind:"result",blob_path:"private/result.srt"};
 const pool=fakePool({tasks:[task]}); let deletedPath;
 const out=await runBlobCleanup(pool,async path=>{deletedPath=path;});
 assert.equal(deletedPath,task.blob_path);
 assert.equal(out.deleted,1);
 assert.ok(pool.calls.some(c=>c.sql.includes("result_blob_path = CASE")));
});
test("keeps failed deletion retryable",async()=>{
 const task={id:2,job_id:"job-1",blob_kind:"result",blob_path:"private/result.srt"};
 const pool=fakePool({tasks:[task]});
 const out=await runBlobCleanup(pool,async()=>{throw new Error("storage down");});
 assert.equal(out.retried,1);
 assert.ok(pool.calls.some(c=>c.sql.includes("attempt_count = attempt_count + 1")));
});
