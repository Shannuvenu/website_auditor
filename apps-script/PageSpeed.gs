/**
 * PageSpeed.gs: PageSpeed Insights v5 collection and parsing.
 * Parsing (PageSpeed_parse_) is pure so it can be unit tested without Google services.
 */

var PSI_ENDPOINT_ = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
var PSI_CATEGORIES_ = ['performance', 'accessibility'];
var PSI_ROWS_PER_AUDIT_ = 10;
var PSI_MAX_RESOURCE_CHARS_ = 160;
var PSI_SCORED_MODES_ = ['binary', 'numeric', 'metricSavings'];

function PageSpeed_requestUrl_(url, device, apiKey) {
  var q = ['url=' + encodeURIComponent(url), 'strategy=' + encodeURIComponent(device), 'key=' + encodeURIComponent(apiKey)];
  PSI_CATEGORIES_.forEach(function (c) {
    q.push('category=' + c);
  });
  return PSI_ENDPOINT_ + '?' + q.join('&');
}

/**
 * Runs `runs` independent PSI requests for one URL in parallel (UrlFetchApp.fetchAll).
 * Returns [{ok, status, json, error, retryLater}] with one entry per run. Never includes the API key.
 */
function PageSpeed_fetchRuns_(url, device, runs) {
  var key = Config_require_('PAGESPEED_API_KEY');
  var requests = [];
  for (var i = 0; i < runs; i++) {
    requests.push({ url: PageSpeed_requestUrl_(url, device, key), method: 'get', muteHttpExceptions: true });
  }
  var responses = UrlFetchApp.fetchAll(requests);
  return responses.map(function (res) {
    var status = res.getResponseCode();
    if (status === 200) {
      try {
        return { ok: true, status: status, json: JSON.parse(res.getContentText()) };
      } catch (err) {
        return { ok: false, status: status, error: 'PSI returned invalid JSON' };
      }
    }
    return {
      ok: false,
      status: status,
      error: 'PSI HTTP ' + status,
      retryLater: status === 429 || status >= 500
    };
  });
}

function PageSpeed_clip_(value, max) {
  var s = String(value == null ? '' : value);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function PageSpeed_num_(v) {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

/** Rows of an audit table. "list" details (Lighthouse insights) are flattened one level. */
function PageSpeed_detailRows_(audit) {
  var details = audit && audit.details;
  if (!details || !Array.isArray(details.items)) return [];
  if (details.type === 'list') {
    var flat = [];
    details.items.forEach(function (sub) {
      if (sub && Array.isArray(sub.items)) flat = flat.concat(sub.items);
    });
    return flat;
  }
  return details.items;
}

function PageSpeed_rowResource_(item) {
  if (!item || typeof item !== 'object') return '';
  var source = item.source && typeof item.source === 'object' ? item.source.url || item.source.snippet : item.source;
  var node = item.node && typeof item.node === 'object' ? item.node.snippet || item.node.selector : '';
  var name = item.url || source || node || item.label || item.groupLabel || '';
  if (name && typeof name === 'object') name = name.text || name.value || '';
  return PageSpeed_clip_(name, PSI_MAX_RESOURCE_CHARS_);
}

/** Savings in ms for an audit: Lighthouse overall savings, else the best metric saving. Zero means "none". */
function PageSpeed_savingsMs_(audit) {
  var details = audit.details || {};
  var overall = PageSpeed_num_(details.overallSavingsMs);
  if (overall !== null && overall > 0) return Math.round(overall);
  var ms = audit.metricSavings;
  if (ms && typeof ms === 'object') {
    var best = 0;
    ['LCP', 'FCP', 'TBT', 'INP'].forEach(function (k) {
      var v = PageSpeed_num_(ms[k]);
      if (v !== null && v > best) best = v;
    });
    if (best > 0) return Math.round(best);
  }
  return null;
}

function PageSpeed_savingsBytes_(audit, rows) {
  var overall = PageSpeed_num_((audit.details || {}).overallSavingsBytes);
  if (overall !== null && overall > 0) return Math.round(overall);
  var sum = 0;
  rows.forEach(function (r) {
    var v = r && PageSpeed_num_(r.wastedBytes);
    if (v !== null && v > 0) sum += v;
  });
  return sum > 0 ? Math.round(sum) : null;
}

/**
 * Trims a PSI v5 response to what the advisor needs.
 * Failing audit = scored audit in the performance or accessibility category (excluding the metrics group)
 * with score below failThreshold.
 */
function PageSpeed_parse_(json, failThreshold) {
  var threshold = failThreshold == null ? 0.9 : failThreshold;
  var lh = json && json.lighthouseResult;
  if (!lh) throw new Error('PSI response has no lighthouseResult');
  if (lh.runtimeError) throw new Error('Lighthouse runtime error: ' + (lh.runtimeError.code || 'unknown'));

  var categories = lh.categories || {};
  var audits = lh.audits || {};
  var score = function (id) {
    var c = categories[id];
    return c && typeof c.score === 'number' ? Math.round(c.score * 100) : null;
  };
  var metric = function (id) {
    return audits[id] ? PageSpeed_num_(audits[id].numericValue) : null;
  };

  var failing = [];
  PSI_CATEGORIES_.forEach(function (catId) {
    var refs = (categories[catId] && categories[catId].auditRefs) || [];
    refs.forEach(function (ref) {
      var a = audits[ref.id];
      if (!a || ref.group === 'metrics') return;
      if (PSI_SCORED_MODES_.indexOf(a.scoreDisplayMode) === -1) return;
      if (typeof a.score !== 'number' || a.score >= threshold) return;
      var rows = PageSpeed_detailRows_(a);
      failing.push({
        id: a.id,
        title: PageSpeed_clip_(a.title, 120),
        category: catId,
        score: a.score,
        displayValue: a.displayValue ? PageSpeed_clip_(a.displayValue, 80) : null,
        savingsMs: PageSpeed_savingsMs_(a),
        savingsBytes: PageSpeed_savingsBytes_(a, rows),
        items: rows.slice(0, PSI_ROWS_PER_AUDIT_).map(function (r) {
          return {
            resource: PageSpeed_rowResource_(r),
            wastedMs: r && PageSpeed_num_(r.wastedMs) !== null ? Math.round(r.wastedMs) : null,
            wastedBytes: r && PageSpeed_num_(r.wastedBytes) !== null ? Math.round(r.wastedBytes) : null
          };
        })
      });
    });
  });

  return {
    performance: score('performance'),
    accessibility: score('accessibility'),
    lcpMs: metric('largest-contentful-paint'),
    cls: metric('cumulative-layout-shift'),
    tbtMs: metric('total-blocking-time'),
    fcpMs: metric('first-contentful-paint'),
    speedIndexMs: metric('speed-index'),
    audits: failing
  };
}
