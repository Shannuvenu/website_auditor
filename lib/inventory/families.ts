import { matchTemplate, MAX_SAMPLES, minSamplesFor, validateTemplate } from '@/lib/templates/registry';
import type { Brand, TemplateRegistryEntry } from '@/lib/validation/schemas';

export interface Candidate {
  url: string;
  path: string;
  lastmod?: string;
  sitemap: string;
}

/**
 * Words in a URL that suggest a different page family. These are keyword guesses only: they name a proposed
 * family, they never prove a template. Page evidence and an administrator decide.
 */
const HINTS: [string, RegExp][] = [
  ['VIDEO', /^(video|videos)$/],
  ['GALLERY', /^(photo|photos|photogallery|photo-gallery|gallery|galleries|photostory|photo-story)$/],
  ['PODCAST', /^(podcast|podcasts|audio)$/],
  ['LIVE', /^(live|live-updates|live-blog|liveblog|live-news)$/],
  ['TOPIC', /^(topic|topics|tag|tags)$/],
  ['AUTHOR', /^(author|authors|columnist|columnists|byline)$/],
  ['SEARCH', /^search$/],
  ['SUBSCRIBE', /^(subscribe|subscription|subscriptions|plans|membership)$/],
  ['PREMIUM', /^premium$/],
  ['NEWSLETTER', /^(newsletter|newsletters)$/],
  ['ARCHIVE', /^(archive|archives)$/],
  ['SPONSORED', /^(brandspot|dh-brandspot|dhbrandspot|dhbrandpr|sponsored|advertorial)$/],
  ['WEB_STORY', /^(web-stories|webstories|ampstories)$/],
  ['EPAPER', /^(epaper|e-paper)$/],
];

export interface FamilyShape {
  key: string;
  hint: string | null;
  hintIndex: number;
  hintSegment: string | null;
  isRoot: boolean;
  depth: number;
}

export function familyOf(path: string): FamilyShape {
  const segs = path.split('/').filter(Boolean).map((s) => s.toLowerCase());
  if (!segs.length) return { key: 'HOME', hint: 'HOME', hintIndex: 0, hintSegment: null, isRoot: true, depth: 0 };
  // Live blogs are ordinary-looking story URLs whose slug says so, for example /india/karnataka/x-live-updates-4020383.
  if (/(^|-)live-(updates|blog|news|coverage|streaming)(-|$)/.test(segs[segs.length - 1])) {
    return { key: 'LIVE_BLOG', hint: 'LIVE_BLOG', hintIndex: 0, hintSegment: null, isRoot: false, depth: segs.length };
  }
  for (const [name, re] of HINTS) {
    const hintIndex = segs.slice(0, 2).findIndex((s) => re.test(s));
    if (hintIndex !== -1) {
      const isRoot = segs.length === hintIndex + 1;
      return { key: `HINT:${name}:${isRoot ? 'ROOT' : 'ITEM'}`, hint: name, hintIndex, hintSegment: segs[hintIndex], isRoot, depth: segs.length };
    }
  }
  const last = segs[segs.length - 1];
  const idSuffix = /-\d{5,}$/.test(last) || /^\d{5,}$/.test(last);
  const ext = /\.(html?|cms|ece|php|aspx?)$/.exec(last)?.[1] ?? null;
  const depth = Math.min(segs.length, 6);
  return { key: `SHAPE:d${depth}${idSuffix ? ':id' : ''}${ext ? `:${ext}` : ''}`, hint: null, hintIndex: 0, hintSegment: null, isRoot: false, depth };
}

/**
 * Round-robin across top-level sections, biggest sections first (then most recently updated), newest page first
 * inside a section. Large sections are sampled before small ones so samples reflect where the pages really are.
 */
export function selectSamples(candidates: Candidate[], max = MAX_SAMPLES): string[] {
  const buckets = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const section = c.path.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
    buckets.set(section, [...(buckets.get(section) ?? []), c]);
  }
  const newest = (list: Candidate[]) => list.reduce((m, c) => ((c.lastmod ?? '') > m ? (c.lastmod ?? '') : m), '');
  const ordered = [...buckets.entries()]
    .sort(([an, a], [bn, b]) => b.length - a.length || newest(b).localeCompare(newest(a)) || an.localeCompare(bn))
    .map(([, list]) => [...list].sort((a, b) => (b.lastmod ?? '').localeCompare(a.lastmod ?? '') || a.url.localeCompare(b.url)));
  const picked: string[] = [];
  const seen = new Set<string>();
  for (let round = 0; picked.length < max; round++) {
    let any = false;
    for (const list of ordered) {
      const next = list[round];
      if (!next) continue;
      any = true;
      if (!seen.has(next.url) && picked.length < max) {
        seen.add(next.url);
        picked.push(next.url);
      }
    }
    if (!any) break;
  }
  return picked;
}

export interface Family {
  brand: Brand;
  key: string;
  suggestedTemplateId: string;
  suggestedName: string;
  pattern: string;
  candidateCount: number;
  /** Top-level sections seen in this group, with counts (top 8). */
  sections: Record<string, number>;
  samples: string[];
  /** 'single-url-ok (...)' for a page family that legitimately has one page (the home page), else empty. */
  notes: string;
  /** Extra candidates in selection order, used to replace samples that fail verification. */
  pool: string[];
  sampleShortfall: boolean;
  problems: string[];
  /** Registry templates whose patterns also match URLs of this group, with counts. */
  registryOverlap: Record<string, number>;
  status: 'new' | 'overlaps-registry';
}

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

