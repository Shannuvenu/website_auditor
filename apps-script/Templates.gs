/**
 * Templates.gs: template registry stored in the "Templates" sheet tab.
 * Columns: template_id | template_name | brand | url_pattern | sample_urls | active | traffic_weight | notes
 * sample_urls: one URL per line inside the cell. active: TRUE/FALSE. traffic_weight: blank = equal weight (1).
 */

var MIN_SAMPLES_ = 5;
var MAX_SAMPLES_ = 10;

/** Path pattern matching. "*" matches within one path segment, "**" matches across segments. */
function Templates_patternToRegex_(pattern) {
  var p = String(pattern || '').trim();
  if (p.charAt(0) !== '/') throw new Error('Pattern must start with "/"');
  if (p.length > 1) p = p.replace(/\/+$/, '');

  var out = '';
  var i = 0;

  while (i < p.length) {
    var ch = p.charAt(i);

    if (ch === '*') {
      if (p.charAt(i + 1) === '*') {
        out += '.*';
        i += 2;
        continue;
      }

      out += '[^/]*';
    } else {
      out += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }

    i++;
  }

  return new RegExp('^' + out + '$');
}

function Templates_matchesPattern_(pathname, pattern) {
  var path = String(pathname || '/');

  if (path.length > 1) {
    path = path.replace(/\/+$/, '');
  }

  return Templates_patternToRegex_(pattern).test(path);
}

/** Parses a URL without relying on the URL class (not available in Apps Script). */
function Templates_parseUrl_(raw) {
  var m = /^(https?):\/\/([^\/?#:@]+)(?::(\d+))?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(
    String(raw || '').trim()
  );

  if (!m) return null;

  return {
    protocol: m[1].toLowerCase(),
    host: m[2].toLowerCase(),
    path: m[4] || '/'
  };
}

function Templates_splitUrls_(cell) {
  return String(cell || '')
    .split(/[\n\r,]+/)
    .map(function (s) {
      return s.trim();
    })
    .filter(function (s) {
      return s.length > 0;
    });
}

function Templates_parseBool_(v) {
  if (typeof v === 'boolean') return v;

  return String(v).trim().toLowerCase() === 'true';
}

/** Returns a list of problems for a registry row. Empty list = valid. */
function Templates_validate_(tpl, brandHosts) {
  var problems = [];

  if (!/^[A-Z0-9_]+$/.test(tpl.templateId)) {
    problems.push('template_id must be UPPER_SNAKE_CASE');
  }

  if (!tpl.templateName) {
    problems.push('template_name is empty');
  }

  if (!brandHosts[tpl.brand]) {
    problems.push('brand "' + tpl.brand + '" has no entry in BRAND_HOSTS');
  }

  try {
    Templates_patternToRegex_(tpl.urlPattern);
  } catch (err) {
    problems.push('url_pattern: ' + err.message);
  }

  if (
    tpl.sampleUrls.length < MIN_SAMPLES_ ||
    tpl.sampleUrls.length > MAX_SAMPLES_
  ) {
    problems.push(
      'needs ' +
        MIN_SAMPLES_ +
        ' to ' +
        MAX_SAMPLES_ +
        ' sample URLs (has ' +
        tpl.sampleUrls.length +
        ')'
    );
  }

  var hosts = brandHosts[tpl.brand] || [];

  tpl.sampleUrls.forEach(function (u) {
    var parsed = Templates_parseUrl_(u);

    if (!parsed) {
      problems.push('invalid URL: ' + u);
      return;
    }

    if (parsed.protocol !== 'https') {
      problems.push('URL must use https: ' + u);
    }

    if (hosts.indexOf(parsed.host) === -1) {
      problems.push('host not allowed for ' + tpl.brand + ': ' + parsed.host);
    }

    try {
      if (!Templates_matchesPattern_(parsed.path, tpl.urlPattern)) {
        problems.push('URL does not match pattern: ' + u);
      }
    } catch (err) {
      // Pattern error already reported
    }
  });

  return problems;
}

function Templates_fromRow_(row) {
  var weight =
    row.traffic_weight === '' || row.traffic_weight == null
      ? null
      : Number(row.traffic_weight);

  return {
    templateId: String(row.template_id || '').trim(),
    templateName: String(row.template_name || '').trim(),
    brand: String(row.brand || '').trim().toUpperCase(),
    urlPattern: String(row.url_pattern || '').trim(),
    sampleUrls: Templates_splitUrls_(row.sample_urls),
    active: Templates_parseBool_(row.active),
    trafficWeight:
      weight !== null && isFinite(weight) && weight > 0 ? weight : null,
    notes: String(row.notes || '')
  };
}

/** All registry rows with their validation problems. */
function Templates_list_() {
  var hosts = Config_brandHosts_();

  return Storage_readTable_('Templates')
    .map(Templates_fromRow_)
    .filter(function (t) {
      return t.templateId !== '';
    })
    .map(function (t) {
      t.problems = Templates_validate_(t, hosts);
      return t;
    });
}

/** Active templates that pass validation: the only ones that are ever measured. */
function Templates_listRunnable_() {
  return Templates_list_().filter(function (t) {
    return t.active && t.problems.length === 0;
  });
}

function Templates_get_(templateId) {
  var found = Templates_list_().filter(function (t) {
    return t.templateId === templateId;
  });

  return found.length ? found[0] : null;
}