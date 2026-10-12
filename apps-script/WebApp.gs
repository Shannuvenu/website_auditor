/**
 * WebApp.gs: protected JSON endpoint used by the Next.js backend (never by browsers).
 *
 * Deploy: Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone.
 * "Anyone" is required because the Next.js server cannot sign in with a Google account; access is
 * enforced by the API_TOKEN Script Property instead. Every data action is a POST with the token in the
 * JSON body (never in the URL, so it does not end up in access logs).
 *
 * Request:  { "token": "...", "action": "templates|aggregates|aggregate-history|runs|retest|health", ... }
 * Response: { "ok": true, "data": ... } or { "ok": false, "error": { "code": "...", "message": "..." } }
 */

function WebApp_json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function WebApp_fail_(code, message) {
  return WebApp_json_({ ok: false, error: { code: code, message: message } });
}

/** Constant-time string comparison. */
function WebApp_safeEqual_(a, b) {
  var x = String(a || '');
  var y = String(b || '');
  var diff = x.length ^ y.length;
  for (var i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** GET returns nothing but a liveness marker. No data, no token handling. */
function doGet() {
  return WebApp_json_({ ok: true, data: { service: 'template-pagespeed-advisor' } });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return WebApp_fail_('BAD_REQUEST', 'Body must be JSON');
  }
  var expected = Config_get_('API_TOKEN');
  if (!expected || !WebApp_safeEqual_(body.token, expected)) return WebApp_fail_('UNAUTHORIZED', 'Invalid token');

  try {
    return WebApp_json_({ ok: true, data: WebApp_dispatch_(body) });
  } catch (err) {
    if (err && err.code) return WebApp_fail_(err.code, err.message);
    console.error('WebApp error: ' + (err && err.message));
    return WebApp_fail_('INTERNAL', 'Internal error. See the Apps Script execution log.');
  }
}

function WebApp_error_(code, message) {
  var err = new Error(message);
  err.code = code;
  return err;
}

function WebApp_limit_(value, fallback, max) {
  var n = Number(value);
  if (!isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

function WebApp_dispatch_(body) {
  switch (body.action) {
    case 'health':
      return { config: Config_status_(), time: new Date().toISOString() };
    case 'templates':
      return { templates: Templates_list_() };
    case 'aggregates':
      return { aggregates: Storage_latestAggregates_() };
    case 'aggregate-history':
      return { aggregates: WebApp_history_(body) };
    case 'runs':
      return { runs: Storage_listRuns_(WebApp_limit_(body.limit, 100, 500), { templateId: body.templateId, brand: body.brand }) };
    case 'retest':
      return WebApp_retest_(body);
    default:
      throw WebApp_error_('UNKNOWN_ACTION', 'Unknown action');
  }
}

function WebApp_history_(body) {
  if (!body.templateId || DEVICES_.indexOf(body.device) === -1) {
    throw WebApp_error_('BAD_REQUEST', 'templateId and device (mobile|desktop) are required');
  }
  return Storage_aggregateHistory_(String(body.templateId), body.device, WebApp_limit_(body.limit, 10, 50));
}

/**
 * Queues a re-test of the same sample URLs. Developers pick a template and device only; URLs always
 * come from the Templates sheet, never from the request.
 */
function WebApp_retest_(body) {
  var devices = body.device === 'both' ? DEVICES_ : DEVICES_.indexOf(body.device) !== -1 ? [body.device] : null;
  if (!body.templateId || !devices) throw WebApp_error_('BAD_REQUEST', 'templateId and device (mobile|desktop|both) are required');
  var template = Templates_get_(String(body.templateId));
  if (!template || !template.active) throw WebApp_error_('NOT_FOUND', 'Template not found or inactive');
  if (template.problems.length) throw WebApp_error_('INVALID_TEMPLATE', 'Template registry row has problems: ' + template.problems[0]);

  var outcome = Queue_withLock_(function () {
    var ctx = Queue_defaultCtx_();
    var cooldownMs = Config_getNumber_('RETEST_COOLDOWN_MINUTES') * 60000;
    var requestedBy = String(body.requestedBy || '').slice(0, 60);
    var recent = Storage_listRuns_(200, { templateId: template.templateId }).filter(function (r) {
      return r.trigger === 'retest' && r.createdAt && Date.now() - Date.parse(r.createdAt) < cooldownMs;
    });
    var results = [];
    devices.forEach(function (device) {
      if (
        recent.some(function (r) {
          return r.device === device;
        })
      ) {
        results.push({ device: device, enqueued: false, reason: 'COOLDOWN' });
        return;
      }
      var r = Queue_enqueue_(ctx, { template: template, device: device, trigger: 'retest', requestedBy: requestedBy, runsPerUrl: ctx.runsPerUrl });
      results.push({ device: device, enqueued: r.enqueued, runId: r.runId || null, reason: r.reason || null });
    });
    return { results: results };
  });
  if (outcome.skipped) throw WebApp_error_('BUSY', 'The queue is being updated. Try again in a minute.');
  return outcome;
}
