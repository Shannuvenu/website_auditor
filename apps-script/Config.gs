/**
 * Config.gs: all configuration comes from Script Properties (Project Settings > Script Properties).
 * Only the Apps Script admin can see or edit them. Nothing here is ever returned by the web endpoint.
 *
 * Required: SPREADSHEET_ID, PAGESPEED_API_KEY, API_TOKEN
 * Optional: CRUX_API_KEY, DRIVE_FOLDER_ID, RUNS_PER_URL, TIME_BUDGET_MS, RETEST_COOLDOWN_MINUTES,
 *           DAILY_HOUR, BRAND_HOSTS, MAX_AUDITS_PER_AGGREGATE
 */

var CONFIG_DEFAULTS_ = {
  RUNS_PER_URL: '3',
  TIME_BUDGET_MS: '240000', // stop starting new work after 4 minutes (hard limit is 6)
  MIN_REMAINING_MS: '70000', // do not start a URL unless this much budget is left
  RETEST_COOLDOWN_MINUTES: '30',
  DAILY_HOUR: '2',
  MAX_AUDITS_PER_AGGREGATE: '40',
  FAIL_THRESHOLD: '0.9',
  BRAND_HOSTS: '{"DH":["www.deccanherald.com"],"PV":["www.prajavani.net"]}'
};

var DEVICES_ = ['mobile', 'desktop'];

function Config_get_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (v === null || v === '') {
    return Object.prototype.hasOwnProperty.call(CONFIG_DEFAULTS_, key) ? CONFIG_DEFAULTS_[key] : null;
  }
  return v;
}

function Config_require_(key) {
  var v = Config_get_(key);
  if (!v) throw new Error('Missing Script Property: ' + key);
  return v;
}

function Config_getNumber_(key) {
  var n = Number(Config_get_(key));
  if (!isFinite(n)) throw new Error('Script Property ' + key + ' must be a number');
  return n;
}

function Config_brandHosts_() {
  var parsed;
  try {
    parsed = JSON.parse(Config_get_('BRAND_HOSTS'));
  } catch (err) {
    throw new Error('BRAND_HOSTS must be valid JSON, e.g. {"DH":["www.deccanherald.com"]}');
  }
  return parsed;
}

/** Reports which settings are present, never their values. Used by the "health" action. */
function Config_status_() {
  var required = ['SPREADSHEET_ID', 'PAGESPEED_API_KEY', 'API_TOKEN'];
  var status = {};
  required.forEach(function (k) {
    status[k] = !!Config_get_(k);
  });
  status.CRUX_API_KEY = !!(Config_get_('CRUX_API_KEY') || Config_get_('PAGESPEED_API_KEY'));
  return status;
}
