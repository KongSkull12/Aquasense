// Reads ESP32 firmware .bin files so the USB flasher writes them to the right
// address and refuses files that are not a firmware image.

const IMAGE_MAGIC = 0xe9;
const APP_DESC_MAGIC = 0xabcd5432;
const PARTITION_TABLE_MAGIC = 0x50aa;
// The app description sits after the 24-byte image header and the first 8-byte segment header.
const APP_DESC_OFFSET = 0x20;
const ESP32_BOOTLOADER_OFFSET = 0x1000;
export const APP_FLASH_OFFSET = 0x10000;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

// Chip IDs from the extended image header (esp_image_header_t.chip_id).
const CHIP_NAMES: Record<number, string> = {
  0: 'ESP32',
  2: 'ESP32-S2',
  5: 'ESP32-C3',
  9: 'ESP32-S3',
  12: 'ESP32-C2',
  13: 'ESP32-C6',
  16: 'ESP32-H2',
};

export type FirmwareImageKind = 'app' | 'merged';

export type FirmwareImageInfo = {
  kind: FirmwareImageKind;
  /** Flash address the whole file is written to. */
  address: number;
  size: number;
  chipId: number;
  chipName: string;
  projectName: string | null;
  version: string | null;
  builtAt: string | null;
  idfVersion: string | null;
};

export type FirmwareImageResult = { ok: true; image: FirmwareImageInfo } | { ok: false; error: string };

const readU32 = (data: Uint8Array, offset: number): number =>
  (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;

const readU16 = (data: Uint8Array, offset: number): number => data[offset] | (data[offset + 1] << 8);

const readCString = (data: Uint8Array, offset: number, length: number): string | null => {
  let text = '';
  for (let i = offset; i < offset + length && i < data.length && data[i] !== 0; i += 1) {
    text += String.fromCharCode(data[i]);
  }
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed || null;
};

const hasAppAt = (data: Uint8Array, imageOffset: number): boolean =>
  data.length > imageOffset + APP_DESC_OFFSET + 4 &&
  data[imageOffset] === IMAGE_MAGIC &&
  readU32(data, imageOffset + APP_DESC_OFFSET) === APP_DESC_MAGIC;

const chipIdAt = (data: Uint8Array, imageOffset: number): number => readU16(data, imageOffset + 12);

export const formatFlashAddress = (address: number): string => `0x${address.toString(16).padStart(5, '0')}`;

export const inspectFirmwareImage = (data: Uint8Array): FirmwareImageResult => {
  if (data.length < 0x100) return { ok: false, error: 'The file is too small to be ESP32 firmware.' };
  if (data.length > MAX_IMAGE_BYTES) return { ok: false, error: 'The file is larger than 16 MB, the most an ESP32 flash chip holds.' };
  if (readU16(data, 0) === PARTITION_TABLE_MAGIC) {
    return { ok: false, error: 'This is a partition table, not the firmware. Choose the .ino.bin or .ino.merged.bin file.' };
  }

  let kind: FirmwareImageKind;
  let appOffset: number;
  let headerOffset: number;
  if (hasAppAt(data, 0)) {
    kind = 'app';
    appOffset = 0;
    headerOffset = 0;
  } else if (hasAppAt(data, APP_FLASH_OFFSET) && (data[0] === IMAGE_MAGIC || data[ESP32_BOOTLOADER_OFFSET] === IMAGE_MAGIC)) {
    // A merged image holds bootloader, partition table and app, and is written from address 0.
    kind = 'merged';
    appOffset = APP_FLASH_OFFSET;
    headerOffset = data[0] === IMAGE_MAGIC ? 0 : ESP32_BOOTLOADER_OFFSET;
  } else if (data[0] === IMAGE_MAGIC) {
    return { ok: false, error: 'This looks like a bootloader, not the firmware. Choose the .ino.bin or .ino.merged.bin file.' };
  } else {
    return { ok: false, error: 'This is not an ESP32 firmware image. Choose the .bin file exported from the AquaSense sketch.' };
  }

  const chipId = chipIdAt(data, headerOffset);
  const desc = appOffset + APP_DESC_OFFSET;
  const date = readCString(data, desc + 0x60, 16);
  const time = readCString(data, desc + 0x50, 16);
  return {
    ok: true,
    image: {
      kind,
      address: kind === 'app' ? APP_FLASH_OFFSET : 0,
      size: data.length,
      chipId,
      chipName: CHIP_NAMES[chipId] ?? `Unknown chip (ID ${chipId})`,
      version: readCString(data, desc + 0x10, 32),
      projectName: readCString(data, desc + 0x30, 32),
      builtAt: date && time ? `${date} ${time}` : date,
      idfVersion: readCString(data, desc + 0x70, 32),
    },
  };
};
