// Plain-language explanations for the result codes the ESP32 firmware returns
// when it acknowledges a command. Unknown codes are shown as-is.
const deviceResultText: Record<string, string> = {
  accepted: 'Accepted by the device',
  rejected_relays_not_commissioned: 'Relays are disabled on the device. In the ESP32 Serial Monitor, check them with "relay test", then type "relay enable".',
  rejected_exchange_not_commissioned: 'Water exchange runtimes are not set in the firmware yet (EXCHANGE_DRAIN_MS and EXCHANGE_FILL_MS).',
  rejected_water_policy_not_configured: 'Calibrate the tank depth first (Calibration → Tank: capture empty, set target), or set the tank volume and measured pump flows in the ESP32 Serial Monitor ("exchange volume <litres>", "exchange drain <L/min>", "exchange fill <L/min>").',
  rejected_aerator_policy_not_configured: 'Automatic aerator mode is not configured in the firmware (AERATOR_POLICY_CONFIGURED).',
  rejected_water_busy: 'A pump run or cooldown is already in progress. Wait for the water phase to return to Idle.',
  rejected_fault_latched: 'A water fault is latched on the device. Clear the fault before running the pumps.',
  rejected_no_fault: 'There is no fault to clear.',
  rejected_duration_out_of_range: 'Pump duration must be between 1 and 600 seconds (10 minutes).',
  rejected_tank_not_calibrated: 'Capture the empty tub (mount height) and set a target depth on Calibration before Fill to target.',
  rejected_no_ultrasonic: 'No valid ultrasonic echo. Check the sensor wiring and that the surface is in range.',
  rejected_already_at_target: 'Water is already at the calibrated target depth for that pump direction.',
  rejected_feeder_busy: 'The feeder is already running a cycle.',
  rejected_expired: 'Cancelled: the feeder command was more than 1 minute old when it reached the device.',
  rejected_device_restarted: 'Cancelled: the device was switched off or restarted after this command was sent, so the feeder did not move.',
  cancelled_device_offline: 'Cancelled: the device stopped reporting (switched off or offline), so the feeder command was dropped.',
  expired_before_delivery: 'Cancelled: the device did not receive the command before it expired (1 minute for the feeder).',
  rejected_servo_pwm: 'The ESP32 could not start the servo signal on GPIO 18. Check the servo 5 V supply and that its ground joins the ESP32 ground, then flash the latest sketch.',
  rejected_unsupported_action: 'This firmware does not support that action.',
  queue_full: 'The device was busy; the command will be redelivered.',
  rejected_busy: 'The feeder or pumps are running. Wait until they are idle, then capture again.',
  rejected_not_steady: 'The reading was still changing. Wait until it shows Steady, then capture again.',
  rejected_out_of_range: 'That reference value is outside the allowed range for this sensor.',
  rejected_same_input: 'The references gave almost the same probe voltage. Check the probe, buffers, and wiring — a stuck ~3.1 V reading usually means the ADC is open or at the rail.',
  rejected_implausible_slope: 'The fitted line is not plausible for this sensor. Check the solutions and wiring, then clear the points and try again.',
  rejected_turb_voltage_low: 'Turbidity voltage is too low. Power the module from 5 V, set its switch to Analog (A), and check the wire to GPIO34.',
  rejected_turb_inverted: 'The cloudier standard read as clear as (or clearer than) your 0 NTU water, so the points were cleared. Recapture 0 NTU in fresh clean water in a dark cup with no bubbles on the sensor, then capture the standard in the same cup.',
  rejected_turb_curve: 'Turbidity voltage could not be converted. Check the sensor power and wiring, then try again.',
  rejected_bad_param: 'The device did not understand the calibration request.',
  rejected_divider_ratio_unset: 'Set the measured voltage-divider ratio on the ESP32 Serial Monitor first (afe ph|orp|turb <ratio>).',
  rejected_adc_saturated: 'The ESP32 ADC is at a rail or open. Check PO/sensor wiring, module power and ground, and that any divider keeps the pin under ~3.3 V.',
  rejected_disconnected: 'The device reports this probe as disconnected. Fix the wiring before capturing.',
  rejected_unsupported_buffer: 'Use the supported pH buffers: 4.01, 6.86, or 9.18.',
  rejected_poor_fit: 'The three buffer points did not fit a clean line. Clean the probe, use fresh buffers, clear points, and capture again.',
};

export const describeDeviceResult = (result?: string | null): string =>
  result ? deviceResultText[result] ?? result.replace(/_/g, ' ') : 'No result reported';

export const isAcceptedResult = (result?: string | null): boolean => result === 'accepted';
