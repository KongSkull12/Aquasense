import type {WaterQualityReading} from '../../types/water';
export type CurrentWaterSensor='temperature'|'ph'|'orp'|'turbidity';
// How long a device frame counts as live. After this the ESP32 is treated as not sending.
export const LIVE_READING_MS=15000;
// A dashboard's current value must come from its selected latest reading, not
// from the independently refreshed statistics stream.
export function currentWaterSensorValue(reading:WaterQualityReading|null, sensor:CurrentWaterSensor):number|null {
  return reading?.[sensor] ?? null;
}
// True only while the latest device frame is recent. Pages show readings, trends
// and statistics only when this holds, so nothing appears unless the device is sending.
export function isReadingLive(reading:WaterQualityReading|null,now=Date.now(),staleMs=LIVE_READING_MS):boolean {
  if(!reading) return false;
  const acquisitionTime=new Date(reading.timestamp).getTime();
  return Number.isFinite(acquisitionTime) && now-acquisitionTime<=staleMs;
}
// Age each acquisition locally even if the backend or WebSocket stops responding.
// A stale source loses its value and its raw diagnostics, not just its status.
export function refreshDisplayReading(reading:WaterQualityReading|null,now=Date.now(),staleMs=LIVE_READING_MS):WaterQualityReading|null {
  if(!reading) return null;
  const result={...reading};
  const frameStale=!isReadingLive(reading,now,staleMs);
  if(reading.sensorHealth) {
    result.sensorHealth={...reading.sensorHealth};
    for(const name of ['temperature','ph','turbidity','orp'] as const) {
      const s=reading.sensorHealth[name];
      if(!s) continue;
      if(frameStale || (s.timestamp && now-Date.parse(s.timestamp)>staleMs)) {
        result.sensorHealth[name]={...s,health:'STALE',valid:false,measurementValid:false,rawAvailable:false,readyForCalibration:false,reason:'No recent sensor reading received',
          value:null,rawAdc:null,voltage:null,adcMinimum:null,adcMaximum:null,adcLast:null,clippedSamples:null,
          window:{count:0,min:null,max:null,average:null,range:null,standardDeviation:null}};
        result[name]=null;
        result.waterQuality={...result.waterQuality,[name]:'UNAVAILABLE'};
      }
    }
    const ultrasonic=reading.sensorHealth.ultrasonic;
    if(ultrasonic && (frameStale || (ultrasonic.timestamp && now-Date.parse(ultrasonic.timestamp)>staleMs))) {
      result.sensorHealth.ultrasonic={...ultrasonic,valid:false,distanceCm:null,levelPercent:null,reason:'No recent sensor reading received'};
    }
  } else if(frameStale) result.temperature=result.ph=result.turbidity=result.orp=null;
  if(result.tankLevel && (frameStale || (result.tankLevel.timestamp && now-Date.parse(result.tankLevel.timestamp)>staleMs))) {
    result.tankLevel={...result.tankLevel,valid:false,distanceCm:null,levelPercent:null,reason:'No recent sensor reading received'};
  }
  if(frameStale) { result.do=null;result.doMeasured=false; }
  if(result.speciation && (frameStale || !result.sensorHealth?.ph.valid || !result.sensorHealth?.temperature.valid)) {
    result.ammonia=null;
    result.speciation={...result.speciation,status:'UNAVAILABLE',percent:null,fraction:null,pKa:null,nh3N:null,reason:'Valid fresh pH and temperature required'};
  }
  return result;
}
