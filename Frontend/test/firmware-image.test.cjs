const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const ts=require('typescript');
for(const extension of ['.ts','.tsx']) require.extensions[extension]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2020}}).outputText,file);
const {inspectFirmwareImage,APP_FLASH_OFFSET}=require('../src/services/firmwareImage.ts');
const {md5Hex}=require('../src/services/md5.ts');

const writeText=(data,offset,text)=>{for(let i=0;i<text.length;i+=1) data[offset+i]=text.charCodeAt(i);};
// Minimal app image: header with chip ID, then esp_app_desc_t at 0x20.
const writeApp=(data,offset,chipId=0)=>{
 data[offset]=0xe9; data[offset+12]=chipId&0xff; data[offset+13]=chipId>>8;
 data.set([0x32,0x54,0xcd,0xab],offset+0x20);
 writeText(data,offset+0x30,'v1.2.0'); writeText(data,offset+0x50,'aquasense');
 writeText(data,offset+0x70,'14:05:09'); writeText(data,offset+0x80,'Nov  3 2026'); writeText(data,offset+0x90,'v5.4.1');
 return data;
};

test('app image is written at the app partition',()=>{
 const result=inspectFirmwareImage(writeApp(new Uint8Array(4096),0));
 assert.equal(result.ok,true);
 assert.equal(result.image.kind,'app');assert.equal(result.image.address,APP_FLASH_OFFSET);
 assert.equal(result.image.chipName,'ESP32');assert.equal(result.image.version,'v1.2.0');assert.equal(result.image.projectName,'aquasense');
 assert.equal(result.image.builtAt,'Nov 3 2026 14:05:09');assert.equal(result.image.idfVersion,'v5.4.1');
});
test('ESP32 merged image is written from address 0 and reads the bootloader chip ID',()=>{
 const data=new Uint8Array(APP_FLASH_OFFSET+4096).fill(0xff,0,0x1000);
 data[0x1000]=0xe9; writeApp(data,APP_FLASH_OFFSET);
 const result=inspectFirmwareImage(data);
 assert.equal(result.ok,true);assert.equal(result.image.kind,'merged');assert.equal(result.image.address,0);assert.equal(result.image.chipId,0);
});
test('chip ID from the header identifies other ESP32 variants',()=>{
 const result=inspectFirmwareImage(writeApp(new Uint8Array(4096),0,9));
 assert.equal(result.image.chipName,'ESP32-S3');
});
test('bootloader, partition table and random files are rejected',()=>{
 const bootloader=new Uint8Array(4096); bootloader[0]=0xe9;
 assert.match(inspectFirmwareImage(bootloader).error,/bootloader/);
 const partitions=new Uint8Array(4096); partitions[0]=0xaa; partitions[1]=0x50;
 assert.match(inspectFirmwareImage(partitions).error,/partition table/);
 assert.match(inspectFirmwareImage(new Uint8Array(4096).fill(7)).error,/not an ESP32 firmware/);
 assert.match(inspectFirmwareImage(new Uint8Array(16)).error,/too small/);
});
test('md5 matches Node crypto across padding boundaries',()=>{
 for(const length of [0,1,55,56,63,64,65,1000,70000]){
  const data=crypto.randomBytes(length);
  assert.equal(md5Hex(new Uint8Array(data)),crypto.createHash('md5').update(data).digest('hex'),`length ${length}`);
 }
});
