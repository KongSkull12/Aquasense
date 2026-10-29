const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
// Compile the actual components for server rendering; no duplicate display implementation.
for(const extension of ['.ts','.tsx']) require.extensions[extension]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2020}}).outputText,file);
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {SensorHealthPanel,AmmoniaSpeciationCard}=require('../src/components/WaterQuality/SensorHealthPanel.tsx');
const {refreshDisplayReading,currentWaterSensorValue,isReadingLive}=require('../src/components/WaterQuality/sensorDisplay.ts');
const render=(Component,value)=>renderToStaticMarkup(React.createElement(Component,Component===AmmoniaSpeciationCard?{measurement:value}:{reading:value}));
const tanRecord=(overrides={})=>({id:'tan-1',deviceId:'tank-1',enteredByUserId:'user-1',value:1,unit:'mg/L as N',source:'test_kit',sampleCollectedAt:'2026-10-01T02:00:00.000Z',enteredAt:'2026-10-01T02:05:00.000Z',validationEvidence:'Kit lot 42, expiry 2027-04',validationStatus:'USER_ATTESTED',speciationStatus:'AVAILABLE',speciationReason:'Calculated from measured TAN and aligned pH and temperature',nh3Fraction:0.053842,nh3N:0.053842,environmentalReadingId:'water-1',...overrides});
test('missing sensors visibly show missing and calibration required',()=>{
 const html=render(SensorHealthPanel,null); assert.match(html,/Missing/);assert.match(html,/Calibration is required/);assert.match(html,/ORP/);assert.doesNotMatch(html,/ACCURATE/);
});
test('missing TAN keeps both TAN and NH3-N unavailable',()=>{
 const html=render(AmmoniaSpeciationCard,null);
 assert.match(html,/Unavailable/);assert.match(html,/TAN: not available/);assert.match(html,/NH₃-N: not calculated/);assert.match(html,/TAN measurement/);assert.doesNotMatch(html,/Safe|Critical|0\.05 mg/);
});
test('measured TAN displays NH3 fraction, NH3-N and provenance',()=>{
 const html=render(AmmoniaSpeciationCard,tanRecord());
 assert.match(html,/5\.38%/);assert.match(html,/TAN: 1 mg\/L as N/);assert.match(html,/0\.05384 mg\/L as N/);assert.match(html,/user attested/);assert.match(html,/Kit lot 42/);
});
test('stale speciation renders unavailable',()=>{
 const html=render(AmmoniaSpeciationCard,tanRecord({speciationStatus:'UNAVAILABLE',speciationReason:'Valid fresh pH and temperature required',nh3Fraction:null,nh3N:null}));
 assert.match(html,/Unavailable/);assert.match(html,/Valid fresh/);assert.match(html,/TAN: 1 mg\/L as N/);assert.match(html,/NH₃-N: not calculated/);
});
test('invalid diagnostic value is not displayed as a measurement',()=>{
 const html=render(SensorHealthPanel,{sensorHealth:{temperature:{valid:false,value:-127,health:'SENSOR_ERROR',stability:'COLLECTING',reason:'DS18B20 disconnected',window:{}}}});
 assert.match(html,/Sensor error/);assert.match(html,/DS18B20 disconnected/);assert.doesNotMatch(html,/-127/);
});
test('reported uncalibrated ORP stays clearly diagnostic while health remains missing',()=>{
 const health={valid:false,value:494.7,unit:'mV',health:'MISSING',calibration:'REQUIRED',stability:'COLLECTING',reason:'ORP engineering conversion/calibration is not commissioned by the backend',window:{}};
 const html=render(SensorHealthPanel,{orp:494.7,sensorHealth:{orp:health}});
 assert.match(html,/ORP<\/h3><span[^>]*>—<\/span>.*Missing/);assert.match(html,/Device-reported diagnostic: 494\.70 mV/);assert.match(html,/Uncalibrated, not a validated measurement/);
});
test('parameter current sensor values follow the same latest reading, not stale statistics',()=>{
 const reading={temperature:25,ph:7.5,orp:494.7,turbidity:346};
 assert.equal(currentWaterSensorValue(reading,'turbidity'),346);
 assert.equal(currentWaterSensorValue(reading,'orp'),494.7);
 assert.equal(currentWaterSensorValue(null,'turbidity'),null);
});
test('source freshness expires even while the enclosing frame is fresh',()=>{
 const now=Date.now(), timestamp=new Date(now).toISOString();
 const sensors=Object.fromEntries(['temperature','ph','turbidity','orp'].map(name=>[name,{name,timestamp: name==='ph'?new Date(now-16000).toISOString():timestamp,valid:true,health:'VALID'}]));
 const original={timestamp,ph:8,sensorHealth:sensors,speciation:{percent:5.38,nh3N:null}};
 const result=refreshDisplayReading(original,now);
 assert.equal(result.ph,null);assert.equal(result.sensorHealth.ph.health,'STALE');assert.equal(result.speciation.percent,null);
 assert.equal(original.ph,8);assert.equal(original.sensorHealth.ph.health,'VALID');
});
test('a silent device shows no live values, tank level or raw diagnostics',()=>{
 const now=Date.now(), old=new Date(now-20000).toISOString();
 const sensor=(name,value)=>({name,value,rawAdc:2100,voltage:1.69,adcMinimum:2088,adcMaximum:2112,adcLast:2100,clippedSamples:0,timestamp:old,valid:true,health:'VALID',window:{count:24,min:1,max:2,average:1.5,range:1,standardDeviation:0.1}});
 const original={timestamp:old,temperature:26.5,ph:7.4,turbidity:18.5,orp:null,sensorHealth:{temperature:sensor('temperature',26.5),ph:sensor('ph',7.4),turbidity:sensor('turbidity',18.5),orp:sensor('orp',null),ultrasonic:{connected:true,valid:true,distanceCm:12,levelPercent:80,timestamp:old,reason:''}},tankLevel:{connected:true,valid:true,distanceCm:12,levelPercent:80,timestamp:old,reason:''}};
 assert.equal(isReadingLive(original,now),false);
 const result=refreshDisplayReading(original,now);
 for(const name of ['temperature','ph','turbidity']) { assert.equal(result[name],null); assert.equal(result.sensorHealth[name].value,null); assert.equal(result.sensorHealth[name].rawAdc,null); assert.equal(result.sensorHealth[name].window.count,0); }
 assert.equal(result.tankLevel.levelPercent,null);assert.equal(result.tankLevel.valid,false);assert.equal(result.sensorHealth.ultrasonic.levelPercent,null);
 const html=render(SensorHealthPanel,result);
 assert.doesNotMatch(html,/26\.50|7\.40|18\.50|2100/);
});
test('a fresh frame counts as live',()=>{
 const now=Date.now();
 assert.equal(isReadingLive({timestamp:new Date(now-2000).toISOString()},now),true);
 assert.equal(isReadingLive(null,now),false);
 assert.equal(isReadingLive({timestamp:'not a date'},now),false);
});
