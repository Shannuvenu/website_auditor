/**
 * Storage.gs: Google Sheets (history) and Google Drive (full Lighthouse JSON).
 *
 * Tabs and columns (the header row is created by setup()):
 *   Templates  template_id | template_name | brand | url_pattern | sample_urls | active | traffic_weight | notes
 *   Runs       run_id | created_at | started_at | finished_at | trigger | requested_by | brand | template_id | device |
 *              status | url_count | units_done | units_failed | summary_json | error
 *   Audits     run_id | template_id | brand | device | url | run_index | collected_at | status | error | performance |
 *              accessibility | lcp_ms | cls | tbt_ms | fcp_ms | si_ms | crux_scope | crux_lcp_p75 | crux_cls_p75 |
 *              crux_inp_p75 | drive_file_id | audits_json
 *   Aggregates run_id | generated_at | template_id | brand | device | trigger | url_count | runs_per_url | performance |
 *              accessibility | lcp_ms | cls | tbt_ms | crux_lcp_p75 | crux_cls_p75 | crux_inp_p75 | aggregate_json
 */

var SHEET_HEADERS_ = {
  Templates: ['template_id', 'template_name', 'brand', 'url_pattern', 'sample_urls', 'active', 'traffic_weight', 'notes'],
  Runs: [
    'run_id', 'created_at', 'started_at', 'finished_at', 'trigger', 'requested_by', 'brand', 'template_id', 'device',
    'status', 'url_count', 'units_done', 'units_failed', 'summary_json', 'error'
  ],
  Audits: [
    'run_id', 'template_id', 'brand', 'device', 'url', 'run_index', 'collected_at', 'status', 'error', 'performance',
    'accessibility', 'lcp_ms', 'cls', 'tbt_ms', 'fcp_ms', 'si_ms', 'crux_scope', 'crux_lcp_p75', 'crux_cls_p75',
    'crux_inp_p75', 'drive_file_id', 'audits_json'
  ],
  Aggregates: [
    'run_id', 'generated_at', 'template_id', 'brand', 'device', 'trigger', 'url_count', 'runs_per_url', 'performance',
    'accessibility', 'lcp_ms', 'cls', 'tbt_ms', 'crux_lcp_p75', 'crux_cls_p75', 'crux_inp_p75', 'aggregate_json'
  ]
};

var MAX_CELL_CHARS_ = 45000; // Sheets allows 50,000 per cell

function Storage_ss_() {
  return SpreadsheetApp.openById(Config_require_('SPREADSHEET_ID'));
}

/** Run once by the admin from the Apps Script editor. Safe to run again. */
function setup() {
  Storage_ensureSheets_();
  console.log('Sheets ready. Script Property status (true = set): ' + JSON.stringify(Config_status_()));
}

function Storage_ensureSheets_() {
  var ss = Storage_ss_();
  Object.keys(SHEET_HEADERS_).forEach(function (name) {
    var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = SHEET_HEADERS_[name];
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  });
}

function Storage_sheet_(name) {
  var sheet = Storage_ss_().getSheetByName(name);
  if (!sheet) throw new Error('Missing sheet tab "' + name + '". Run setup() first.');
  return sheet;
}

/** Stops spreadsheet formula injection: a string starting with = + - @ is stored as text. */
function Storage_safeCell_(value) {
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) return "'" + value;
  return value === undefined || value === null ? '' : value;
}

function Storage_readTable_(name) {
  var sheet = Storage_sheet_(name);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  return values.slice(1).map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) {
      obj[h] = row[i];
    });
    return obj;
  });
}

function Storage_toRow_(name, obj) {
  return SHEET_HEADERS_[name].map(function (h) {
    return Storage_safeCell_(obj[h]);
  });
}

function Storage_appendRows_(name, objs) {
  if (!objs.length) return;
  var sheet = Storage_sheet_(name);
  var rows = objs.map(function (o) {
    return Storage_toRow_(name, o);
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function Storage_findRowIndex_(sheet, keyColumn, keyValue) {
  var col = SHEET_HEADERS_[sheet.getName()].indexOf(keyColumn) + 1;
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var values = sheet.getRange(2, col, last - 1, 1).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) === String(keyValue)) return i + 2;
  }
  return -1;
}

/** Updates the named columns of the row whose keyColumn equals keyValue. */
function Storage_updateRow_(name, keyColumn, keyValue, patch) {
  var sheet = Storage_sheet_(name);
  var rowIndex = Storage_findRowIndex_(sheet, keyColumn, keyValue);
  if (rowIndex === -1) return false;
  var headers = SHEET_HEADERS_[name];
  Object.keys(patch).forEach(function (key) {
    var col = headers.indexOf(key);
    if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(Storage_safeCell_(patch[key]));
  });
  return true;
}

