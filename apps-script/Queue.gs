/**
 * Queue.gs: resumable run queue.
 *
 * A "run" is one template x one device. The queue lives in Script Properties:
 *   Q_ORDER        JSON array of run ids, oldest first
 *   Q_RUN_<runId>  JSON state: {runId, templateId, brand, device, urls[], runsPerUrl, nextUnit, ...}
 * One unit = one sample URL (its PSI runs execute in parallel, plus one CrUX lookup).
 * After every unit the cursor (nextUnit) is saved, so when the 6-minute limit is near the next trigger
 * continues from the next URL instead of restarting the batch.
 *
 * Queue_process_ and friends take a `ctx` so the logic can be tested without Google services.
 */

var Q_ORDER_KEY_ = 'Q_ORDER';
var Q_RUN_PREFIX_ = 'Q_RUN_';
var Q_MAX_RETRIES_ = 5;

// ---------- queue logic (pure, driven by ctx) ----------

function Queue_readOrder_(ctx) {
  var raw = ctx.props.get(Q_ORDER_KEY_);
  return raw ? JSON.parse(raw) : [];
}

function Queue_writeOrder_(ctx, order) {
  ctx.props.set(Q_ORDER_KEY_, JSON.stringify(order));
}

function Queue_readRun_(ctx, runId) {
  var raw = ctx.props.get(Q_RUN_PREFIX_ + runId);
  return raw ? JSON.parse(raw) : null;
}

function Queue_writeRun_(ctx, state) {
  ctx.props.set(Q_RUN_PREFIX_ + state.runId, JSON.stringify(state));
}

function Queue_pendingStates_(ctx) {
  return Queue_readOrder_(ctx)
    .map(function (id) {
      return Queue_readRun_(ctx, id);
    })
    .filter(function (s) {
      return s !== null;
    });
}

/** Adds a run to the queue. Returns {runId, enqueued:false, reason} if the same template+device is already pending. */
function Queue_enqueue_(ctx, spec) {
  var pending = Queue_pendingStates_(ctx).some(function (s) {
    return s.templateId === spec.template.templateId && s.device === spec.device;
  });
  if (pending) return { enqueued: false, reason: 'ALREADY_PENDING' };
  var runId = ctx.newId();
  var state = {
    runId: runId,
    templateId: spec.template.templateId,
    brand: spec.template.brand,
    device: spec.device,
    trigger: spec.trigger,
    requestedBy: spec.requestedBy || null,
    urls: spec.template.sampleUrls.slice(),
    runsPerUrl: spec.runsPerUrl,
    nextUnit: 0,
    failedUnits: 0,
    retries: 0,
    startedAt: null
  };
  ctx.createRun({
    run_id: runId,
    created_at: ctx.nowIso(),
    trigger: spec.trigger,
    requested_by: spec.requestedBy || '',
    brand: state.brand,
    template_id: state.templateId,
    device: state.device,
    status: 'queued',
    url_count: state.urls.length,
    units_done: 0,
    units_failed: 0
  });
  Queue_writeRun_(ctx, state);
  var order = Queue_readOrder_(ctx);
  order.push(runId);
  Queue_writeOrder_(ctx, order);
  return { enqueued: true, runId: runId };
}

function Queue_dropHead_(ctx, order) {
  var removed = order.shift();
  if (removed) ctx.props.remove(Q_RUN_PREFIX_ + removed);
  Queue_writeOrder_(ctx, order);
}

/**
 * Processes the queue until it is empty or the time budget is used up. Returns stats.
 * ctx.budgetMs / ctx.minRemainingMs control when to stop starting new URLs.
 */
function Queue_process_(ctx) {
  var started = ctx.now();
  var stats = { urlsProcessed: 0, runsCompleted: 0, stoppedBecause: 'idle' };

  for (;;) {
    var order = Queue_readOrder_(ctx);
    if (!order.length) return stats;
    var state = Queue_readRun_(ctx, order[0]);
    if (!state) {
      Queue_dropHead_(ctx, order); // state missing or removed: skip it
      continue;
    }
    if (!state.startedAt) {
      state.startedAt = ctx.nowIso();
      Queue_writeRun_(ctx, state);
      ctx.updateRun(state.runId, { status: 'running', started_at: state.startedAt });
    }

    while (state.nextUnit < state.urls.length) {
      if (ctx.budgetMs - (ctx.now() - started) < ctx.minRemainingMs) {
        stats.stoppedBecause = 'time';
        return stats;
      }
      var result = ctx.collectUrl(state, state.nextUnit);
      if (result.retryLater) {
        state.retries += 1;
        if (state.retries < Q_MAX_RETRIES_) {
          Queue_writeRun_(ctx, state);
          stats.stoppedBecause = 'quota';
          return stats; // try the same URL again on the next trigger
        }
        result = { rows: ctx.failedRows(state, state.nextUnit, 'PageSpeed API unavailable after retries'), failed: true };
      }
      ctx.appendAuditRows(result.rows);
      if (result.failed) state.failedUnits += 1;
      state.retries = 0;
      state.nextUnit += 1;
      stats.urlsProcessed += 1;
      Queue_writeRun_(ctx, state);
      ctx.updateRun(state.runId, { units_done: state.nextUnit, units_failed: state.failedUnits });
    }

    var outcome = ctx.finalizeRun(state);
    ctx.updateRun(state.runId, {
      status: outcome.status,
      finished_at: ctx.nowIso(),
      summary_json: JSON.stringify(outcome.summary),
      error: outcome.error || ''
    });
    Queue_dropHead_(ctx, Queue_readOrder_(ctx));
    stats.runsCompleted += 1;
  }
}

