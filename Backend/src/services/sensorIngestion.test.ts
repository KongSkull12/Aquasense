import test,{mock,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {SensorReading as Model} from '../database/models/SensorReading';
import * as database from '../database/connection';
import {sensorReadingService} from './sensorReadingService';
import {predictiveAnalyticsService} from './predictiveAnalytics.service';
import {waterAlertNotificationService} from './waterAlertNotification.service';
import {MQTTService, sanitizeBrokerUrl} from './mqttService';
import {logger} from '../utils/logger';
import {waterReadingSchema,sensorIngestSchema} from '../middleware/validate';
import {SensorValidator, timestampMs} from './sensorHealth';
import {config} from '../config/config';
import {signCanonical} from './hardwareProtocol';
afterEach(()=>mock.restoreAll());
test('MQTT broker diagnostics redact URL credentials and non-endpoint components',()=>{
  const url='mqtt://username:password@broker.example:1883/private/path?token=hidden#fragment';
  assert.equal(sanitizeBrokerUrl(url),'mqtt://broker.example:1883');
  assert.equal(new MQTTService({brokerUrl:url}).getStatus().brokerUrl,'mqtt://broker.example:1883');
  assert.equal(sanitizeBrokerUrl('not a URL'),'invalid-broker-url');
});
function storage() {
  const rows:any[]=[];
  mock.method(logger,'info',()=>{});mock.method(logger,'warn',()=>{});
  mock.method(Model,'create',async (values:any)=>{const r={...values,id:`test-${rows.length}`,createdAt:new Date(),updatedAt:new Date()};rows.unshift(r);return r;});
  mock.method(Model,'findOne',async(options:any={})=>{
    const where=options?.where??{};
    if(where.bootId!==undefined && where.sequenceId!==undefined) return rows.find(r=>r.deviceId===where.deviceId && r.bootId===where.bootId && r.sequenceId===where.sequenceId)??null;
    return rows.find(r=>!where.deviceId || r.deviceId===where.deviceId)??null;
  });
  mock.method(Model,'findAll',async()=>rows);
  mock.method(database,'getDatabase',()=>({query:async()=>[],transaction:async(work:(transaction:object)=>unknown)=>work({})} as any));
  return rows;
}
test('HTTP schemas preserve null, missing and malformed readings for diagnostics',()=>{
  for(const schema of [waterReadingSchema,sensorIngestSchema]) {
    const data=schema.parse({deviceId:'test',temperature:null,ph:'7junk',sensors:{ph:{rawAdc:3000}}});
    assert.equal(data.temperature,null);assert.equal(data.ph,'7junk');assert.equal(data.do,undefined);assert.ok(data.sensors);
  }
});
test('TAN transport requires measured value provenance, units, validation and timestamp',()=>{
  const tan={value:1,unit:'mg/L as N',source:'test_kit',validated:true,timestamp:'2026-09-14T04:00:00.000Z'};
  assert.equal(waterReadingSchema.safeParse({tan}).success,true);
  assert.equal(sensorIngestSchema.safeParse({deviceId:'test',tan}).success,true);
  for(const invalid of [1,{...tan,unit:'mg/L NH3'},{...tan,source:'unknown'},{...tan,validated:false},{...tan,timestamp:'not-a-time'},{...tan,value:-1},{...tan,extra:'unverified'}]) {
    assert.equal(waterReadingSchema.safeParse({tan:invalid}).success,false,`expected invalid TAN payload: ${JSON.stringify(invalid)}`);
  }
});
test('production ingestion retains error diagnostics, rejects legacy DO input and never invents ammonia',async()=>{
  const rows=storage();
  const r=await sensorReadingService.ingest('error-test',{temperature:-127,ph:8,turbidity:1800,turbidityUnit:'raw_adc',orp:220,do:7,dissolvedOxygen:8,sensors:{ph:{rawAdc:3000,voltage:2.4}},ammonia:0.5});
  assert.equal(r.temperature,null);assert.equal(r.sensorHealth.temperature.value,-127);assert.equal(r.sensorHealth.temperature.health,'SENSOR_ERROR');
  assert.equal(r.sensorHealth.ph.rawAdc,3000);assert.equal(r.do,null);assert.equal(r.doMeasured,false);assert.equal(r.ammonia,null);assert.equal(r.speciation.status,'UNAVAILABLE');
  assert.equal(rows[0].temperature,null);assert.equal(rows[0].ammonia,null);
});
test('faulted MQTT frames expose reported ORP only alongside invalid calibration health',async()=>{
  storage();const notify=mock.method(waterAlertNotificationService,'processReading',async()=>({alertsCreated:0,smsSentCount:0}));
  const service=new MQTTService();let received:any;
  service.setRealtimeHandlers({onReadingReceived:r=>received=r});
  await (service as any).handleSensorReading(JSON.stringify({deviceId:'mqtt-fault-test',temperature:-127,ph:null,turbidity:1800,turbidityUnit:'raw_adc',orp:220}));
  assert.equal(received.temperature,null);assert.equal(received.sensorHealth.ph.health,'MISSING');assert.equal(received.orp,220);
  assert.equal(received.sensorHealth.orp.health,'MISSING');assert.equal(received.do,null);assert.equal(received.doMeasured,false);
  assert.equal((notify.mock.calls[0].arguments as any)[0].temperature,null);
});
test('HTTP reading exposes reported ORP for a clearly uncalibrated trend only',async()=>{
  storage();
  const reading=await sensorReadingService.ingest('orp-display-test',{temperature:25,ph:8,orp:-330.4});
  assert.equal(reading.orp,-330.4);
  assert.equal(reading.sensorHealth.orp.valid,false);
  assert.equal(reading.sensorHealth.orp.calibration,'REQUIRED');
  assert.equal(reading.waterQuality.orp,'NO WATER-QUALITY POLICY');
});
test('topic MQTT keeps NTU and raw ADC turbidity units distinct',async()=>{
  const rows=storage();
  mock.method(waterAlertNotificationService,'processReading',async()=>({alertsCreated:0,smsSentCount:0}));
  const ntu=new MQTTService();
  (ntu as any).handleAquasenseTopicValue('aquasense/device-id','water-monitor-test');
  (ntu as any).handleAquasenseTopicValue('aquasense/temperature','25');
  (ntu as any).handleAquasenseTopicValue('aquasense/ph','7.5');
  (ntu as any).handleAquasenseTopicValue('aquasense/turbidity-ntu','20');
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(rows[0].turbidityUnit,'NTU');
  assert.equal(rows[0].deviceId,'water-monitor-test');

  const raw=new MQTTService();
  (raw as any).handleAquasenseTopicValue('aquasense/temperature','25');
  (raw as any).handleAquasenseTopicValue('aquasense/ph','7.5');
  (raw as any).handleAquasenseTopicValue('aquasense/turbidity','1800');
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(rows[0].turbidityUnit,'raw_adc');
});
test('topic MQTT assembles out-of-order sensor updates without mixing raw ADC into NTU',async()=>{
  const rows=storage();
  mock.method(waterAlertNotificationService,'processReading',async()=>({alertsCreated:0,smsSentCount:0}));
  const service=new MQTTService();
  (service as any).handleAquasenseTopicValue('aquasense/device-id','ordered-topic-test');
  (service as any).handleAquasenseTopicValue('aquasense/ph','7.5');
  (service as any).handleAquasenseTopicValue('aquasense/turbidity-ntu','20');
  (service as any).handleAquasenseTopicValue('aquasense/turbidity','1800');
  assert.equal(rows.length,0,'incomplete topic frame must not reuse cached temperature');
  (service as any).handleAquasenseTopicValue('aquasense/temperature','25');
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(rows.length,1);
  assert.equal(rows[0].turbidity,20);
  assert.equal(rows[0].turbidityUnit,'NTU');
  assert.equal(rows[0].sensorHealth.turbidity.rawAdc,1800);
});
test('topic MQTT duplicate updates cannot emit a second frame without fresh required parameters',async()=>{
  const rows=storage();
  mock.method(waterAlertNotificationService,'processReading',async()=>({alertsCreated:0,smsSentCount:0}));
  const service=new MQTTService();
  (service as any).handleAquasenseTopicValue('aquasense/device-id','duplicate-topic-test');
  (service as any).handleAquasenseTopicValue('aquasense/temperature','25');
  (service as any).handleAquasenseTopicValue('aquasense/ph','7.5');
  (service as any).handleAquasenseTopicValue('aquasense/turbidity-ntu','20');
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(rows.length,1);
  (service as any).handleAquasenseTopicValue('aquasense/turbidity-ntu','20');
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(rows.length,1);
});
test('public MQTT persists only timestamped v1 frames on the exact configured device topic',async()=>{
  const rows=storage();
  mock.method(waterAlertNotificationService,'processReading',async()=>({alertsCreated:0,smsSentCount:0}));
  const previous={
    enabled:config.mqtt.publicTelemetryOnly,
    namespace:config.mqtt.topicNamespace,
    deviceId:config.mqtt.telemetryDeviceId,
    scoped:config.mqtt.deviceScopedTopics,
    commands:config.mqtt.actuatorCommandsEnabled,
    deviceKey:config.device.keys['esp32-feeder-1'],
  };
  config.mqtt.publicTelemetryOnly=true;
  config.mqtt.topicNamespace='aquasense-dev';
  config.mqtt.telemetryDeviceId='esp32-feeder-1';
  config.mqtt.deviceScopedTopics=true;
  config.mqtt.actuatorCommandsEnabled=false;
  config.device.keys['esp32-feeder-1']='test-public-frame-key';
  try {
    const service=new MQTTService();
    const accept=(suffix:string,value:string)=> (service as any).handlePublicTelemetryMessage(
      `aquasense-dev/devices/esp32-feeder-1/telemetry/${suffix}`,Buffer.from(value));
    (service as any).handlePublicTelemetryMessage('aquasense-dev/devices/other-device/telemetry/temperature',Buffer.from('25'));
    (service as any).handlePublicTelemetryMessage('aquasense-dev/devices/esp32-feeder-1/telemetry/temperature/status',Buffer.from('25'));
    (service as any).handlePublicTelemetryMessage('aquasense-dev/devices/esp32-feeder-1/command',Buffer.from('25'));
    // Legacy scalar publications carry no source time or sequence. They are
    // intentionally ignored by this profile rather than stamped at receipt.
    accept('temperature','25.1'); accept('ph','7.4'); accept('turbidity-ntu','18');
    const acquiredAt=new Date(Date.now()-100).toISOString();
    const frame={v:1,deviceId:'esp32-feeder-1',bootId:'boot-frame-test',sequence:1,acquiredAt,
      sensorTimestamps:{temperature:acquiredAt,ph:acquiredAt,turbidity:acquiredAt,orp:acquiredAt},
      temperature:25.1,ph:7.4,turbidity:18,turbidityUnit:'NTU',orp:null,
      sensors:{temperature:{connected:true,valid:true,sampleAgeMs:100},ph:{connected:true,valid:true,sampleAgeMs:100},
        turbidity:{connected:true,valid:true,sampleAgeMs:100,rawAdc:1800},orp:{connected:false,valid:false,sampleAgeMs:100}}};
    const publishFrame=(value:unknown,device='esp32-feeder-1',signatureOverride?:string)=>{
      const signedBody=JSON.stringify(value);
      const envelope={frame:signedBody,signature:signatureOverride??signCanonical(signedBody,'test-public-frame-key')};
      (service as any).handlePublicTelemetryMessage(
        `aquasense-dev/devices/${device}/telemetry/frame`,Buffer.from(JSON.stringify(envelope)));
    };
    publishFrame({...frame,deviceId:'different-device'});
    publishFrame({...frame,acquiredAt:'not-a-date'});
    publishFrame(frame,'other-device');
    publishFrame(frame,'esp32-feeder-1','0'.repeat(64));
    publishFrame(frame);
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(rows.length,1);
    assert.equal(rows[0].deviceId,'esp32-feeder-1');
    assert.equal(rows[0].temperature,25.1);
    assert.equal(rows[0].ph,7.4);
    assert.equal(rows[0].turbidity,18);
    assert.equal(rows[0].turbidityUnit,'NTU');
    assert.equal(rows[0].timestamp.toISOString(),acquiredAt);
    assert.equal(rows[0].bootId,'boot-frame-test');
    assert.equal(rows[0].sequenceId,1);
    assert.equal(rows[0].sensorHealth.orp.value,null);
    assert.equal(rows[0].sensorHealth.turbidity.rawAdc,1800);
    assert.ok(Number.isFinite(Date.parse(service.getStatus().lastPublicFrameReceivedAt!)));
    assert.ok(Number.isFinite(Date.parse(service.getStatus().lastPublicFrameVerifiedAt!)));
    assert.ok(Number.isFinite(Date.parse(service.getStatus().lastPublicFramePersistedAt!)));
  } finally {
    config.mqtt.publicTelemetryOnly=previous.enabled;
    config.mqtt.topicNamespace=previous.namespace;
    config.mqtt.telemetryDeviceId=previous.deviceId;
    config.mqtt.deviceScopedTopics=previous.scoped;
    config.mqtt.actuatorCommandsEnabled=previous.commands;
    if (previous.deviceKey === undefined) delete config.device.keys['esp32-feeder-1'];
    else config.device.keys['esp32-feeder-1']=previous.deviceKey;
  }
});
test('public telemetry-only mode refuses outbound actuator MQTT commands',async()=>{
  const enabled=config.mqtt.publicTelemetryOnly, commands=config.mqtt.actuatorCommandsEnabled;
  config.mqtt.publicTelemetryOnly=true;
  config.mqtt.actuatorCommandsEnabled=false;
  try {
    const result=await new MQTTService().dispatchHardwareCommand({id:'command-test',deviceId:'esp32-feeder-1',source:'hardware',action:'ALL_OFF',expiresAt:new Date(Date.now()+1000)});
    assert.equal(result,false);
  } finally {
    config.mqtt.publicTelemetryOnly=enabled;
    config.mqtt.actuatorCommandsEnabled=commands;
  }
});
test('public MQTT profile subscribes only to its exact device telemetry wildcard',()=>{
  const previous={enabled:config.mqtt.publicTelemetryOnly,namespace:config.mqtt.topicNamespace,
    deviceId:config.mqtt.telemetryDeviceId,scoped:config.mqtt.deviceScopedTopics,
    commands:config.mqtt.actuatorCommandsEnabled,wildcard:config.mqtt.topics.sensorWildcard};
  config.mqtt.publicTelemetryOnly=true;
  config.mqtt.topicNamespace='aquasense-dev';
  config.mqtt.telemetryDeviceId='esp32-feeder-1';
  config.mqtt.deviceScopedTopics=true;
  config.mqtt.actuatorCommandsEnabled=false;
  const expected='aquasense-dev/devices/esp32-feeder-1/telemetry/+';
  config.mqtt.topics.sensorWildcard=expected;
  try {
    const service=new MQTTService();
    const subscribe=mock.fn((_topics: string[], callback: (error: Error|null)=>void)=>callback(null));
    (service as any).client={subscribe};
    (service as any).subscribe();
    assert.deepEqual(subscribe.mock.calls[0].arguments[0],[expected]);
  } finally {
    config.mqtt.publicTelemetryOnly=previous.enabled;
    config.mqtt.topicNamespace=previous.namespace;
    config.mqtt.telemetryDeviceId=previous.deviceId;
    config.mqtt.deviceScopedTopics=previous.scoped;
    config.mqtt.actuatorCommandsEnabled=previous.commands;
    config.mqtt.topics.sensorWildcard=previous.wildcard;
  }
});
test('public MQTT persistence is rate-limited to one complete frame per 4500 ms',async()=>{
  const rows=storage();
  mock.method(waterAlertNotificationService,'processReading',async()=>({alertsCreated:0,smsSentCount:0}));
  const now=Date.now(); let clock=now;
  mock.method(Date,'now',()=>clock);
  const previous={enabled:config.mqtt.publicTelemetryOnly,namespace:config.mqtt.topicNamespace,deviceId:config.mqtt.telemetryDeviceId,deviceKey:config.device.keys['esp32-feeder-1']};
  config.mqtt.publicTelemetryOnly=true;
  config.mqtt.topicNamespace='aquasense-dev';
  config.mqtt.telemetryDeviceId='esp32-feeder-1';
  config.device.keys['esp32-feeder-1']='test-public-frame-key';
  try {
    const service=new MQTTService();
    let sequence=0;
    const frame=(temperature:number)=>{
      const acquiredAt=new Date(clock).toISOString();
      const payload={v:1,deviceId:'esp32-feeder-1',bootId:'rate-limit-boot',sequence:++sequence,acquiredAt,
        sensorTimestamps:{temperature:acquiredAt,ph:acquiredAt,turbidity:acquiredAt,orp:acquiredAt},
        temperature,ph:7.4,turbidity:18,turbidityUnit:'NTU',orp:null,
        sensors:{temperature:{connected:true,valid:true,sampleAgeMs:0},ph:{connected:true,valid:true,sampleAgeMs:0},
          turbidity:{connected:true,valid:true,sampleAgeMs:0},orp:{connected:false,valid:false,sampleAgeMs:0}}};
      const frameBody=JSON.stringify(payload);
      (service as any).handlePublicTelemetryMessage('aquasense-dev/devices/esp32-feeder-1/telemetry/frame',
        Buffer.from(JSON.stringify({frame:frameBody,signature:signCanonical(frameBody,'test-public-frame-key')})));
    };
    frame(25);
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(rows.length,1);
    clock+=4499; frame(25.1);
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(rows.length,1);
    clock+=1; frame(25.2);
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(rows.length,2);
  } finally {
    config.mqtt.publicTelemetryOnly=previous.enabled;
    config.mqtt.topicNamespace=previous.namespace;
    config.mqtt.telemetryDeviceId=previous.deviceId;
    if (previous.deviceKey === undefined) delete config.device.keys['esp32-feeder-1'];
    else config.device.keys['esp32-feeder-1']=previous.deviceKey;
  }
});
test('public MQTT serializes ingestion and drains only the newest bounded pending frame',async()=>{
  const now=Date.now(); let clock=now;
  mock.method(Date,'now',()=>clock);
  const service=new MQTTService();
  let releaseFirst!: (inserted:boolean)=>void;
  const firstIngestion=new Promise<boolean>(resolve=>{releaseFirst=resolve;});
  const ingested:number[]=[];
  (service as any).handleSensorReading=async(payload:string)=>{
    const sequence=JSON.parse(payload).sequence;
    ingested.push(sequence);
    return sequence===1 ? firstIngestion : true;
  };

  void (service as any).persistPublicMqttFrame(JSON.stringify({sequence:1}),'deferred-boot',1);
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(ingested,[1]);
  void (service as any).persistPublicMqttFrame(JSON.stringify({sequence:2}),'deferred-boot',2);
  void (service as any).persistPublicMqttFrame(JSON.stringify({sequence:3}),'deferred-boot',3);
  // A late replay must not replace the newer pending sequence.
  void (service as any).persistPublicMqttFrame(JSON.stringify({sequence:2}),'deferred-boot',2);
  assert.equal((service as any).pendingPublicFrame.sequence,3);
  assert.deepEqual(ingested,[1]);

  releaseFirst(true);
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(ingested,[1]);
  clock+=4500;
  await (service as any).drainPublicMqttFrame();
  assert.deepEqual(ingested,[1,3]);
  assert.equal((service as any).pendingPublicFrame,null);
  assert.equal((service as any).publicFramePersistInProgress,false);
});
test('MQTT disconnect cancels the frame drain timer and discards pending telemetry',async()=>{
  const now=Date.now(); let clock=now;
  mock.method(Date,'now',()=>clock);
  const enabled=config.mqtt.publicTelemetryOnly;
  config.mqtt.publicTelemetryOnly=true;
  try {
    const service=new MQTTService();
    const ingested:number[]=[];
    (service as any).handleSensorReading=async(payload:string)=>{ingested.push(JSON.parse(payload).sequence);return true;};
    (service as any).lastPublicFramePersistedAt=clock;
    void (service as any).persistPublicMqttFrame(JSON.stringify({sequence:7}),'disconnect-boot',7);
    assert.equal((service as any).pendingPublicFrame.sequence,7);
    assert.ok((service as any).publicFrameDrainTimer);
    (service as any).client={end:(_force:boolean,callback:()=>void)=>callback()};

    await service.disconnect();
    assert.equal((service as any).pendingPublicFrame,null);
    assert.equal((service as any).publicFrameDrainTimer,null);
    clock+=4500;
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.deepEqual(ingested,[]);
  } finally {
    config.mqtt.publicTelemetryOnly=enabled;
  }
});
test('topic MQTT missing and disconnected values never persist cached measurements',async()=>{
  const rows=storage();
  mock.method(waterAlertNotificationService,'processReading',async()=>({alertsCreated:0,smsSentCount:0}));
  const service=new MQTTService();
  (service as any).handleAquasenseTopicValue('aquasense/device-id','missing-topic-test');
  (service as any).handleAquasenseTopicValue('aquasense/temperature','25');
  (service as any).handleAquasenseTopicValue('aquasense/ph','7.5');
  (service as any).handleAquasenseTopicValue('aquasense/turbidity-ntu','DISCONNECTED');
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(rows.length,0);

  const interrupted=new MQTTService();
  (interrupted as any).handleAquasenseTopicValue('aquasense/device-id','interrupted-topic-test');
  (interrupted as any).handleAquasenseTopicValue('aquasense/turbidity','1800');
  (interrupted as any).handleAquasenseTopicValue('aquasense/turbidity','DISCONNECTED');
  (interrupted as any).handleAquasenseTopicValue('aquasense/temperature','25');
  (interrupted as any).handleAquasenseTopicValue('aquasense/ph','7.5');
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(rows.length,0,'disconnect must clear an unflushed raw value');
});
test('raw-only topic source remains explicitly raw_adc',async()=>{
  const rows=storage();
  mock.method(waterAlertNotificationService,'processReading',async()=>({alertsCreated:0,smsSentCount:0}));
  const service=new MQTTService();
  (service as any).handleAquasenseTopicValue('aquasense/device-id','raw-only-topic-test');
  (service as any).handleAquasenseTopicValue('aquasense/temperature','25');
  (service as any).handleAquasenseTopicValue('aquasense/ph','7.5');
  (service as any).handleAquasenseTopicValue('aquasense/turbidity','1800');
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(rows.length,1);
  assert.equal(rows[0].turbidity,1800);
  assert.equal(rows[0].turbidityUnit,'raw_adc');
});
test('latest read ages sensors and speciation without new packets; history retains acquisition diagnostics',async()=>{
  const rows=storage();const now=Date.now();
  const r=await sensorReadingService.ingest('freshness-test',{temperature:25,ph:8,orp:220,turbidity:1800,turbidityUnit:'raw_adc'});
  assert.equal(r.speciation.status,'UNAVAILABLE');assert.match(r.speciation.reason,/Calibrated/);
  mock.method(Date,'now',()=>now+20000);
  const latest=await sensorReadingService.getLatestReading();assert.equal(latest!.sensorHealth.ph.health,'STALE');assert.equal(latest!.ph,null);assert.equal(latest!.speciation.status,'UNAVAILABLE');
  assert.equal(rows[0].sensorHealth.ph.health,'VALID');assert.equal((await sensorReadingService.getReadingsByTimeRange())[0].ph,8);
});
test('measured TAN persists with explicit NH3-N units and rejects old ammonia input',async()=>{
  storage();const r=await sensorReadingService.ingest('tan-test',{temperature:25,ph:8,tan:{value:1,unit:'mg/L as N',source:'manual',validated:true,timestamp:new Date().toISOString()},ammonia:999});
  assert.equal(r.ammonia,null);assert.equal(r.speciation.tan?.value,1);assert.equal(r.speciation.nh3N,null);
  assert.equal(r.speciation.status,'UNAVAILABLE');assert.equal(r.speciation.concentrationUnit,'mg/L as N');
});
test('current failure prevents fallback to older healthy prediction history',async()=>{
  storage();const firstAcquiredAt=Date.now()-2;
  await sensorReadingService.ingest('prediction-test',{temperature:25,ph:7.5,do:6,turbidity:20,turbidityUnit:'NTU',acquiredAt:new Date(firstAcquiredAt).toISOString()});
  await sensorReadingService.ingest('prediction-test',{temperature:-127,ph:7.5,do:6,turbidity:20,turbidityUnit:'NTU',acquiredAt:new Date(firstAcquiredAt+1).toISOString()});
  const prediction=await predictiveAnalyticsService.getWarningCard();assert.equal(prediction.modelStatus,'UNAVAILABLE');assert.equal(prediction.validationStatus,'NOT_COMMISSIONED');assert.equal(prediction.analysisStatus,'INSUFFICIENT_VALID_SENSOR_DATA');assert.equal(prediction.riskScore,null);
});
test('uncalibrated measured parameters cannot produce a mortality forecast',async()=>{
  storage();await sensorReadingService.ingest('prediction-valid',{temperature:25,ph:7.5,do:6,turbidity:20,turbidityUnit:'NTU'});
  const prediction=await predictiveAnalyticsService.getWarningCard();assert.equal(prediction.analysisStatus,'INSUFFICIENT_VALID_SENSOR_DATA');assert.equal(prediction.riskScore,null);assert.equal(prediction.calibration,'REQUIRED');
});
test('raw turbidity and absent DO block the existing mortality model',async()=>{
  storage();await sensorReadingService.ingest('raw-risk-test',{temperature:25,ph:8,turbidity:1800,turbidityUnit:'raw_adc'});
  const prediction=await predictiveAnalyticsService.getWarningCard();assert.equal(prediction.riskScore,null);assert.equal(prediction.latest,null);
});
test('unsafe pH has VALID health and CRITICAL water quality independently',async()=>{
  storage(); const r=await sensorReadingService.ingest('unsafe-health',{temperature:25,ph:9.5,turbidity:1800,turbidityUnit:'raw_adc'});
  assert.equal(r.sensorHealth.ph.health,'VALID');assert.equal(r.sensorHealth.ph.calibration,'REQUIRED');assert.equal(r.waterQuality.ph,'CRITICAL');assert.equal(r.status,'critical');
});
test('per-sensor acquisition age blocks a stale dependency even inside a fresh frame',async()=>{
  storage(); const r=await sensorReadingService.ingest('sensor-age',{temperature:25,ph:8,sensors:{ph:{sampleAgeMs:20000}}});
  assert.equal(r.sensorHealth.temperature.health,'VALID');assert.equal(r.sensorHealth.ph.health,'STALE');assert.equal(r.speciation.status,'UNAVAILABLE');
});
test('replayed acquisition cannot refresh age or train the stability window',async()=>{
  const rows=storage(), now=Date.now(), payload={temperature:25,ph:8,bootId:'boot-1',sequence:1,acquiredAt:new Date(now).toISOString(),sensors:{ph:{sampleAgeMs:0}}};
  const first=await sensorReadingService.ingest('replay-test',payload);
  const replay=await sensorReadingService.ingest('replay-test',payload);
  assert.equal(replay.id,first.id);assert.equal(rows.length,1);
});
test('duplicate MQTT frames do not repeat realtime or alert processing',async()=>{
  const rows=storage();
  const notify=mock.method(waterAlertNotificationService,'processReading',async()=>({alertsCreated:0,smsSentCount:0}));
  const service=new MQTTService();let readings=0,stats=0;
  service.setRealtimeHandlers({onReadingReceived:()=>readings++,onStatsUpdated:()=>stats++});
  const payload=JSON.stringify({deviceId:'mqtt-replay-test',temperature:25,ph:8,bootId:'mqtt-boot',sequence:4,acquiredAt:new Date().toISOString()});
  assert.equal(await (service as any).handleSensorReading(payload),true);
  assert.equal(await (service as any).handleSensorReading(payload),false);
  assert.equal(rows.length,1);assert.equal(readings,1);assert.equal(stats,1);assert.equal(notify.mock.callCount(),1);
});
test('new frame after restart is ordered against persisted device history',async()=>{
  const rows=storage(), now=Date.now();
  const first={temperature:25,ph:8,bootId:'boot-durable',sequence:10,acquiredAt:new Date(now).toISOString()};
  await sensorReadingService.ingest('durable-order-test',first);
  // A process restart clears the in-memory validator window; persisted ordering must still reject this frame.
  (sensorReadingService as any).validator=new SensorValidator();
  mock.method(Date,'now',()=>now+3000);
  await assert.rejects(sensorReadingService.ingest('durable-order-test',{...first,sequence:9,acquiredAt:new Date(now+1000).toISOString()}),/Obsolete sensor frame/);
  assert.equal(rows.length,1);
});
test('raw burst diagnostics survive production storage',async()=>{
  storage(); const r=await sensorReadingService.ingest('burst-storage',{ph:8,sensors:{ph:{rawAdc:3000,voltage:2.4,adcMinimum:2999,adcMaximum:3001,adcLast:3000,clippedSamples:0}}});
  assert.equal(r.sensorHealth.ph.adcMinimum,2999);assert.equal(r.sensorHealth.ph.adcMaximum,3001);assert.equal(r.sensorHealth.ph.adcLast,3000);
});
test('ingestion uses the same timestamp normalization rules for ISO and millisecond epochs',async()=>{
  const rows=storage(), now=Date.now();
  const iso=await sensorReadingService.ingest('timestamp-iso',{temperature:25,acquiredAt:new Date(now).toISOString()});
  assert.equal(rows.length,1);assert.equal(iso.timestamp.getTime(),now);
  const next=now+1;
  const numeric=await sensorReadingService.ingest('timestamp-ms',{temperature:25,acquiredAt:next});
  assert.equal(numeric.timestamp.getTime(),next);assert.equal(timestampMs(next),next);
  for(const acquiredAt of [now/1000,Number.NaN,Number.POSITIVE_INFINITY,-1,'1726286400','not-a-timestamp',now-16000,now+3000]) {
    await assert.rejects(sensorReadingService.ingest(`timestamp-invalid-${String(acquiredAt)}`,{temperature:25,acquiredAt}),/Invalid, future, or stale acquisition timestamp/);
  }
  assert.equal(rows.length,2);
});
test('turbidity statistics never combine raw ADC and NTU values',async()=>{
  const rows=storage(), now=Date.now();
  await sensorReadingService.ingest('mixed-unit-history',{turbidity:1800,turbidityUnit:'raw_adc',acquiredAt:new Date(now).toISOString()});
  await sensorReadingService.ingest('mixed-unit-history',{turbidity:12,turbidityUnit:'NTU',acquiredAt:new Date(now+1).toISOString()});
  const stats=await sensorReadingService.getStatistics();
  assert.equal(rows.length,2);assert.deepEqual(stats.turbidity,{parameter:'turbidity',current:12,average:12,min:12,max:12});
});
