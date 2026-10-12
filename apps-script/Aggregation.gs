/**
 * Aggregation.gs: deterministic per-template aggregation. Pure functions, no Google services.
 *
 * Input rows are the parsed "Audits" rows (one per URL x run). For each URL the run with the median
 * performance score is the representative run (lower median for an even count). Everything else is
 * computed across those representative runs: brand + template + device.
 */

function Aggregation_median_(values) {
  var nums = values
    .filter(function (v) {
      return typeof v === 'number' && isFinite(v);
    })
    .sort(function (a, b) {
      return a - b;
    });
  if (!nums.length) return null;
  var mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function Aggregation_round_(v, digits) {
  if (v === null || v === undefined) return null;
  var f = Math.pow(10, digits || 0);
  return Math.round(v * f) / f;
}

/** Parses Audits-sheet objects into typed rows. Rows with bad JSON are marked as errors. */
function Aggregation_rowsFromSheet_(sheetRows) {
  return sheetRows.map(function (r) {
    var audits = [];
    var status = String(r.status);
    try {
      audits = r.audits_json ? JSON.parse(r.audits_json) : [];
    } catch (err) {
      status = 'error';
    }
    return {
      runId: String(r.run_id),
      templateId: String(r.template_id),
      brand: String(r.brand),
      device: String(r.device),
      url: String(r.url),
      runIndex: Number(r.run_index),
      status: status,
      performance: Storage_toNumber_(r.performance),
      accessibility: Storage_toNumber_(r.accessibility),
      lcpMs: Storage_toNumber_(r.lcp_ms),
      cls: Storage_toNumber_(r.cls),
      tbtMs: Storage_toNumber_(r.tbt_ms),
      fcpMs: Storage_toNumber_(r.fcp_ms),
      speedIndexMs: Storage_toNumber_(r.si_ms),
      cruxScope: String(r.crux_scope || 'none'),
      cruxLcpMs: Storage_toNumber_(r.crux_lcp_p75),
      cruxCls: Storage_toNumber_(r.crux_cls_p75),
      cruxInpMs: Storage_toNumber_(r.crux_inp_p75),
      audits: audits
    };
  });
}

/** One representative row per URL. Duplicate (url, runIndex) rows keep the last one written. */
function Aggregation_representativeRows_(rows) {
  var byUrl = {};
  rows.forEach(function (r) {
    if (r.status !== 'ok' || typeof r.performance !== 'number') return;
    byUrl[r.url] = byUrl[r.url] || {};
    byUrl[r.url][r.runIndex] = r;
  });
  return Object.keys(byUrl)
    .sort()
    .map(function (url) {
      var runs = Object.keys(byUrl[url]).map(function (k) {
        return byUrl[url][k];
      });
      runs.sort(function (a, b) {
        return a.performance - b.performance || a.runIndex - b.runIndex;
      });
      return { url: url, picked: runs[Math.floor((runs.length - 1) / 2)], runsUsed: runs.length };
    });
}

/** Query strings and fragments differ per request; the same script/image/stylesheet should count once. */
function Aggregation_normalizeResource_(resource) {
  var s = String(resource || '').trim();
  if (/^https?:\/\//i.test(s) || s.charAt(0) === '/') return s.replace(/[?#].*$/, '');
  return s;
}

function Aggregation_cruxFor_(reps) {
  var perUrl = reps
    .map(function (rep) {
      return rep.picked;
    })
    .filter(function (r) {
      return r.cruxScope === 'url' || r.cruxScope === 'origin';
    });
  var urlLevel = perUrl.filter(function (r) {
    return r.cruxScope === 'url';
  });
  var use = urlLevel.length ? urlLevel : perUrl;
  if (!use.length) return { scope: 'none', lcpMs: null, cls: null, inpMs: null, urlCount: 0 };
  return {
    scope: urlLevel.length ? 'url' : 'origin',
    lcpMs: Aggregation_round_(Aggregation_median_(use.map(function (r) { return r.cruxLcpMs; })), 0),
    cls: Aggregation_round_(Aggregation_median_(use.map(function (r) { return r.cruxCls; })), 3),
    inpMs: Aggregation_round_(Aggregation_median_(use.map(function (r) { return r.cruxInpMs; })), 0),
    urlCount: use.length
  };
}

function Aggregation_auditSortKey_(a, b) {
  var sa = a.medianSavingsMs === null ? -1 : a.medianSavingsMs;
  var sb = b.medianSavingsMs === null ? -1 : b.medianSavingsMs;
  return b.affectedCount - a.affectedCount || sb - sa || (a.auditId < b.auditId ? -1 : a.auditId > b.auditId ? 1 : 0);
}

function Aggregation_buildAudits_(reps, maxAudits) {
  var groups = {};
  var order = [];
  reps.forEach(function (rep) {
    rep.picked.audits.forEach(function (a) {
      if (!groups[a.id]) {
        groups[a.id] = { id: a.id, title: a.title, category: a.category, urls: [], ms: [], bytes: [], offenders: {} };
        order.push(a.id);
      }
      var g = groups[a.id];
      if (g.urls.indexOf(rep.url) !== -1) return;
      g.urls.push(rep.url);
      if (typeof a.savingsMs === 'number') g.ms.push(a.savingsMs);
      if (typeof a.savingsBytes === 'number') g.bytes.push(a.savingsBytes);
      var seen = {};
      (a.items || []).forEach(function (item) {
        var key = Aggregation_normalizeResource_(item.resource);
        if (!key || seen[key]) return;
        seen[key] = true;
        g.offenders[key] = (g.offenders[key] || 0) + 1;
      });
    });
  });

  var audits = order.map(function (id) {
    var g = groups[id];
    var offenders = Object.keys(g.offenders)
      .filter(function (k) {
        return g.offenders[k] >= 2;
      })
      .map(function (k) {
        return { resource: k, urlCount: g.offenders[k] };
      })
      .sort(function (a, b) {
        return b.urlCount - a.urlCount || (a.resource < b.resource ? -1 : 1);
      })
      .slice(0, 5);
    return {
      auditId: g.id,
      title: g.title,
      category: g.category,
      affectedCount: g.urls.length,
      sampledCount: reps.length,
      affectedShare: Aggregation_round_(g.urls.length / reps.length, 4),
      affectedUrls: g.urls.slice().sort(),
      medianSavingsMs: Aggregation_round_(Aggregation_median_(g.ms), 0),
      medianSavingsBytes: Aggregation_round_(Aggregation_median_(g.bytes), 0),
      repeatedOffenders: offenders
    };
  });
  audits.sort(Aggregation_auditSortKey_);
  return audits.slice(0, maxAudits);
}

/** URLs whose performance score is closest to the template median (ties broken by URL). */
function Aggregation_representativeUrls_(reps, medianPerformance) {
  if (medianPerformance === null) return [];
  return reps
    .slice()
    .sort(function (a, b) {
      return Math.abs(a.picked.performance - medianPerformance) - Math.abs(b.picked.performance - medianPerformance) || (a.url < b.url ? -1 : 1);
    })
    .slice(0, 3)
    .map(function (r) {
      return r.url;
    });
}

/**
 * input: { template: {templateId, templateName, brand}, device, runId, trigger, generatedAt,
 *          plannedUrls: string[], rows: parsed rows, maxAudits }
 */
function Aggregation_aggregate_(input) {
  var reps = Aggregation_representativeRows_(input.rows);
  var picks = reps.map(function (r) {
    return r.picked;
  });
  var med = function (field, digits) {
    return Aggregation_round_(
      Aggregation_median_(
        picks.map(function (p) {
          return p[field];
        })
      ),
      digits
    );
  };
  var performance = med('performance', 0);
  var runCounts = reps.map(function (r) {
    return r.runsUsed;
  });
  return {
    schemaVersion: 1,
    runId: input.runId,
    templateId: input.template.templateId,
    templateName: input.template.templateName,
    brand: input.template.brand,
    device: input.device,
    trigger: input.trigger,
    generatedAt: input.generatedAt,
    urlCount: input.plannedUrls.length,
    urlsMeasured: reps.length,
    runsPerUrl: runCounts.length ? Math.min.apply(null, runCounts) : 0,
    scores: { performance: performance, accessibility: med('accessibility', 0) },
    labMetrics: {
      lcpMs: med('lcpMs', 0),
      cls: med('cls', 3),
      tbtMs: med('tbtMs', 0),
      fcpMs: med('fcpMs', 0),
      speedIndexMs: med('speedIndexMs', 0)
    },
    crux: Aggregation_cruxFor_(reps),
    sampleUrls: reps.map(function (r) {
      return r.url;
    }),
    representativeUrls: Aggregation_representativeUrls_(reps, performance),
    audits: reps.length ? Aggregation_buildAudits_(reps, input.maxAudits || 40) : []
  };
}

/** Drops the lowest-ranked audits until the JSON fits in one Sheets cell. */
function Aggregation_fitToCell_(aggregate, maxChars) {
  var copy = JSON.parse(JSON.stringify(aggregate));
  while (JSON.stringify(copy).length > maxChars && copy.audits.length > 0) {
    copy.audits.pop();
  }
  return copy;
}
