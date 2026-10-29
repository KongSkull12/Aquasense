import test,{mock,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {SensorReading as Model} from '../database/models/SensorReading';
import * as database from '../database/connection';
import {sensorReadingService} from './sensorReadingService';
import {SensorValidator} from './sensorHealth';
import {logger} from '../utils/logger';

afterEach(()=>mock.restoreAll());

test('rejected obsolete sequence does not mutate validator state before the next valid frame',async()=>{
  const rows:any[]=[];
  mock.method(logger,'info',()=>{});
  mock.method(Model,'create',async(values:any)=>{
    const row={...values,id:`ordering-${rows.length}`,createdAt:new Date(),updatedAt:new Date()};
    rows.unshift(row);
    return row;
  });
  mock.method(Model,'findOne',async(options:any={})=>{
    const where=options?.where??{};
    if(where.bootId!==undefined && where.sequenceId!==undefined) return rows.find(row=>row.deviceId===where.deviceId && row.bootId===where.bootId && row.sequenceId===where.sequenceId)??null;
    return rows.find(row=>!where.deviceId || row.deviceId===where.deviceId)??null;
  });
  mock.method(database,'getDatabase',()=>({
    query:async()=>[],
    transaction:async(work:(transaction:object)=>unknown)=>work({}),
  } as any));

  const acquired=Date.now();
  await sensorReadingService.ingest('ordering-restart-test',{
    temperature:25,ph:8,bootId:'boot-order-test',sequence:10,acquiredAt:new Date(acquired).toISOString(),
  });

  // Simulate a process restart: validator memory resets, persisted ordering does not.
  (sensorReadingService as any).validator=new SensorValidator();
  mock.method(Date,'now',()=>acquired+3000);
  await assert.rejects(sensorReadingService.ingest('ordering-restart-test',{
    temperature:25,ph:8,bootId:'boot-order-test',sequence:9,acquiredAt:new Date(acquired+2000).toISOString(),
  }),/Obsolete sensor frame/);

  const legitimate=await sensorReadingService.ingest('ordering-restart-test',{
    temperature:25,ph:8,bootId:'boot-order-test',sequence:11,acquiredAt:new Date(acquired+1500).toISOString(),
  });
  assert.equal(rows.length,2);
  assert.equal(legitimate.sensorHealth.ph.health,'VALID');
  assert.equal(legitimate.ph,8);
});