// ---------- production wiring ----------

function Queue_newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function Queue_failedRows_(state, urlIndex, message) {
  var rows = [];
  for (var i = 1; i <= state.runsPerUrl; i++) {
    rows.push(Queue_baseRow_(state, urlIndex, i, { scope: 'none' }, 'error', message));
  }
  return rows;
}

function Queue_baseRow_(state, urlIndex, runIndex, crux, status, error) {
  return {
    run_id: state.runId,
    template_id: state.templateId,
    brand: state.brand,
    device: state.device,
    url: state.urls[urlIndex],
    run_index: runIndex,
    collected_at: new Date().toISOString(),
    status: status,
    error: error || '',
    crux_scope: crux.scope,
    crux_lcp_p75: runIndex === 1 && crux.lcpMs !== undefined ? crux.lcpMs : '',
    crux_cls_p75: runIndex === 1 && crux.cls !== undefined ? crux.cls : '',
    crux_inp_p75: runIndex === 1 && crux.inpMs !== undefined ? crux.inpMs : ''
  };
}

/** Collects one URL: parallel PSI runs + one CrUX lookup + raw JSON to Drive. */
function Queue_collectUrl_(state, urlIndex) {
  var url = state.urls[urlIndex];
  var responses = PageSpeed_fetchRuns_(url, state.device, state.runsPerUrl);
  var usable = responses.filter(function (r) {
    return r.ok;
  });
  if (!usable.length && responses.every(function (r) { return r.retryLater; })) return { retryLater: true };

  var crux = Crux_query_(url, state.device);
  var threshold = Config_getNumber_('FAIL_THRESHOLD');
  var rows = [];
  var okCount = 0;
  responses.forEach(function (res, i) {
    var runIndex = i + 1;
    if (!res.ok) {
      rows.push(Queue_baseRow_(state, urlIndex, runIndex, crux, 'error', res.error));
      return;
    }
    try {
      var parsed = PageSpeed_parse_(res.json, threshold);
      var row = Queue_baseRow_(state, urlIndex, runIndex, crux, 'ok', '');
      row.performance = parsed.performance;
      row.accessibility = parsed.accessibility;
      row.lcp_ms = parsed.lcpMs;
      row.cls = parsed.cls;
      row.tbt_ms = parsed.tbtMs;
      row.fcp_ms = parsed.fcpMs;
      row.si_ms = parsed.speedIndexMs;
      row.drive_file_id = Storage_saveRawJson_(state, urlIndex, runIndex, res.json);
      row.audits_json = Queue_fitAudits_(parsed.audits);
      rows.push(row);
      okCount++;
    } catch (err) {
      rows.push(Queue_baseRow_(state, urlIndex, runIndex, crux, 'error', String(err.message).slice(0, 200)));
    }
  });
  return { rows: rows, failed: okCount === 0 };
}

/** Serialises the failing audits, dropping the least important until the JSON fits in one cell. */
function Queue_fitAudits_(audits) {
  var list = audits.slice().sort(function (a, b) {
    return (b.savingsMs || 0) - (a.savingsMs || 0) || (a.id < b.id ? -1 : 1);
  });
  var json = JSON.stringify(list);
  while (json.length > MAX_CELL_CHARS_ && list.length) {
    list.pop();
    json = JSON.stringify(list);
  }
  return json;
}

