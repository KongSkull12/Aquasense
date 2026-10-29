export type SmsDeliveryStatus = 'sent' | 'pending' | 'retrying' | 'failed' | 'rejected' | 'unknown' | 'unavailable';

export interface SmsLogEntry {
  id: string;
  category: string;
  severity: string;
  recipient: string;
  success: boolean;
  // Older API responses may omit delivery details.
  deliveryStatus?: SmsDeliveryStatus;
  referenceId?: string;
  sentAt: string;
}
