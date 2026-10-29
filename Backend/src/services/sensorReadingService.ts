import { logger } from '../utils/logger';
import { SensorReading as SensorReadingModel } from '../database/models/SensorReading';
import { Op } from 'sequelize';
import { getDatabase } from '../database/connection';
import {ruleEngine} from './ruleEngine.service';
import { SensorValidator, SENSOR_NAMES, numeric, timestampMs, refreshHealth, ammoniaSpeciation, type HealthSummary, type ExtendedHealthSummary, type AmmoniaSpeciation, type UltrasonicReading, HEALTH_CONFIG } from './sensorHealth';
export interface SensorReading {
  id: string; deviceId: string; temperature: number|null; ph: number|null; do: number|null;
  doMeasured: boolean; turbidity: number|null; orp: number|null; ammonia: number|null;
  turbidityUnit: string; sensorHealth: HealthSummary; speciation: AmmoniaSpeciation;
  tankLevel: UltrasonicReading | null;
  waterQuality: Record<string,string>; status: 'normal'|'warning'|'critical'|'unavailable';
  location: string; timestamp: Date; createdAt: Date; updatedAt: Date;
}
export interface SensorStatistics { parameter: string; current: number|null; average: number|null; min: number|null; max: number|null }
class SensorReadingService {
  private validator = new SensorValidator();
  private transitions = new Map<string,string>();
  private logTransitions(device: string, health: HealthSummary) {
    for (const name of SENSOR_NAMES) { const key=`${device}:${name}`, next=health[name].health, prev=this.transitions.get(key);
      if (prev!==next) { logger.info('Sensor health transition',{deviceId:device,sensor:name,from:prev||'MISSING',to:next}); this.transitions.set(key,next); }
    }
    if (this.transitions.size>2048) this.transitions.clear();
  }
  async ingest(deviceId: string, payload: Record<string,any>): Promise<SensorReading> {
    const result = await this.ingestWithStatus(deviceId, payload);
    return result.reading;
  }
  async ingestWithStatus(deviceId: string, payload: Record<string,any>): Promise<{reading:SensorReading; inserted:boolean}> {
    const now=Date.now();
    const age=payload.sampleAgeMs===undefined?0:numeric(payload.sampleAgeMs);
    if (age===null || age<0 || age>86_400_000) throw new Error('Invalid sampleAgeMs');
    const timestampInput=payload.acquiredAt ?? payload.timestamp;
    const acquired = timestampInput === undefined ? now-age : timestampMs(timestampInput);
    if (!Number.isFinite(acquired) || acquired < Date.UTC(2000,0,1) || acquired > now+2000 || now-acquired>HEALTH_CONFIG.staleMs) throw new Error('Invalid, future, or stale acquisition timestamp');
    const timestamp = new Date(acquired);
    const bootId=typeof payload.bootId==='string' && payload.bootId.length<=64 ? payload.bootId : null;
    const sequenceId=bootId!==null && Number.isSafeInteger(payload.sequence) && payload.sequence>=0 ? payload.sequence : null;
    const unit=payload.turbidityUnit === 'raw_adc' ? 'raw_adc' : payload.turbidityUnit === 'NTU' ? 'NTU' : 'unknown';
    const result=await getDatabase().transaction(async transaction=>{
      await getDatabase().query('SELECT pg_advisory_xact_lock(hashtext(:deviceId))',{replacements:{deviceId},transaction});
      if (bootId!==null && sequenceId!==null) {
        const duplicate=await SensorReadingModel.findOne({where:{deviceId,bootId,sequenceId},transaction});
        if (duplicate) return {model:duplicate,sensorHealth:null as HealthSummary|null,inserted:false};
      }
      const latest=await SensorReadingModel.findOne({where:{deviceId},order:[['timestamp','DESC']],transaction});
      if (latest && ((bootId!==null && latest.bootId===bootId && sequenceId!==null && latest.sequenceId!==null && sequenceId<=Number(latest.sequenceId)) || acquired <= new Date(latest.timestamp).getTime())) throw new Error('Obsolete sensor frame');
      const validationNow=Date.now();
      const sensorHealth=Object.fromEntries(SENSOR_NAMES.map(name=>[name,this.validator.validate(deviceId,name,
        payload[name], payload.sensorTimestamps?.[name] ?? this.sensorTimestamp(payload.sensors?.[name],validationNow,timestamp),payload.sensors?.[name],validationNow,name==='turbidity'?unit:undefined)])) as unknown as ExtendedHealthSummary;
      const ultrasonic = this.readUltrasonic(payload, validationNow);
      if (ultrasonic) sensorHealth.ultrasonic = ultrasonic;
      const speciation=ammoniaSpeciation(sensorHealth,payload.tan,payload.waterType ?? 'freshwater',validationNow);
      const values=Object.fromEntries(SENSOR_NAMES.map(name=>[name,sensorHealth[name].valid ? sensorHealth[name].value : null]));
      const model=await SensorReadingModel.create({...values,deviceId,do:null,doMeasured:false,bootId,sequenceId,
        ammonia:speciation.nh3N,turbidityUnit:unit,sensorHealth,speciation,
        location:typeof payload.location==='string'?payload.location.slice(0,255):deviceId,timestamp},{transaction});
      return {model,sensorHealth,inserted:true};
    });
    if (result.inserted && result.sensorHealth) this.logTransitions(deviceId,result.sensorHealth);
    return {reading:this.mapSensorModel(result.model),inserted:result.inserted};
  }
  private sensorTimestamp(diagnostic:any,now:number,fallback:Date|string):Date|string {
    if(diagnostic?.sampleAgeMs===undefined) return fallback;
    const age=numeric(diagnostic.sampleAgeMs);
    return age!==null && age>=0 ? new Date(now-age) : 'invalid';
  }
  private readUltrasonic(payload:Record<string,any>,now:number):UltrasonicReading|null {
    const metadata=payload.sensors?.ultrasonic;
    if(!metadata || typeof metadata!=='object' || Array.isArray(metadata)) return null;
    const timestamp=typeof payload.sensorTimestamps?.ultrasonic==='string'?payload.sensorTimestamps.ultrasonic:null;
    const at=timestampMs(timestamp);
    const fresh=Number.isFinite(at) && at<=now+2000 && now-at<=HEALTH_CONFIG.staleMs;
    const connected=metadata.connected===true;
    const distance=numeric(payload.tankDistanceCm);
    const level=numeric(payload.tankLevelPercent);
    const distanceReported=distance!==null && distance>0 && distance<=800;
    const levelReported=level!==null && level>=0 && level<=100;
    const valid=connected && metadata.valid===true && fresh && distance!==null && distance>=20 && distance<=800 &&
      level!==null && level>=0 && level<=100;
    return {connected,valid,distanceCm:distanceReported?distance:null,levelPercent:levelReported?level:null,timestamp,
      reason:valid?'Reported measurement; tank dimensions and sensor calibration should be confirmed':
        !connected?'No valid ultrasonic echo':!fresh?'Ultrasonic reading is stale':'Ultrasonic measurement is invalid'};
  }
  async addSensorReading(deviceId:string,temperature:unknown,ph:unknown,do_value:unknown,turbidity:unknown,
    _ammonia:unknown=null,location='Default Location',timestamp=new Date(),doMeasured=true,orp:unknown=null) {
    void do_value; void doMeasured;
    return this.ingest(deviceId,{temperature,ph,turbidity,location,timestamp:timestamp.toISOString(),orp});
  }
  async getLatestReading(deviceIds?: string[]): Promise<SensorReading|null> {
    if (deviceIds && deviceIds.length === 0) return null;
    const reading=await SensorReadingModel.findOne({where:deviceIds?{deviceId:{[Op.in]:deviceIds}}:undefined,order:[['createdAt','DESC']]});
    return reading?this.mapSensorModel(reading,true):null;
  }
  async getReadingsByTimeRange(minutes=60, deviceIds?: string[]): Promise<SensorReading[]> {
    if (deviceIds && deviceIds.length === 0) return [];
    const readings=await SensorReadingModel.findAll({where:{...(deviceIds?{deviceId:{[Op.in]:deviceIds}}:{}),timestamp:{[Op.gte]:new Date(Date.now()-minutes*60000)}},order:[['timestamp','DESC']]});
    return readings.map(r=>this.mapSensorModel(r));
  }
  async getStatistics(minutes=60, deviceIds?: string[]) {
    const readings=await this.getReadingsByTimeRange(minutes,deviceIds), latest=await this.getLatestReading(deviceIds);
    const stats=(name:'temperature'|'ph'|'do'|'turbidity'|'orp'|'ammonia'):SensorStatistics=>{
      const values=readings.filter(r=>(!latest || r.deviceId===latest.deviceId) && (name!=='turbidity' || r.turbidityUnit===latest?.turbidityUnit)).map(r=>r[name]).filter((v):v is number=>v!==null&&Number.isFinite(v));
      return {parameter:name,current:latest?.[name]??null,average:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,
        min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null};
    };
    // Risk is produced by the versioned analytics service, never a second score here.
    return {temperature:stats('temperature'),ph:stats('ph'),do:stats('do'),turbidity:stats('turbidity'),orp:stats('orp'),ammonia:stats('ammonia'),healthScore:null};
  }
  async getAllReadings(location?:string,limit=100) {
    return (await SensorReadingModel.findAll({where:location?{location}:{},order:[['timestamp','DESC']],limit})).map(r=>this.mapSensorModel(r));
  }
  async deleteOldReadings(minutes=10080) { return SensorReadingModel.destroy({where:{timestamp:{[Op.lt]:new Date(Date.now()-minutes*60000)}}}); }
  private mapSensorModel(reading:SensorReadingModel,current=false):SensorReading {
    const validator=new SensorValidator();
    const at=new Date(reading.timestamp).getTime();
    const original=(reading.sensorHealth || Object.fromEntries(SENSOR_NAMES.map(name=>[name,validator.validate(reading.deviceId,name,reading[name],reading.timestamp,{},at)]))) as ExtendedHealthSummary;
    const sensorHealth=current?refreshHealth(original):original;
    if (current) this.logTransitions(reading.deviceId,sensorHealth);
    const speciation=ammoniaSpeciation(sensorHealth,reading.speciation?.tan,reading.speciation?.waterType??'freshwater',current?Date.now():at);
    const alerts=ruleEngine({temperature:sensorHealth.temperature.valid?sensorHealth.temperature.value:null,ph:sensorHealth.ph.valid?sensorHealth.ph.value:null,
      turbidity:sensorHealth.turbidity.valid?sensorHealth.turbidity.value:null,turbidityUnit:reading.turbidityUnit,
      dissolvedOxygen:null,dissolvedOxygenMeasured:false});
    const condition=(name:'temperature'|'ph'|'turbidity',prefix:string)=> {
      if(!sensorHealth[name].valid) return 'UNAVAILABLE';
      if(name==='turbidity' && reading.turbidityUnit!=='NTU') return 'UNKNOWN (RAW ADC)';
      const related=alerts.filter(a=>a.category.startsWith(prefix));
      if (related.some(a=>a.severity==='CRITICAL'||a.severity==='EMERGENCY')) return 'CRITICAL';
      if (related.length) return 'WARNING';
      return sensorHealth[name].calibration==='CALIBRATED' && sensorHealth[name].stability==='STABLE' ? 'NORMAL' : 'CALIBRATION REQUIRED';
    };
    const waterQuality={temperature:condition('temperature','TEMP'),ph:condition('ph','PH'),turbidity:condition('turbidity','TURBIDITY'),orp:'NO WATER-QUALITY POLICY'};
    const qualityStates=Object.values(waterQuality);
    const status=qualityStates.includes('CRITICAL')?'critical':qualityStates.includes('WARNING')?'warning':
      qualityStates.some(state=>state==='UNAVAILABLE' || state==='CALIBRATION REQUIRED' || state.startsWith('UNKNOWN'))?'unavailable':'normal';
    return {id:reading.id,deviceId:reading.deviceId,temperature:sensorHealth.temperature.valid?sensorHealth.temperature.value:null,
      // Preserve fresh device-reported pH and NTU values for display/diagnostics
      // when stability or commissioning checks reject them. Decision logic above
      // still uses `valid`, and the dashboard labels these reports accordingly.
      ph:sensorHealth.ph.value,
      turbidity:sensorHealth.turbidity.value,
      // Keep the device-reported ORP sample visible for diagnostics and trends;
      // sensorHealth remains the authority for whether it is calibrated/usable.
      orp:sensorHealth.orp.value,do:null,
      doMeasured:false,ammonia:speciation.nh3N,sensorHealth,speciation,waterQuality,status,turbidityUnit:reading.turbidityUnit||'unknown',
      tankLevel:sensorHealth.ultrasonic ?? null,
      location:reading.location,timestamp:reading.timestamp,createdAt:reading.createdAt,updatedAt:reading.updatedAt};
  }
}
export const sensorReadingService=new SensorReadingService();
