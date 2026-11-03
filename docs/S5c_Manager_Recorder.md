# S5c: manager recording screen (T2)

Where: property page, a "Video verification (T2)" card under the document verification card. Hidden while `T2_ENABLED` is off.

Flow: notice and consent (checkbox) -> code, today's date and the unit(s) to show -> open camera -> two location readings (start and end) around a 30 to 90 second recording -> watch back -> send (upload, check, submit). Stop is locked for the first 30 seconds and the recorder stops itself at 90.

Details
- Records in the browser (MediaRecorder): MP4 on Safari, WebM on Chrome, about 12 MB for 90 seconds (limit 45 MB).
- Retakes before sending are free; the server counts uploads (3 per code). A failed submit can be retried without uploading again.
- The phone's clock is corrected with the server time so location readings fall inside the code's window.
- In-app browsers (WhatsApp, Instagram, Facebook, TikTok...) get a "open in Chrome or Safari" message.
- Managers never see the reviewer hints. English and Swahili (Swahili needs native review).
- Test only: set `T2_ENABLED=true` on Railway to try it on a test property with test footage.
