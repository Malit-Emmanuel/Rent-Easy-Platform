import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraError, MAX_BYTES, MAX_SECONDS, MIN_SECONDS, AUDIO_BPS, VIDEO_BPS, baseMime, blockerKey, checkTake, clockSkewMs, fmtClock, inAppBrowser, pickMime, positionError, secondsLeft, stamp, t2Error } from './recorder';

test('pickMime prefers MP4 where supported (Safari) and WebM otherwise (Chrome); null if nothing works', () => {
  assert.equal(pickMime((m) => m.startsWith('video/mp4')), 'video/mp4;codecs=avc1,mp4a.40.2');
  assert.equal(pickMime((m) => m === 'video/webm;codecs=vp9,opus' || m === 'video/webm'), 'video/webm;codecs=vp9,opus');
  assert.equal(pickMime((m) => m === 'video/webm'), 'video/webm');
  assert.equal(pickMime(() => false), null);
  assert.equal(pickMime(() => { throw new Error('boom'); }), null);
});

test('baseMime strips codec parameters', () => {
  assert.equal(baseMime('video/webm;codecs=vp9,opus'), 'video/webm'); assert.equal(baseMime('Video/MP4'), 'video/mp4'); assert.equal(baseMime('video/mp4; codecs=avc1'), 'video/mp4');
});

test('in-app browsers are recognised, ordinary ones are not', () => {
  assert.ok(inAppBrowser('Mozilla/5.0 (iPhone) AppleWebKit [FBAN/FBIOS;FBAV/430.0]'));
  assert.ok(inAppBrowser('Mozilla/5.0 (Linux; Android 13) Instagram 300.0'));
  assert.ok(inAppBrowser('Mozilla/5.0 (Linux; Android 12) AppleWebKit Mobile Safari WhatsApp/2.23'));
  assert.ok(!inAppBrowser('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'));
  assert.ok(!inAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1'));
});

test('clock skew corrects a phone whose clock is wrong', () => {
  const server = '2026-11-03T10:00:00.000Z', device = new Date('2026-11-03T10:07:00.000Z').getTime();
  const skew = clockSkewMs(server, device); assert.equal(skew, -7 * 60_000);
  assert.equal(stamp(device + 5000, skew), '2026-11-03T10:00:05.000Z');
  assert.equal(clockSkewMs('not a date', device), 0);
});

test('countdown never goes below zero and formats as m:ss', () => {
  const now = Date.parse('2026-11-03T10:00:00Z');
  assert.equal(secondsLeft('2026-11-03T10:30:00Z', now), 1800); assert.equal(secondsLeft('2026-11-03T09:00:00Z', now), 0);
  assert.equal(fmtClock(1800), '30:00'); assert.equal(fmtClock(65), '1:05'); assert.equal(fmtClock(0), '0:00'); assert.equal(fmtClock(9.9), '0:09');
});

test('a take is checked for length and size before upload', () => {
  assert.equal(checkTake(45, 10_000_000), 'ok'); assert.equal(checkTake(MIN_SECONDS - 1, 1000), 'ok', 'one second of tolerance');
  assert.equal(checkTake(10, 1000), 'too_short'); assert.equal(checkTake(60, MAX_BYTES + 1), 'too_large');
});

test('the bitrate keeps a maximum-length recording well under the size limit', () => {
  const bytes = ((VIDEO_BPS + AUDIO_BPS) / 8) * MAX_SECONDS; assert.ok(bytes < MAX_BYTES / 2, `${bytes}`);
});

test('server answers map to messages; unknown ones fall back to the generic error', () => {
  assert.equal(t2Error(403, 'id_not_verified'), 'pvIdNeeded'); assert.equal(t2Error(403, 't2_disabled'), 't2_err_disabled');
  assert.equal(t2Error(409, 'challenge_expired'), 't2_err_expired'); assert.equal(t2Error(409, 'takes_used'), 't2_err_takes');
  assert.equal(t2Error(422, 'recording_outside_window'), 't2_err_window'); assert.equal(t2Error(409, 'evidence_refused'), 't2_err_refused');
  assert.equal(t2Error(502), 'err_storageDown'); assert.equal(t2Error(500), 'genericError');
  assert.equal(blockerKey('no_valid_t1'), 't2_block_no_valid_t1');
  assert.equal(positionError(1), 't2_err_locDenied'); assert.equal(positionError(2), 't2_err_locFailed'); assert.equal(positionError(3), 't2_err_locFailed');
});

test('camera errors: denied, missing and busy get different messages', () => {
  assert.equal(cameraError('NotAllowedError'), 't2_err_camera'); assert.equal(cameraError('SecurityError'), 't2_err_camera'); assert.equal(cameraError(undefined), 't2_err_camera');
  assert.equal(cameraError('NotFoundError'), 't2_err_cameraNone'); assert.equal(cameraError('NotReadableError'), 't2_err_cameraBusy');
});
