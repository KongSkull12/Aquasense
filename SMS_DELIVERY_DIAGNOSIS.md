# SMS delivery diagnosis — 2026-09-10

## Implementation follow-up

### SMS wording update: 2026-09-11

Generated rule, combined, resend, prediction, and default test messages now use sentence case and complete sentences. Templates remove links from dynamic labels, preserve measurement units and urgent actions, and fit within the existing 160-character limit without cutting off a sentence. When all details cannot fit, the message directs the farmer to the dashboard. Predictive messages retain uncertainty; missing estimates no longer claim conditions will become unsafe soon. The water-change page's SMS now identifies the simulated cycle and does not claim that physical water replacement occurred.

The [UniSMS content guidance shown in the dashboard](https://unismsapi.com/messages/new), [acceptable-use policy](https://unismsapi.com/acceptable-use), and [terms](https://unismsapi.com/terms) were reviewed. These wording changes do not establish provider approval or explain the earlier rejection. The user's dashboard screenshot also shows rejection of a sentence-case test message. No live SMS was submitted for this wording update. Custom messages supplied to the test endpoint remain caller-authored.

Example generated alert: `AquaSense emergency alert. AquaSense Farm, FirstTank. Dissolved oxygen is dangerously low (1.5 mg/L). Please turn on the aerator immediately.`

### Earlier delivery repairs

The findings below describe the pre-fix audit. The following repairs were implemented afterward:

- Sender ID validation and exact sender submission, including AquaSense when configured.
- Accurate rejected/pending/sent responses in test and resend endpoints; pending gets HTTP 202.
- No immediate retries for HTTP validation failures or ambiguous timeouts. Only definite pre-submission connection failures are retried.
- Transaction-scoped PostgreSQL locking and a committed reservation before submission. A lost/uncertain outcome blocks duplicate automatic sending.
- Persistent SMS outcomes, reference IDs, and a 30-second read-only pending-status reconciliation task; dashboard displays pending, rejected, and unconfirmed states.
- Measured-oxygen metadata, suppression of oxygen alerts for missing oxygen, and exclusion of unmeasured samples from the prediction model. Historical rows are marked unmeasured because their measurement origin cannot be established.
- Regression tests for request shape, failure handling, status reconciliation, concurrency, database reservation failures, and missing oxygen.

Verification: both TypeScript checks and production builds passed, all 29 SMS tests passed, and a real two-connection PostgreSQL check verified lock exclusion and release. The local backend was restarted with external network access enabled.

Live test after repair (2026-09-10 11:22 UTC): UniSMS again returned HTTP 422 with the content/spam rejection. The new code made one submission, did not retry, and saved status rejected with success=false in SMS Logs. No recipient delivery is confirmed. Provider acceptance remains unresolved; these code repairs cannot override UniSMS validation.

Remaining scope: real sensor calibration is required, the static numeric storage retains an explicitly unmeasured oxygen placeholder for compatibility, and provider-internal content rules and handset receipt require external confirmation. Existing unrelated lint issues were not changed.

## Conclusion

The current test-message rejection is reproducible directly against UniSMS without importing AquaSense, Express, Axios, the SMS service, sensor logic, or the database. UniSMS returns HTTP 422 with a `content` validation error. Changing the backend port, rebuilding, or restoring Git history will not address that particular response.

This does **not** prove UniSMS has a software defect. A content policy, account restriction, sender rule, or a false positive could explain the rejection. The public documentation does not identify the rule that rejected this content; provider support must explain it.

The broader SMS integration also has independently verified code defects. Saying the provider is the only problem would be incorrect. Earlier advice that the sender ID was optional was incorrect for the current documented API.

## Live verification

Using the current local credentials, a standalone Node.js script loaded only `dotenv`, filesystem access, and native HTTPS. It made one account request and one SMS submission, without automatic retries.

| Check | Observed result |
| --- | --- |
| `GET https://unismsapi.com/api/account` | HTTP 200; account active; 83 SMS credits |
| Sender submitted | `UNISOFT` |
| Recipient | Configured farmer mobile ending in 27; full number omitted |
| Content | `AquaSense notification test. Please confirm you received this message.` |
| `POST https://unismsapi.com/api/sms` | HTTP 422 |
| Validation error | `{"errors":{"content":["Please rephrase your message to not look like spam"]}}` |

The standalone request used JSON fields `recipient`, `content`, and `sender_id`, with the API secret as the Basic Authentication username and an empty password. That matches the [official SMS API documentation](https://unismsapi.com/docs/sms). No message reference or accepted-send status was returned.

This isolates the failure from AquaSense's implementation for this exact payload. It does not establish whether a different legitimate alert template would pass, whether sender spelling/case matters elsewhere, or whether the provider's content rule is operating correctly. No additional alternative messages were sent during this audit.

## Behavior reproduced without sending SMS

Axios's transport was replaced with a mock in a separate process. Requests used a dummy recipient. Logger output was suppressed, and no database writes or device commands occurred. These are observed defects, not assertions that every scenario occurred in production.

| Finding | Reproduction and consequence | Source |
| --- | --- | --- |
| Current request construction is correct for configured `UNISOFT` | Captured the serialized request: correct endpoint, POST method, JSON fields, Basic Authentication settings, unchanged test content, and configured sender. | [SMS service](Backend/src/services/sms.service.ts#L91) |
| Misleading test endpoint response | Simulated provider rejection. Controller returned HTTP 200, outer `success: true`, message `SMS test sent`, but nested `data.success: false`. A caller checking only HTTP status or the outer flag can report a failed SMS as sent. | [Test controller](Backend/src/api/v1/controllers/smsController.ts#L31) |
| Provider delivery state is ignored | Simulated HTTP 201 responses with `message.status` set to `pending` and `failed`. Both returned application `success: true` and generated the sent log message. Pending can mean accepted, but cannot establish sending or delivery; failed must not be classified as successful. | [SMS service](Backend/src/services/sms.service.ts#L115) |
| Non-retryable validation failures are retried | A simulated HTTP 422 resulted in three identical provider calls. Repeating an invalid payload cannot correct validation. | [Retry loop](Backend/src/services/sms.service.ts#L123) |
| Configured sender can be silently omitted | Setting sender to `AquaSense` resulted in a payload without `sender_id`. Empty sender also proceeds to the provider. This conflicts with the documented required sender field. Not the cause of the current `UNISOFT` content-only rejection. | [Sender condition](Backend/src/services/sms.service.ts#L98) |
| Cooldown has a concurrency race | With mocked storage and SMS, two simultaneous alerts for the same device/category/severity both saw no prior successful record and both sent. There is no atomic reservation or in-flight guard. This can produce duplicate alerts; it does not prove the duplicates visible in the screenshot had this cause. | [Notification flow](Backend/src/services/waterAlertNotification.service.ts#L136), [cooldown](Backend/src/services/cooldown.service.ts#L15) |
| Missing oxygen becomes a real emergency | An otherwise normal reading with temperature 26, pH 7.5, and turbidity 5, but no oxygen field, acquired oxygen 0 and produced an oxygen EMERGENCY in the rule engine. All persistence/notification methods were mocked. The active folder sketch publishes temperature, pH, and turbidity only. | [MQTT fallback](Backend/src/services/mqttService.ts#L178), [oxygen rule](Backend/src/services/ruleEngine.service.ts#L131), [firmware publications](ESP32_Water_Quality_MQTT/ESP32_Water_Quality_MQTT.ino#L108) |

The official API exposes a reference-based status endpoint and lists `pending`, `retrying`, `sent`, and `failed`. The application needs to preserve and reconcile those states rather than treating every HTTP success as a sent SMS. Even a sent provider status is distinct from recipient confirmation.

## Existing database evidence

Read-only aggregation of `sms_logs` found 699 records:

| Classification | Count | Latest timestamp (UTC) |
| --- | ---: | --- |
| Application recorded success | 117 | 2026-06-02 10:29:37.875 |
| HTTP 422 errors on `sender_id` | 166 | 2026-09-09 14:24:32.050 |
| Circuit breaker open | 405 | 2026-09-09 14:25:19.731 |
| Other failures, not investigated individually | 11 | 2026-06-02 09:43:41.915 |

These are application log records, not a count of delivered messages or distinct provider requests. A failure can contain three attempts; a circuit-open record contains no new provider attempt. Application success is also subject to the status-handling defect described above. Current manual diagnostic sends bypass automatic alert logging, so today's HTTP 422 content rejection is evidenced by the live request output rather than these historical rows.

The two inspected local backend log files contained no matching SMS success, final-failure, or spam-rejection entries. Their silence is not proof of SMS delivery or failure.

## Sensor and alert quality

The folder firmware publishes averaged raw turbidity ADC values without converting them to calibrated NTU. The backend uses turbidity values in threshold alerts labeled NTU. The sketch also uses an explicitly uncalibrated pH estimate. These deserve separate sensor validation before relying on SMS for water-quality decisions. Neither explains rejection of the static test text, which did not pass through the sensor pipeline.

Unmeasured oxygen should be represented as unavailable and excluded from oxygen-specific emergency rules. Do not replace a missing measurement with an invented safe value merely to silence alerts.

## Recommended fixes, in order

1. Have UniSMS investigate the exact HTTP 422 content error using the standalone reproduction. The current key authenticates and the account has credits, but that alone does not establish all messaging permissions.
2. Return a clear failed result from the test endpoint when the provider rejects the request. Expose provider HTTP status and validation fields without leaking secrets.
3. Require a configured sender before sending, trim it, and remove the special case that silently omits `AquaSense`. A sender must actually be authorized for the account.
4. Separate request acceptance from provider send status and delivery confirmation. Persist the reference ID, handle `failed` explicitly, and reconcile pending messages through the documented status endpoint or authenticated webhooks.
5. Stop automatic retries on validation/authentication failures. Retry transient failures selectively. Treat ambiguous timeouts carefully because the provider may already have accepted a message.
6. Add an atomic reservation/lock for each device/category notification and distinguish failure backoff from the successful-alert cooldown. This prevents concurrent duplicates and repeated invalid requests from incoming readings.
7. Correct sensor availability and calibration handling so missing oxygen and raw turbidity do not masquerade as measured water-quality emergencies.
8. Add regression tests for the above failures. The existing seven tests validate phone/message formatting and template length; they do not exercise the provider transport, controller failure response, delivery states, or concurrent sends.

## Scope and limits

- Production source files, firmware, `.env`, and database records were not changed by this audit.
- One live standalone SMS request was submitted and rejected. Other behavior checks used mocks.
- The provider's internal spam rule, sender approval state, and recipient delivery cannot be proven from the returned validation error.
- This report deliberately excludes API credentials, account email, full recipient number, and private message-history contents.
