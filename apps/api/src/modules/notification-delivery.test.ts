import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import type {Pool} from 'pg';
import {NotificationPublisher,notificationMessage} from './notifications/publisher.js';
import {NotificationDeliveryWorker} from './notifications/delivery.js';
test('notification copy distinguishes event cancellation from own registration cancellation',()=>{
 assert.equal(notificationMessage('event.cancelled','Event title').body,'An event you registered for has been cancelled.');
 assert.equal(notificationMessage('registration.cancelled','Event title').body,'Your event registration has been cancelled.');
 assert.equal(notificationMessage('event.published','x'.repeat(300)).title.length,200);
});
test('notification encryption configuration and worker batches fail closed',async()=>{
 assert.throws(()=>new NotificationPublisher('invalid'));
 const worker=new NotificationDeliveryWorker({} as Pool,randomBytes(32).toString('base64'),{});
 assert.deepEqual(await worker.run(),{claimed:0,results:{}});
 for(const limit of [0,51,1.5]) {await assert.rejects(worker.claim(limit));await assert.rejects(worker.run(limit));}
});
