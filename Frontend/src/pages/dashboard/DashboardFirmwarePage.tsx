import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ESPLoader, IEspLoaderTerminal, Transport } from 'esptool-js';
import { KeyValues, Notice, PageHead, Panel, StateMark } from '../../components/WaterQuality/Console';
import { formatFlashAddress, inspectFirmwareImage, type FirmwareImageInfo } from '../../services/firmwareImage';
import { md5Hex } from '../../services/md5';

type Phase = 'idle' | 'connecting' | 'connected' | 'flashing' | 'done';
type Firmware = { name: string; exportedAt: Date; data: Uint8Array; info: FirmwareImageInfo };

const BAUD_RATES = [115200, 460800, 921600] as const;
const LOG_LIMIT = 400;

const webSerialAvailable = typeof navigator !== 'undefined' && 'serial' in navigator && window.isSecureContext;

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;

// Turns esptool-js and Web Serial failures into steps the farmer can act on.
const describeError = (err: unknown): string => {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';
  if (name === 'InvalidStateError' || /failed to open serial port|port is already open/i.test(message)) {
    return 'The USB port is in use. Close the Arduino IDE Serial Monitor or any other program using the board, then connect again.';
  }
  if (/failed to connect|timeout|timed out|no serial data|wrong boot mode/i.test(message)) {
    return 'The ESP32 did not enter download mode. Hold the BOOT button, click Connect again, and release BOOT once the chip is detected.';
  }
  if (name === 'NetworkError' || /device has been lost|disconnected/i.test(message)) {
    return 'The board was unplugged or reset during the transfer. Reconnect it and flash again; the old firmware may no longer start until you do.';
  }
  if (/md5/i.test(message)) {
    return 'The written data did not match the file. Flash again, at 115200 baud if it keeps failing.';
  }
  return message || 'Something went wrong talking to the board.';
};

