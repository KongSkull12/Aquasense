import test from 'node:test';
import assert from 'node:assert/strict';
import {SensorValidator, SENSOR_NAMES, ammoniaSpeciation, numeric, timestampMs, type HealthSummary, type SensorName} from './sensorHealth';
import {ruleEngine} from './ruleEngine.service';
const now=Date.parse('2026-09-14T04:00:00Z');
const stamp=(at=now)=>new Date(at).toISOString();
const validate=(name:SensorName,value:unknown,at=now)=>new SensorValidator().validate('test',name,value,stamp(at),{},now);
const summary=(temperature:unknown=25,ph:unknown=8,at=now):HealthSummary=>Object.fromEntries(SENSOR_NAMES.map(name=>[name,validate(name,name==='temperature'?temperature:name==='ph'?ph:100,at)])) as HealthSummary;
const calibratedSummary=(temperature:unknown=25,ph:unknown=8):HealthSummary=>{
  const sources=summary(temperature,ph);
  for(const name of ['temperature','ph'] as const) if(sources[name].valid) {
    sources[name]={...sources[name],stability:'STABLE',calibration:'CALIBRATED'};
  }
  return sources;
};
function check(name:string,input:unknown,expected:unknown,actual:()=>unknown) {
  test(name,()=> { const result=actual(); console.log(`Test: ${name}\nInput: ${JSON.stringify(input)}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(result)}\n${JSON.stringify(result)===JSON.stringify(expected)?'PASS':'FAIL'}`); assert.deepEqual(result,expected); });
}
check('normal temperature',25,'VALID',()=>validate('temperature',25).health);
check('DS18B20 error',-127,'SENSOR_ERROR',()=>validate('temperature',-127).health);
check('temperature outside capability',126,'INVALID',()=>validate('temperature',126).health);
check('normal pH',7,'VALID',()=>validate('ph',7).health);
check('valid unsafe pH',9.5,'VALID',()=>validate('ph',9.5).health);
check('unsafe pH retains water warning',9.5,true,()=>ruleEngine({temperature:25,ph:9.5,dissolvedOxygen:null,turbidity:null}).some(a=>a.category==='PH_HIGH'));
check('impossible pH',15,'INVALID',()=>validate('ph',15).health);
check('null reading',null,'MISSING',()=>validate('ph',null).health);
check('missing reading','undefined','MISSING',()=>validate('ph',undefined).health);
check('NaN reading','NaN','INVALID',()=>validate('ph',NaN).health);
check('infinity reading','Infinity','INVALID',()=>validate('ph',Infinity).health);
check('malformed reading','7bad','INVALID',()=>validate('ph','7bad').health);
check('strict numeric conversion',['',true,'7junk',' 7.2 '],[null,null,null,7.2],()=>['',true,'7junk',' 7.2 '].map(numeric));
check('stale timestamp','16 seconds old','STALE',()=>validate('ph',7,now-16000).health);
check('future timestamp','3 seconds ahead','INVALID',()=>validate('ph',7,now+3000).health);
check('single ADC rail sample remains available for inspection',4095,'VALID',()=>new SensorValidator().validate('test','turbidity',4095,stamp(),{rawAdc:4095},now,'raw_adc').health);
test('raw ADC signal is distinct from an unavailable engineering measurement',()=>{
  const signal=new SensorValidator().validate('raw-only','turbidity',null,stamp(),{rawAdc:1800},now,'raw_adc');
  assert.equal(signal.rawAvailable,true);assert.equal(signal.measurementValid,false);assert.equal(signal.valid,false);
  assert.equal(signal.health,'MISSING');assert.equal(signal.value,null);assert.equal(signal.rawAdc,1800);assert.equal(signal.communication,true);
});
test('device diagnostics cannot commission ORP conversion or calibration',()=>{
  const unverified=new SensorValidator().validate('orp-unverified','orp',220,stamp(),{rawAdc:2000},now,'mV');
  assert.equal(unverified.valid,false);assert.equal(unverified.measurementValid,false);assert.equal(unverified.health,'MISSING');
  const deviceClaim=new SensorValidator().validate('orp-device-claim','orp',-220,stamp(),{rawAdc:2000,conversion:'VALIDATED',calibrationState:'CALIBRATED'},now,'mV');
  assert.equal(deviceClaim.valid,false);assert.equal(deviceClaim.measurementValid,false);assert.equal(deviceClaim.calibration,'REQUIRED');
  assert.equal(deviceClaim.value,-220);assert.equal(deviceClaim.unit,'mV');
});
check('repeated ADC saturation',[4095,4095,4095],'SATURATED',()=>{const v=new SensorValidator();let r; for(let i=0;i<3;i++) r=v.validate('test','turbidity',4095,stamp(now+i*5000),{rawAdc:4095},now+i*5000,'raw_adc');return r!.health;});
check('duplicate acquisition does not count as repeated rail evidence',4095,'VALID',()=>{const v=new SensorValidator();let r;for(let i=0;i<5;i++) r=v.validate('test','turbidity',4095,stamp(),{rawAdc:4095},now,'raw_adc'); return r!.health;});
check('clipping hidden by averaging','mean 2047 but 10/10 rail hits','SATURATED',()=>{const v=new SensorValidator();let r;for(let i=0;i<3;i++)r=v.validate('burst','turbidity',2047,stamp(now+i*5000),{rawAdc:2047,clippedSamples:10},now+i*5000,'raw_adc');return r!.health;});
check('stable window','20 samples 7.10/7.11','STABLE',()=>{const v=new SensorValidator();let r;for(let i=0;i<20;i++)r=v.validate('test','ph',7.1+i%2*0.01,stamp(now+i*5000),{rawAdc:3000+i%2},now+i*5000);return r!.stability;});
check('noisy window','7/9 alternating','UNSTABLE',()=>{const v=new SensorValidator();let r;for(let i=0;i<20;i++)r=v.validate('test','ph',7+i%2*2,stamp(now+i*5000),{},now+i*5000);return r!.health;});
check('conservative stuck detection','10 minutes unchanged','POSSIBLY_STUCK',()=>{const v=new SensorValidator();let r;for(let i=0;i<=120;i++)r=v.validate('test','ph',7,stamp(now+i*5000),{rawAdc:3000},now+i*5000);return r!.health;});
check('invalid sensor cannot trigger water alert',-127,0,()=>ruleEngine({temperature:-127,ph:null,turbidity:null,dissolvedOxygen:null}).length);
check('raw ADC cannot trigger NTU alert',3000,0,()=>ruleEngine({temperature:25,ph:7,turbidity:3000,turbidityUnit:'raw_adc',dissolvedOxygen:null}).length);
check('invalid pH blocks ammonia',15,'UNAVAILABLE',()=>ammoniaSpeciation(summary(25,15),undefined,'freshwater',now).status);
check('invalid temperature blocks ammonia',-127,'UNAVAILABLE',()=>ammoniaSpeciation(summary(-127),undefined,'freshwater',now).status);
check('stale source blocks ammonia','16 seconds','UNAVAILABLE',()=>ammoniaSpeciation(summary(25,8,now-16000),undefined,'freshwater',now).status);
check('missing source blocks ammonia',null,'UNAVAILABLE',()=>ammoniaSpeciation(summary(25,null),undefined,'freshwater',now).status);
check('fraction available without TAN',{temperature:25,ph:8},'AVAILABLE',()=>ammoniaSpeciation(calibratedSummary(),undefined,'freshwater',now).status);
check('concentration unavailable without TAN',undefined,null,()=>ammoniaSpeciation(calibratedSummary(),undefined,'freshwater',now).nh3N);
check('salinity is not silently ignored','saline','UNAVAILABLE',()=>ammoniaSpeciation(calibratedSummary(),undefined,'saline',now).status);
const tan={value:1,unit:'mg/L as N',source:'test_kit',validated:true,timestamp:stamp()};
check('valid TAN retained while source sensor fails','TAN 1; temperature -127',[1,null],()=>{const s=ammoniaSpeciation(summary(-127),tan,'freshwater',now);return [s.tan?.value,s.nh3N];});
test('reference equation and measured TAN concentration',()=>{
  const s=ammoniaSpeciation(calibratedSummary(),tan,'freshwater',now);
  console.log(`Test: Emerson reference\nInput: 25 C, pH 8, TAN 1 mg/L as N\nExpected: pKa ~9.2448; fraction ~0.05384; NH3-N ~0.05384 mg/L as N\nActual: ${JSON.stringify(s)}\nPASS`);
  assert.ok(Math.abs(s.pKa!-9.2448)<0.001);assert.ok(Math.abs(s.fraction!-0.05384)<0.0001);
  assert.ok(Math.abs(s.percent!-5.384)<0.01);assert.equal(s.nh3N,s.fraction);assert.equal(s.concentrationUnit,'mg/L as N');
});
test('NH3-N requires TAN, pH and temperature acquisition times to align',()=>{
  const staleTan={...tan,timestamp:stamp(now-16000)};
  const s=ammoniaSpeciation(calibratedSummary(),staleTan,'freshwater',now);
  assert.equal(s.status,'AVAILABLE');
  assert.equal(s.tan?.value,1);
  assert.equal(s.nh3N,null);
  assert.match(s.concentrationReason,/within 15 seconds/);
  const boundaryTan={...tan,timestamp:stamp(now-15000)};
  const aligned=ammoniaSpeciation(calibratedSummary(),boundaryTan,'freshwater',now);
  assert.ok(aligned.nh3N!==null);
  const pairwiseHealth=calibratedSummary();
  pairwiseHealth.temperature={...pairwiseHealth.temperature,timestamp:stamp(now-30000)};
  pairwiseHealth.ph={...pairwiseHealth.ph,timestamp:stamp(now)};
  const betweenSensorTimes={...tan,timestamp:stamp(now-15000)};
  const unaligned=ammoniaSpeciation(pairwiseHealth,betweenSensorTimes,'freshwater',now);
  assert.equal(unaligned.tan?.value,1);
  assert.equal(unaligned.nh3N,null);
});
check('wrong TAN units rejected','mg/L NH3',null,()=>ammoniaSpeciation(calibratedSummary(),{...tan,unit:'mg/L NH3'},'freshwater',now).nh3N);
check('unvalidated TAN rejected',false,null,()=>ammoniaSpeciation(calibratedSummary(),{...tan,validated:false},'freshwater',now).nh3N);
check('stale TAN rejected','over one hour old',null,()=>ammoniaSpeciation(calibratedSummary(),{...tan,timestamp:stamp(now-3600001)},'freshwater',now).nh3N);
check('zero TAN is legitimate',0,0,()=>ammoniaSpeciation(calibratedSummary(),{...tan,value:0},'freshwater',now).nh3N);
check('pH trend','pH 8 to 9',true,()=>ammoniaSpeciation(calibratedSummary(25,9),undefined,'freshwater',now).fraction!>ammoniaSpeciation(calibratedSummary(),undefined,'freshwater',now).fraction!);
check('temperature trend','25 to 30 C',true,()=>ammoniaSpeciation(calibratedSummary(30),undefined,'freshwater',now).fraction!>ammoniaSpeciation(calibratedSummary(),undefined,'freshwater',now).fraction!);
check('unstable pH makes speciation unavailable','UNSTABLE','UNAVAILABLE',()=>{const h=calibratedSummary();h.ph={...h.ph,health:'UNSTABLE',valid:false,stability:'UNSTABLE'};return ammoniaSpeciation(h,tan,'freshwater',now).status;});
check('unstable temperature makes speciation unavailable','UNSTABLE','UNAVAILABLE',()=>{const h=calibratedSummary();h.temperature={...h.temperature,health:'UNSTABLE',valid:false,stability:'UNSTABLE'};return ammoniaSpeciation(h,tan,'freshwater',now).status;});
check('uncalibrated pH makes speciation unavailable','REQUIRED','UNAVAILABLE',()=>{const h=calibratedSummary();h.ph={...h.ph,calibration:'REQUIRED'};return ammoniaSpeciation(h,tan,'freshwater',now).status;});

test('timestamp normalization accepts only canonical ISO and explicit millisecond epochs',()=>{
  assert.equal(timestampMs('2026-09-14T04:00:00.000Z'),now);
  assert.equal(timestampMs(now),now);
  for(const value of [now/1000,Number.NaN,Number.POSITIVE_INFINITY,-1,'1726286400','2026-02-30T04:00:00Z','not-a-timestamp']) assert.equal(Number.isNaN(timestampMs(value)),true,`expected rejection of ${String(value)}`);
});