function describe(shape: FamilyShape): { id: string; name: string } {
  if (shape.key === 'HOME') return { id: 'HOME', name: 'Home' };
  if (shape.key === 'LIVE_BLOG') return { id: 'LIVE_BLOG', name: 'Live blog' };
  if (shape.hint) return { id: `${shape.hint}_${shape.isRoot ? 'ROOT' : 'ITEM'}`, name: `${titleCase(shape.hint)} ${shape.isRoot ? 'landing' : 'page'}` };
  const id = shape.key.replace('SHAPE:', '').replace(/:/g, '_').toUpperCase();
  return { id: `SHAPE_${id}`, name: `Path ${shape.key.replace('SHAPE:', '').replace(/:/g, ' ')}` };
}

function patternFor(shape: FamilyShape, members: Candidate[]): string {
  if (shape.key === 'HOME') return '/';
  if (shape.key === 'LIVE_BLOG') return '/**';
  if (shape.hint) {
    const counts = new Map<string, number>();
    for (const m of members) {
      const f = familyOf(m.path);
      const k = `${f.hintIndex}:${f.hintSegment}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const [index, literal] = top[0].split(':');
    const prefix = `${'/*'.repeat(Number(index))}/${literal}`;
    return shape.isRoot ? prefix : `${prefix}/**`;
  }
  return shape.depth >= 6 ? '/*/*/*/*/*/**' : '/*'.repeat(shape.depth);
}

const asRegistry = (t: TemplateRegistryEntry): TemplateRegistryEntry => ({ ...t, active: true });

/**
 * Groups candidates by URL shape and proposes one family per group. Nothing here is active: every family is a
 * proposal that needs administrator approval. `registry` is only read, for overlap and conflict checks.
 */
export function buildFamilies(brand: Brand, candidates: Candidate[], registry: TemplateRegistryEntry[] = []): Family[] {
  const groups = new Map<string, { shape: FamilyShape; members: Candidate[] }>();
  for (const c of candidates) {
    const shape = familyOf(c.path);
    const group = groups.get(shape.key) ?? { shape, members: [] };
    group.members.push(c);
    groups.set(shape.key, group);
  }
  const takenIds = new Set(registry.map((t) => t.templateId));
  const registryAll = registry.map(asRegistry);

  const families: Family[] = [...groups.values()]
    .sort((a, b) => b.members.length - a.members.length || a.shape.key.localeCompare(b.shape.key))
    .map(({ shape, members }) => {
      const pattern = patternFor(shape, members);
      const probe = { templateId: 'X', templateName: 'X', brand, urlPattern: pattern, sampleUrls: [], active: true, trafficWeight: null } as TemplateRegistryEntry;
      const matching = members.filter((m) => matchTemplate(m.url, [probe]) !== null);
      const pool = selectSamples(matching, MAX_SAMPLES + 4);
      const samples = pool.slice(0, MAX_SAMPLES);
      const base = describe(shape);
      let id = `${brand}_${base.id}`;
      for (let n = 2; takenIds.has(id); n++) id = `${brand}_${base.id}_${n}`;
      takenIds.add(id);

      const notes = shape.key === 'HOME' ? 'single-url-ok (home page has one URL)' : '';
      const entry: TemplateRegistryEntry = { templateId: id, templateName: base.name, brand, urlPattern: pattern, sampleUrls: samples, active: false, trafficWeight: null, notes };
      const problems = [...validateTemplate(entry)];
      if (matching.length < members.length) problems.push(`${members.length - matching.length} URLs in this group do not match the proposed pattern`);

      const sections: Record<string, number> = {};
      for (const m of members) {
        const s = m.path.split('/').filter(Boolean)[0]?.toLowerCase() ?? '(root)';
        sections[s] = (sections[s] ?? 0) + 1;
      }
      const topSections = Object.fromEntries(Object.entries(sections).sort((a, b) => b[1] - a[1]).slice(0, 8));

      const registryOverlap: Record<string, number> = {};
      for (const m of members) {
        const hit = matchTemplate(m.url, registryAll);
        if (hit) registryOverlap[hit.templateId] = (registryOverlap[hit.templateId] ?? 0) + 1;
      }
      return {
        brand,
        key: shape.key,
        suggestedTemplateId: id,
        suggestedName: base.name,
        pattern,
        candidateCount: members.length,
        sections: topSections,
        samples,
        notes,
        pool,
        sampleShortfall: samples.length < minSamplesFor(entry),
        problems,
        registryOverlap,
        status: Object.keys(registryOverlap).length ? 'overlaps-registry' : 'new',
      } satisfies Family;
    });

  // Duplicate patterns and samples that another template would win are conflicts the administrator must resolve.
  const proposed = families.map((f) => asRegistry({ templateId: f.suggestedTemplateId, templateName: f.suggestedName, brand, urlPattern: f.pattern, sampleUrls: f.samples, active: true, trafficWeight: null, notes: f.notes }));
  const everything = [...registryAll.filter((t) => t.brand === brand), ...proposed];
  for (const f of families) {
    const twin = families.find((o) => o !== f && o.pattern === f.pattern);
    if (twin) f.problems.push(`same pattern as ${twin.suggestedTemplateId}`);
    for (const url of f.samples) {
      const winner = matchTemplate(url, everything);
      if (winner && winner.templateId !== f.suggestedTemplateId) {
        f.problems.push(`sample ${url} is matched by ${winner.templateId}`);
        break;
      }
    }
  }
  return families;
}

/** Candidates that no registry template (active or not) matches. */
export function findUnmatched(candidates: Candidate[], registry: TemplateRegistryEntry[]): Candidate[] {
  const all = registry.map(asRegistry);
  return candidates.filter((c) => matchTemplate(c.url, all) === null);
}