const DashboardFirmwarePage: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [baudRate, setBaudRate] = useState<number>(460800);
  const [firmware, setFirmware] = useState<Firmware | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [chip, setChip] = useState<{ description: string; name: string; imageChipId: number | null } | null>(null);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const transportRef = useRef<Transport | null>(null);
  const loaderRef = useRef<ESPLoader | null>(null);
  const logRef = useRef<HTMLPreElement | null>(null);

  const appendLog = useCallback((text: string, newLine: boolean) => {
    setLog((lines) => {
      const next = lines.length === 0 ? [''] : [...lines];
      next[next.length - 1] += text;
      if (newLine) next.push('');
      return next.slice(-LOG_LIMIT);
    });
  }, []);

  const terminal = useRef<IEspLoaderTerminal>({
    clean: () => setLog([]),
    write: (data) => appendLog(data, false),
    writeLine: (data) => appendLog(data, true),
  });

  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [log]);

  const releasePort = useCallback(async () => {
    const transport = transportRef.current;
    transportRef.current = null;
    loaderRef.current = null;
    if (transport) await transport.disconnect().catch(() => undefined);
  }, []);

  // Free the COM port when leaving the page, so other tools can open it.
  useEffect(() => () => { void releasePort(); }, [releasePort]);

  // Leaving mid-write can leave the board without a bootable firmware.
  useEffect(() => {
    if (phase !== 'flashing') return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setFirmware(null);
    setFileError(null);
    setResetConfirmed(false);
    if (!file) return;
    const data = new Uint8Array(await file.arrayBuffer());
    const result = inspectFirmwareImage(data);
    if (result.ok) {
      setFirmware({ name: file.name, exportedAt: new Date(file.lastModified), data, info: result.image });
      if (phase === 'done') setPhase('connected');
    } else {
      setFileError(result.error);
    }
  };

  const connect = async () => {
    setError(null);
    setPhase('connecting');
    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort({});
    } catch {
      // Closing the browser's port picker is not an error.
      setPhase('idle');
      return;
    }
    try {
      const { ESPLoader, Transport } = await import('esptool-js');
      const transport = new Transport(port, false);
      transportRef.current = transport;
      const loader = new ESPLoader({ transport, baudrate: baudRate, romBaudrate: 115200, terminal: terminal.current });
      loaderRef.current = loader;
      const description = await loader.main('default_reset');
      setChip({ description, name: loader.chip.CHIP_NAME, imageChipId: loader.chip.IMAGE_CHIP_ID ?? null });
      setPhase('connected');
    } catch (err) {
      await releasePort();
      setChip(null);
      setError(describeError(err));
      setPhase('idle');
    }
  };

  const disconnect = async () => {
    await releasePort();
    setChip(null);
    setProgress(0);
    setPhase('idle');
  };

  const flash = async () => {
    const loader = loaderRef.current;
    if (!loader || !firmware) return;
    setError(null);
    setProgress(0);
    setPhase('flashing');
    try {
      await loader.writeFlash({
        fileArray: [{ data: firmware.data, address: firmware.info.address }],
        flashMode: 'keep',
        flashFreq: 'keep',
        flashSize: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress: (_fileIndex, written, total) => setProgress(total > 0 ? written / total : 0),
        calculateMD5Hash: md5Hex,
      });
      setProgress(1);
      // Pulse EN so the board leaves download mode and boots the new firmware.
      await loader.after('hard_reset');
      await releasePort();
      setChip(null);
      setPhase('done');
    } catch (err) {
      await releasePort();
      setChip(null);
      setError(describeError(err));
      setPhase('idle');
    }
  };

  const chipMismatch = Boolean(chip && firmware && chip.imageChipId !== null && chip.imageChipId !== firmware.info.chipId);
  const busy = phase === 'connecting' || phase === 'flashing';
  const needsResetConfirm = firmware?.info.kind === 'merged' && !resetConfirmed;
  const canFlash = phase === 'connected' && firmware !== null && !chipMismatch && !needsResetConfirm;
  const percent = Math.round(progress * 100);

  if (!webSerialAvailable) {
    return (
      <div className="space-y-5">
        <PageHead title="Firmware update" description="Flash new firmware onto the AquaSense ESP32 over USB, straight from the browser." />
        <Notice tone="warn" title="This browser cannot reach USB devices">
          Open the dashboard in Google Chrome or Microsoft Edge on a computer. Firefox, Safari and phones do not support USB serial access.
        </Notice>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHead
        title="Firmware update"
        description="Flash new firmware onto the AquaSense ESP32 over USB, straight from the browser. The file never leaves this computer."
        actions={phase === 'done' ? <StateMark state="ok">Firmware flashed</StateMark> : chip ? <StateMark state="ok">{chip.name} connected</StateMark> : undefined}
      />

      {error && <Notice tone="alarm" title="Flashing stopped">{error}</Notice>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel title="1. Firmware file" description="The .bin exported from the Arduino IDE (Sketch → Export Compiled Binary)">
            <label className="field-label" htmlFor="firmware-file">Firmware (.bin)</label>
            <input id="firmware-file" type="file" accept=".bin,application/octet-stream" onChange={onFileChange} disabled={busy}
              className="field file:mr-3 file:rounded file:border-0 file:bg-water file:px-3 file:py-1 file:text-sm file:font-semibold" />
            <p className="field-hint">Use <span className="font-mono">AquaSense_ESP32.ino.bin</span> for an update, or <span className="font-mono">.ino.merged.bin</span> for a new or wiped board.</p>
            {fileError && <div className="mt-3"><Notice tone="alarm">{fileError}</Notice></div>}
            {firmware && (
              <KeyValues className="mt-4" rows={[
                { label: 'File', value: <span className="break-all">{firmware.name}</span> },
                { label: 'Type', value: firmware.info.kind === 'merged' ? 'Full image (bootloader + partitions + app)' : 'App only' },
                { label: 'Written at', value: <span className="font-mono">{formatFlashAddress(firmware.info.address)}</span> },
                { label: 'Size', value: <span className="tabular-nums">{formatBytes(firmware.info.size)}</span> },
                { label: 'Built for', value: firmware.info.chipName },
                // The app description's build date is the Arduino core's, so the file time is the useful one.
                { label: 'Exported', value: firmware.exportedAt.toLocaleString() },
                { label: 'Framework', value: firmware.info.idfVersion ?? '—' },
              ]} />
            )}
          </Panel>

          <Panel title="2. Connect the ESP32" description="Plug the board into this computer with a USB data cable">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div>
                <label className="field-label" htmlFor="firmware-baud">Transfer speed</label>
                <select id="firmware-baud" value={baudRate} onChange={(e) => setBaudRate(Number(e.target.value))} className="field tabular-nums" disabled={phase !== 'idle' && phase !== 'done'}>
                  {BAUD_RATES.map((rate) => <option key={rate} value={rate}>{rate.toLocaleString()} baud</option>)}
                </select>
              </div>
              {chip ? (
                <button type="button" className="btn btn-secondary" onClick={disconnect} disabled={busy}>Disconnect</button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={connect} disabled={busy}>
                  {phase === 'connecting' ? 'Connecting…' : 'Connect'}
                </button>
              )}
            </div>
            <p className="field-hint">Use 115,200 baud if flashing fails partway through.</p>
            {chip ? (
              <KeyValues className="mt-4" rows={[{ label: 'Chip', value: chip.description }]} />
            ) : (
              <ol className="mt-4 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-ink-2">
                <li>Close the Arduino IDE Serial Monitor, which holds the port.</li>
                <li>Click Connect and pick the board's port, for example COM3 or “CP2102” / “CH340”.</li>
                <li>If it does not connect, hold BOOT while clicking Connect and release it once the chip is detected.</li>
              </ol>
            )}
            {chipMismatch && chip && firmware && (
              <div className="mt-3">
                <Notice tone="alarm" title="Wrong firmware for this board">
                  The file is built for {firmware.info.chipName}, but the connected chip is {chip.name}. Choose firmware built for {chip.name}.
                </Notice>
              </div>
            )}
          </Panel>

          <Panel title="3. Flash">
            {firmware?.info.kind === 'merged' && (
              <label className="mb-4 flex cursor-pointer items-start gap-2.5 text-sm">
                <input type="checkbox" checked={resetConfirmed} onChange={(e) => setResetConfirmed(e.target.checked)} disabled={busy} className="mt-0.5" />
                <span>
                  I understand this resets the device's saved settings
                  <span className="block text-[13px] text-ink-2">A full image overwrites the whole flash, including calibration and other settings stored on the ESP32. To keep them, flash the app-only .ino.bin instead.</span>
                </span>
              </label>
            )}
            <button type="button" className="btn btn-primary" onClick={flash} disabled={!canFlash}>
              {phase === 'flashing' ? 'Flashing…' : 'Flash firmware'}
            </button>
            {!firmware && <p className="field-hint">Choose a firmware file first.</p>}
            {firmware && phase !== 'connected' && phase !== 'flashing' && phase !== 'done' && <p className="field-hint">Connect the ESP32 first.</p>}

            {(phase === 'flashing' || phase === 'done') && (
              <div className="mt-4">
                <div className="flex justify-between text-[13px] text-ink-2">
                  <span>{phase === 'done' ? 'Written and verified' : 'Writing… keep the board plugged in'}</span>
                  <span className="tabular-nums">{percent}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-water" role="progressbar" aria-label="Flash progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                  <div className="h-full rounded-full bg-ink transition-[width] duration-200 ease-out" style={{ width: `${percent}%` }} />
                </div>
              </div>
            )}
            {phase === 'done' && (
              <div className="mt-4">
                <Notice tone="ok" title="The board is restarting with the new firmware">
                  Release BOOT if you are still holding it. If the board does not start, press EN (reset) once.
                </Notice>
              </div>
            )}
          </Panel>
        </div>

        <Panel title="Log" description="Output from the flasher" bodyClassName="p-0"
          actions={log.length > 0 && !busy ? <button type="button" className="btn btn-quiet btn-sm" onClick={() => setLog([])}>Clear</button> : undefined}>
          <pre ref={logRef} className="h-[28rem] overflow-auto whitespace-pre-wrap break-all px-4 py-3 font-mono text-[12px] leading-relaxed text-ink-2 xl:h-full xl:max-h-[44rem]">
            {log.length > 0 ? log.join('\n') : 'Nothing yet. Connect a board to see its output here.'}
          </pre>
        </Panel>
      </div>
    </div>
  );
};

export default DashboardFirmwarePage;