function Storage_upsertRow_(name, keyColumn, obj) {
  var sheet = Storage_sheet_(name);
  var rowIndex = Storage_findRowIndex_(sheet, keyColumn, obj[keyColumn]);
  if (rowIndex === -1) {
    Storage_appendRows_(name, [obj]);
    return;
  }
  var row = Storage_toRow_(name, obj);
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
}

function Storage_driveFolder_() {
  var configured = Config_get_('DRIVE_FOLDER_ID');
  if (configured) return DriveApp.getFolderById(configured);
  var props = PropertiesService.getScriptProperties();
  var auto = props.getProperty('DRIVE_FOLDER_ID_AUTO');
  if (auto) return DriveApp.getFolderById(auto);
  var folder = DriveApp.createFolder('PageSpeed Advisor: Lighthouse JSON');
  props.setProperty('DRIVE_FOLDER_ID_AUTO', folder.getId());
  return folder;
}

/** Saves the full PSI response, gzipped, in Drive. Returns the file id (stored in the Audits tab). */
function Storage_saveRawJson_(state, urlIndex, runIndex, json) {
  var name = state.runId + '__' + state.templateId + '__' + state.device + '__u' + urlIndex + '__r' + runIndex + '.json';
  var blob = Utilities.newBlob(JSON.stringify(json), 'application/json', name);
  var gz = Utilities.gzip(blob, name + '.gz');
  return Storage_driveFolder_().createFile(gz).getId();
}

/** Deletes raw JSON files older than RAW_RETENTION_DAYS (default 30). Run from a daily trigger. */
function purgeOldRawFiles() {
  var days = Number(Config_get_('RAW_RETENTION_DAYS') || 30);
  var cutoff = Date.now() - days * 24 * 3600 * 1000;
  var files = Storage_driveFolder_().getFiles();
  var removed = 0;
  while (files.hasNext()) {
    var f = files.next();
    if (f.getDateCreated().getTime() < cutoff) {
      f.setTrashed(true);
      removed++;
    }
  }
  console.log('Moved ' + removed + ' raw files older than ' + days + ' days to Drive trash');
}

function Storage_toNumber_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

function Storage_iso_(v) {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/** Latest aggregate for every (template, device). */
function Storage_latestAggregates_() {
  var latest = {};
  Storage_readTable_('Aggregates').forEach(function (row) {
    var key = row.template_id + '|' + row.device;
    var at = Storage_iso_(row.generated_at) || '';
    if (!latest[key] || at > latest[key].at) latest[key] = { at: at, row: row };
  });
  return Object.keys(latest)
    .sort()
    .map(function (k) {
      return JSON.parse(latest[k].row.aggregate_json);
    });
}

function Storage_aggregateHistory_(templateId, device, limit) {
  return Storage_readTable_('Aggregates')
    .filter(function (r) {
      return r.template_id === templateId && r.device === device;
    })
    .sort(function (a, b) {
      return (Storage_iso_(b.generated_at) || '').localeCompare(Storage_iso_(a.generated_at) || '');
    })
    .slice(0, limit)
    .map(function (r) {
      return JSON.parse(r.aggregate_json);
    });
}

function Storage_runToRecord_(row) {
  var summary = null;
  try {
    summary = row.summary_json ? JSON.parse(row.summary_json) : null;
  } catch (err) {
    summary = null;
  }
  return {
    runId: String(row.run_id),
    createdAt: Storage_iso_(row.created_at),
    startedAt: Storage_iso_(row.started_at),
    finishedAt: Storage_iso_(row.finished_at),
    trigger: String(row.trigger),
    requestedBy: row.requested_by ? String(row.requested_by) : null,
    brand: String(row.brand),
    templateId: String(row.template_id),
    device: String(row.device),
    status: String(row.status),
    urlCount: Storage_toNumber_(row.url_count) || 0,
    urlsDone: Storage_toNumber_(row.units_done) || 0,
    urlsFailed: Storage_toNumber_(row.units_failed) || 0,
    summary: summary,
    error: row.error ? String(row.error) : null
  };
}

function Storage_listRuns_(limit, filters) {
  return Storage_readTable_('Runs')
    .map(Storage_runToRecord_)
    .filter(function (r) {
      return (!filters.templateId || r.templateId === filters.templateId) && (!filters.brand || r.brand === filters.brand);
    })
    .sort(function (a, b) {
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    })
    .slice(0, limit);
}
