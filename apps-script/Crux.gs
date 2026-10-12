/**
 * Crux.gs: Chrome UX Report API (field data, p75).
 * Tries the exact URL first and falls back to the origin. Returns scope "none" when CrUX has no data.
 */

var CRUX_ENDPOINT_ = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
var CRUX_METRICS_ = ['largest_contentful_paint', 'cumulative_layout_shift', 'interaction_to_next_paint'];

function Crux_formFactor_(device) {
  return device === 'desktop' ? 'DESKTOP' : 'PHONE';
}

function Crux_p75_(record, metricName) {
  var m = record && record.metrics && record.metrics[metricName];
  var raw = m && m.percentiles ? m.percentiles.p75 : null;
  var n = raw === null || raw === undefined ? NaN : Number(raw);
  return isFinite(n) ? n : null;
}

/** Pure: converts a CrUX API response body into the fields we store. */
function Crux_parse_(body) {
  var record = body && body.record;
  if (!record) return null;
  var out = {
    lcpMs: Crux_p75_(record, 'largest_contentful_paint'),
    cls: Crux_p75_(record, 'cumulative_layout_shift'),
    inpMs: Crux_p75_(record, 'interaction_to_next_paint')
  };
  if (out.lcpMs === null && out.cls === null && out.inpMs === null) return null;
  return out;
}

function Crux_request_(payload, apiKey) {
  var res = UrlFetchApp.fetch(CRUX_ENDPOINT_ + '?key=' + encodeURIComponent(apiKey), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var status = res.getResponseCode();
  if (status === 404) return { found: false };
  if (status !== 200) return { found: false, error: 'CrUX HTTP ' + status };
  return { found: true, body: JSON.parse(res.getContentText()) };
}

/** Returns {scope: 'url'|'origin'|'none', lcpMs, cls, inpMs}. Errors degrade to scope "none". */
function Crux_query_(url, device) {
  var apiKey = Config_get_('CRUX_API_KEY') || Config_get_('PAGESPEED_API_KEY');
  var none = { scope: 'none', lcpMs: null, cls: null, inpMs: null };
  if (!apiKey) return none;
  var parsed = Templates_parseUrl_(url);
  if (!parsed) return none;
  var attempts = [
    { scope: 'url', payload: { url: url, formFactor: Crux_formFactor_(device), metrics: CRUX_METRICS_ } },
    { scope: 'origin', payload: { origin: parsed.protocol + '://' + parsed.host, formFactor: Crux_formFactor_(device), metrics: CRUX_METRICS_ } }
  ];
  for (var i = 0; i < attempts.length; i++) {
    try {
      var res = Crux_request_(attempts[i].payload, apiKey);
      if (!res.found) continue;
      var fields = Crux_parse_(res.body);
      if (fields) return { scope: attempts[i].scope, lcpMs: fields.lcpMs, cls: fields.cls, inpMs: fields.inpMs };
    } catch (err) {
      console.warn('CrUX lookup failed for scope ' + attempts[i].scope + ': ' + err.message);
    }
  }
  return none;
}