function Queue_finalizeRun_(state) {
  var template = Templates_get_(state.templateId) || { templateId: state.templateId, templateName: state.templateId, brand: state.brand };
  var rows = Aggregation_rowsFromSheet_(
    Storage_readTable_('Audits').filter(function (r) {
      return r.run_id === state.runId;
    })
  );
  var aggregate = Aggregation_fitToCell_(
    Aggregation_aggregate_({
      template: template,
      device: state.device,
      runId: state.runId,
      trigger: state.trigger,
      generatedAt: new Date().toISOString(),
      plannedUrls: state.urls,
      rows: rows,
      maxAudits: Config_getNumber_('MAX_AUDITS_PER_AGGREGATE')
    }),
    MAX_CELL_CHARS_
  );
  if (aggregate.urlsMeasured === 0) {
    return { status: 'failed', summary: { urlsMeasured: 0 }, error: 'No URL produced a usable PageSpeed result' };
  }
  Storage_upsertRow_('Aggregates', 'run_id', {
    run_id: aggregate.runId,
    generated_at: aggregate.generatedAt,
    template_id: aggregate.templateId,
    brand: aggregate.brand,
    device: aggregate.device,
    trigger: aggregate.trigger,
    url_count: aggregate.urlsMeasured,
    runs_per_url: aggregate.runsPerUrl,
    performance: aggregate.scores.performance,
    accessibility: aggregate.scores.accessibility,
    lcp_ms: aggregate.labMetrics.lcpMs,
    cls: aggregate.labMetrics.cls,
    tbt_ms: aggregate.labMetrics.tbtMs,
    crux_lcp_p75: aggregate.crux.lcpMs,
    crux_cls_p75: aggregate.crux.cls,
    crux_inp_p75: aggregate.crux.inpMs,
    aggregate_json: JSON.stringify(aggregate)
  });
  return {
    status: aggregate.urlsMeasured < state.urls.length ? 'partial' : 'completed',
    summary: {
      urlsMeasured: aggregate.urlsMeasured,
      performance: aggregate.scores.performance,
      accessibility: aggregate.scores.accessibility,
      lcpMs: aggregate.labMetrics.lcpMs,
      failingAudits: aggregate.audits.length
    }
  };
}

function Queue_defaultCtx_() {
  var props = PropertiesService.getScriptProperties();
  return {
    props: {
      get: function (k) { return props.getProperty(k); },
      set: function (k, v) { props.setProperty(k, v); },
      remove: function (k) { props.deleteProperty(k); }
    },
    now: function () { return Date.now(); },
    nowIso: function () { return new Date().toISOString(); },
    newId: Queue_newId_,
    budgetMs: Config_getNumber_('TIME_BUDGET_MS'),
    minRemainingMs: Config_getNumber_('MIN_REMAINING_MS'),
    runsPerUrl: Config_getNumber_('RUNS_PER_URL'),
    createRun: function (row) { Storage_appendRows_('Runs', [row]); },
    updateRun: function (runId, patch) { Storage_updateRow_('Runs', 'run_id', runId, patch); },
    appendAuditRows: function (rows) { Storage_appendRows_('Audits', rows); },
    collectUrl: Queue_collectUrl_,
    failedRows: Queue_failedRows_,
    finalizeRun: Queue_finalizeRun_
  };
}

/** Runs `fn` while holding the script lock so two triggers never process the queue at once. */
function Queue_withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { skipped: 'LOCKED' };
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------- trigger entry points ----------

/** Time-driven trigger (every 5 minutes): continues whatever is in the queue. */
function processQueue() {
  var result = Queue_withLock_(function () {
    return Queue_process_(Queue_defaultCtx_());
  });
  console.log('processQueue: ' + JSON.stringify(result));
}

/** Daily trigger: queues every active, valid template for mobile and desktop. */
function scheduleDailyRun() {
  var result = Queue_withLock_(function () {
    var ctx = Queue_defaultCtx_();
    var queued = 0;
    Templates_listRunnable_().forEach(function (template) {
      DEVICES_.forEach(function (device) {
        var r = Queue_enqueue_(ctx, { template: template, device: device, trigger: 'scheduled', runsPerUrl: ctx.runsPerUrl });
        if (r.enqueued) queued++;
      });
    });
    return { queued: queued };
  });
  console.log('scheduleDailyRun: ' + JSON.stringify(result));
}

/** Admin runs this once to (re)create the triggers. */
function installTriggers() {
  var handlers = ['processQueue', 'scheduleDailyRun', 'purgeOldRawFiles'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  var hour = Config_getNumber_('DAILY_HOUR');
  ScriptApp.newTrigger('scheduleDailyRun').timeBased().everyDays(1).atHour(hour).create();
  ScriptApp.newTrigger('processQueue').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('purgeOldRawFiles').timeBased().everyDays(1).atHour((hour + 3) % 24).create();
  console.log('Triggers installed: daily schedule at hour ' + hour + ', queue every 5 minutes, raw-file purge daily');
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    ScriptApp.deleteTrigger(t);
  });
}
