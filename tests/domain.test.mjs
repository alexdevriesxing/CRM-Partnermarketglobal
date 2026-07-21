import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contactsToCsv,
  dueBucket,
  groupAgenda,
  nextRecurringDate,
  normalizeTags,
  parseCsv,
  relationshipHealth,
  summarizePipeline,
  weightedPipeline,
} from '../src/lib/domain.js';

test('relationship health rewards recent engagement and penalizes overdue work',()=>{
  const now=new Date('2026-07-21T12:00:00Z');
  const healthy=relationshipHealth({lastContactAt:'2026-07-18T12:00:00Z',activityCount:8,completedTasks:3,openDealValue:100000},now);
  const risky=relationshipHealth({lastContactAt:'2026-02-01T12:00:00Z',activityCount:1,overdueTasks:2,overdueFollowUps:2},now);
  assert.ok(healthy>70);assert.ok(risky<35);assert.ok(healthy>risky);
});

test('due buckets classify overdue, today, upcoming and later',()=>{
  const now=new Date('2026-07-21T12:00:00Z');
  assert.equal(dueBucket('2026-07-20T12:00:00Z',now),'overdue');
  assert.equal(dueBucket('2026-07-21T18:00:00Z',now),'today');
  assert.equal(dueBucket('2026-07-25T12:00:00Z',now),'upcoming');
  assert.equal(dueBucket('2026-08-15T12:00:00Z',now),'later');
  assert.equal(dueBucket(null,now),'unscheduled');
});

test('agenda grouping sorts each queue by due date',()=>{
  const grouped=groupAgenda([{id:2,due_at:'2026-07-21T15:00:00Z'},{id:1,due_at:'2026-07-21T10:00:00Z'}],new Date('2026-07-21T08:00:00Z'));
  assert.deepEqual(grouped.today.map(x=>x.id),[1,2]);
});

test('recurring dates advance correctly',()=>{
  assert.equal(nextRecurringDate('2026-07-21T09:00:00Z','weekly'),'2026-07-28T09:00:00.000Z');
  assert.equal(nextRecurringDate('2026-07-21T09:00:00Z','monthly'),'2026-08-21T09:00:00.000Z');
  assert.equal(nextRecurringDate('2026-07-21T09:00:00Z','none'),null);
});

test('pipeline analytics include discovery and weighted value',()=>{
  const deals=[{stage:'discovery',value:100000,probability:40},{stage:'won',value:50000,probability:100},{stage:'lost',value:20000,probability:0}];
  assert.equal(weightedPipeline(deals),90000);
  const summary=summarizePipeline(deals);
  assert.equal(summary.byStage.discovery.count,1);
  assert.equal(summary.wonValue,50000);
  assert.equal(summary.winRate,50);
});

test('CSV handling preserves quoted values and consent fields',()=>{
  const rows=parseCsv('first_name,last_name,organization,consent_status\nMaya,Santoso,"Nusantara, Group",consented');
  assert.equal(rows[0].organization,'Nusantara, Group');
  assert.equal(rows[0].consent_status,'consented');
  const csv=contactsToCsv([{first_name:'Maya',last_name:'Santoso',organization:'Nusantara, Group',consent_status:'consented',tags:['key','asia']}]);
  assert.match(csv,/consent_status/);assert.match(csv,/"Nusantara, Group"/);
});

test('tags normalize, deduplicate and lowercase',()=>{
  assert.deepEqual(normalizeTags('Key, Asia, key,  Investor '),['key','asia','investor']);
});
