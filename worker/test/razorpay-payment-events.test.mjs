import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { applyRazorpayPaymentFailedEvent, applyRazorpayRefundProcessedEvent } from "../src/razorpay-payment-events.mjs";

const secret = "webhook-test-secret";
const sign = body => createHmac("sha256", secret).update(body).digest("hex");
function poolFor({ status="awaiting_payment", amount=1200, existing=false }={}) {
  const calls=[];
  const client={query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql.includes("INSERT INTO payment_webhook_events")) return {rows:existing?[]:[{provider_event_id:"evt"}]};
    if(sql.includes("SELECT id, status FROM caption_jobs")) return {rows:[{id:"job",status}]};
    if(sql.includes("SELECT id, status, amount_paise")) return {rows:[{id:"job",status,amount_paise:amount,provider_payment_id:"pay",provider_refund_id:null}]};
    return {rows:[]};
  },release(){}};
  return {calls,connect:async()=>client};
}
test("failed payment is recorded but never queued",async()=>{
 const payload={event:"payment.failed",payload:{payment:{entity:{id:"pay",order_id:"order"}}}};
 const rawBody=Buffer.from(JSON.stringify(payload)), pool=poolFor();
 const out=await applyRazorpayPaymentFailedEvent(pool,{rawBody,signature:sign(rawBody),webhookSecret:secret,eventId:"evt",payload});
 assert.equal(out.updated,true);
 assert.equal(pool.calls.some(c=>c.sql.includes("SET status = 'queued'")),false);
});
test("duplicate failed event is idempotent",async()=>{
 const payload={event:"payment.failed",payload:{payment:{entity:{id:"pay",order_id:"order"}}}};
 const rawBody=Buffer.from(JSON.stringify(payload)), pool=poolFor({existing:true});
 const out=await applyRazorpayPaymentFailedEvent(pool,{rawBody,signature:sign(rawBody),webhookSecret:secret,eventId:"evt",payload});
 assert.equal(out.duplicate,true);
});
test("full processed refund marks job refunded",async()=>{
 const payload={event:"refund.processed",payload:{refund:{entity:{id:"rfnd",payment_id:"pay",amount:1200,currency:"INR"}}}};
 const rawBody=Buffer.from(JSON.stringify(payload)), pool=poolFor({status:"completed",amount:1200});
 const out=await applyRazorpayRefundProcessedEvent(pool,{rawBody,signature:sign(rawBody),webhookSecret:secret,eventId:"evt2",payload});
 assert.equal(out.refunded,true);
 assert.ok(pool.calls.some(c=>c.sql.includes("SET status = 'refunded'")));
});
test("rejects partial refund for manual review",async()=>{
 const payload={event:"refund.processed",payload:{refund:{entity:{id:"rfnd",payment_id:"pay",amount:500,currency:"INR"}}}};
 const rawBody=Buffer.from(JSON.stringify(payload)), pool=poolFor({status:"completed",amount:1200});
 await assert.rejects(applyRazorpayRefundProcessedEvent(pool,{rawBody,signature:sign(rawBody),webhookSecret:secret,eventId:"evt3",payload}),/Partial refunds/);
});
