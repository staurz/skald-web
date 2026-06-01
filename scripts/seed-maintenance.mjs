// @ts-nocheck — plain Node ESM script (not part of the typed app build).
// Idempotent seed for the house-maintenance feature.
//
// Populates maintenance_task (and grouped checklist sub_tasks) with real upkeep
// for Nesvegen 92, 6010 Ålesund (enebolig, byggeår ca. 1977), drawn from the
// Sunnmørstakst tilstandsrapport (befaring 20.02.2024) plus inferred and general
// Norwegian homeowner maintenance and a coastal-W-Norway garden plan.
//
// Descriptions are structured as Hva / Hvorfor / Hvordan (what / why / how) via
// the wh() helper; the Tasks UI renders those parts as labelled rows.
// User-facing text is Norwegian Bokmål; code is English.
//
// Self-contained on purpose: it imports only better-sqlite3 so it runs under
// plain `node` (the app's TS modules use extensionless ESM imports that need
// Vite's resolver). The schema/date logic mirrors src/lib/server/{db,clock,
// recurrence}.ts — keep them in sync.
//
// Re-running is safe and declarative: rows are upserted by `seed_key`, and any
// previously-seeded row whose seed_key is no longer in SEED_TASKS is removed.
// Descriptive fields are refreshed while the user's scheduling/progress (due_ts,
// last_completed_ts, last_reminded_ts, enabled) and checklist tick state are
// preserved. Manually-created tasks (seed_key = NULL) are never touched.
//
//   Run:  npm run seed         (or: node scripts/seed-maintenance.mjs)
//   Env:  DB_PATH (default ./data/spa.db), TIMEZONE (default Europe/Oslo)

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const TZ = process.env.TIMEZONE ?? 'Europe/Oslo';
const REMINDER_HOUR = 9; // mirrors maintenance-types.ts

// Build a "Hva/Hvorfor/Hvordan" description. Empty parts are omitted, so a
// short task can pass only what it needs. The UI parses these labels.
const wh = (hva, hvorfor, hvordan) =>
  [hva && `Hva: ${hva}`, hvorfor && `Hvorfor: ${hvorfor}`, hvordan && `Hvordan: ${hvordan}`]
    .filter(Boolean)
    .join('\n');

// ── Date math (ported from src/lib/server/clock.ts + recurrence.ts) ──────────

function partsOf(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const m = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) m[p.type] = p.value;
  return {
    year: +m.year,
    month: +m.month,
    day: +m.day,
    hour: +m.hour % 24,
    minute: +m.minute,
    second: +m.second,
  };
}

function offsetMs(utcMs, tz) {
  const p = partsOf(utcMs, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}

function wallTimeToUtc(year, month, day, hour, minute, second, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const o1 = offsetMs(guess, tz);
  const o2 = offsetMs(guess - o1, tz);
  return guess - o2;
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function atNine(year, month, day, tz) {
  const d = Math.min(day, lastDayOfMonth(year, month));
  return wallTimeToUtc(year, month, d, REMINDER_HOUR, 0, 0, tz);
}

function resolveDateAtNine(isoDate, tz) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return atNine(y, m, d, tz);
}

function nextIntervalDue(fromTs, value, unit, tz) {
  const p = partsOf(fromTs, tz);
  if (unit === 'day') {
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day + value));
    return atNine(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), tz);
  }
  if (unit === 'week') {
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day + value * 7));
    return atNine(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), tz);
  }
  const totalMonths = p.month - 1 + value;
  const year = p.year + Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  return atNine(year, month, p.day, tz);
}

function nextAnnualDue(fromTs, month, day, tz) {
  const p = partsOf(fromTs, tz);
  let year = p.year;
  let candidate = atNine(year, month, day, tz);
  if (candidate <= fromTs) {
    year += 1;
    candidate = atNine(year, month, day, tz);
  }
  return candidate;
}

function computeInitialDue(t, now, tz) {
  switch (t.recurrenceKind) {
    case 'once':
      return t.firstDueDate ? resolveDateAtNine(t.firstDueDate, tz) : null;
    case 'interval':
      if (t.firstDueDate) return resolveDateAtNine(t.firstDueDate, tz);
      return nextIntervalDue(now, t.intervalValue ?? 1, t.intervalUnit ?? 'day', tz);
    case 'annual':
      return nextAnnualDue(now, t.annualMonth ?? 1, t.annualDay ?? 1, tz);
    default:
      return null;
  }
}

// ── Schema (mirrors src/lib/server/db.ts) ────────────────────────────────────

const MAINTENANCE_COLUMNS = {
  description: 'TEXT',
  category: 'TEXT',
  source: "TEXT NOT NULL DEFAULT 'manual'",
  priority: 'TEXT',
  season: 'TEXT',
  estimated_minutes: 'INTEGER',
  cost_estimate: 'TEXT',
  seed_key: 'TEXT',
};

export function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS maintenance_task (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT,
      recurrence_kind TEXT NOT NULL,
      interval_value INTEGER,
      interval_unit TEXT,
      annual_month INTEGER,
      annual_day INTEGER,
      due_ts INTEGER,
      last_completed_ts INTEGER,
      last_reminded_ts INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      category TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      priority TEXT,
      season TEXT,
      estimated_minutes INTEGER,
      cost_estimate TEXT,
      seed_key TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_task_due ON maintenance_task(due_ts);
    CREATE TABLE IF NOT EXISTS sub_task (
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (parent_id) REFERENCES maintenance_task(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sub_task_parent ON sub_task(parent_id);
  `);
  // Back-fill descriptive columns on a pre-migration database, THEN index
  // seed_key (the column must exist first — see the matching note in db.ts).
  const existing = new Set(
    db.prepare(`PRAGMA table_info(maintenance_task)`).all().map((c) => c.name),
  );
  for (const [name, decl] of Object.entries(MAINTENANCE_COLUMNS)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE maintenance_task ADD COLUMN ${name} ${decl}`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_task_seed_key ON maintenance_task(seed_key)`);
}

// ── Seed data ────────────────────────────────────────────────────────────────

export const SEED_TASKS = [
  // ── A) TG3 / TG2 findings from the tilstandsrapport (from-report) ──────────
  {
    seedKey: 'report-trapp-rekkverk-ute',
    title: 'Montér rekkverk på utvendig trapp (øst)',
    description: wh(
      'Montere rekkverk på den utvendige tretrappa på østsiden.',
      'TG3 i tilstandsrapporten: trappa mangler rekkverk og har stor lysåpning mellom opptrinnene – fallrisiko, særlig for barn. Avviket må lukkes.',
      'Få montert rekkverk med håndløper og maks ~10 cm åpning iht. byggteknisk forskrift (TEK). Bruk fagfolk for sikker innfesting i trekonstruksjonen; rett opp svai i trinnene samtidig.',
    ),
    category: 'exterior',
    source: 'from-report',
    priority: 'high',
    season: 'summer',
    estimatedMinutes: 240,
    costEstimate: '10 000–50 000',
    recurrenceKind: 'once',
    firstDueDate: '2026-08-01',
  },
  {
    seedKey: 'report-vaskerom-avtrekk',
    title: 'Etabler mekanisk avtrekk i vaskerom (underetasje)',
    description: wh(
      'Etablere mekanisk avtrekk i vaskerommet i underetasjen.',
      'TG3: rommet har ingen ventilering. Vaskerom produserer mye fukt; uten avtrekk gir det kondens, mugg og på sikt råteskader.',
      'Få elektriker/ventilasjonsfirma til å montere en fuktstyrt avtrekksvifte med kanal ut, gjerne med tilluftsventil i dør eller vegg.',
    ),
    category: 'ventilation',
    source: 'from-report',
    priority: 'high',
    season: 'year-round',
    estimatedMinutes: 180,
    recurrenceKind: 'once',
    firstDueDate: '2026-08-01',
  },
  {
    seedKey: 'report-el-kontroll',
    title: 'Bestill utvidet el-kontroll av elektriker',
    description: wh(
      'Bestille en utvidet el-kontroll av en autorisert elektriker.',
      'TG2: ingen eltilsynsrapport de siste 5 årene. Anlegget stammer fra et hus bygd 1977 og er utvidet over tid; skjulte feil kan gi brannfare.',
      'Bestill el-sjekk/internkontroll fra registrert elektrovirksomhet. Be om rapport med avviksliste og legg den i boligmappa.',
    ),
    category: 'electrical',
    source: 'from-report',
    priority: 'high',
    season: 'year-round',
    estimatedMinutes: 120,
    costEstimate: 'Under 10 000',
    recurrenceKind: 'once',
    firstDueDate: '2026-07-15',
  },
  {
    seedKey: 'report-vindusforinger-loft',
    title: 'Forny vindusforinger på loft og finn fuktårsak',
    description: wh(
      'Fornye vindusforingene (karm-/smyglister) på loftet og finne fuktkilden.',
      'TG2: krakelering og fukt målt med Protimeter på foringene øst/vest. Fukt i treverk gir råte og tyder ofte på utett vindu.',
      'Demonter foringene øst og vest, finn årsaken til fukt (gjerne mangelfull utvendig tetting), utbedre tettingen og sett opp nye foringer.',
    ),
    category: 'windows-doors',
    source: 'from-report',
    priority: 'medium',
    season: 'summer',
    costEstimate: 'Under 10 000',
    recurrenceKind: 'once',
    firstDueDate: '2026-09-01',
  },
  {
    seedKey: 'report-grunnmur-puss',
    title: 'Utbedre løs puss og riss i grunnmur (øst)',
    description: wh(
      'Utbedre løs puss og riss i grunnmuren på østsiden.',
      'TG2: registrert bom (løs puss) og svake riss. Løs puss slipper vann inn bak seg og kan gi frostsprengning og fuktskader.',
      'Hugg vekk løs puss, rens, og puss på nytt med egnet mørtel. Sjekk for bakenforliggende fukt før utbedring.',
    ),
    category: 'foundation',
    source: 'from-report',
    priority: 'medium',
    season: 'summer',
    costEstimate: '10 000–50 000',
    recurrenceKind: 'once',
    firstDueDate: '2026-09-01',
  },
  {
    seedKey: 'report-ventilasjon-oppholdsrom',
    title: 'Forbedre ventilasjon i oppholdsrom (inkl. kjellerstue/trimrom)',
    description: wh(
      'Bedre ventilasjonen i oppholdsrom, særlig kjellerstue/trimrom.',
      'TG2: mangelfull ventilering i flere rom; kjellerstua har papp på mur + plast på innside og ingen lufting – risiko for fukt, kondens og dårlig inneklima.',
      'Monter vegg-/vindusventiler i oppholdsrom som mangler det (anbefalt i yttervegg vest). Bruk fagfolk for vurdering av rom under terreng.',
    ),
    category: 'ventilation',
    source: 'from-report',
    priority: 'medium',
    season: 'autumn',
    costEstimate: '10 000–50 000',
    recurrenceKind: 'once',
    firstDueDate: '2026-09-15',
  },
  {
    seedKey: 'report-branndor-hybel',
    title: 'Montér branndør til hybel + forny 2 eldre hybeldører',
    description: wh(
      'Montere brannklassifisert dør til hybelen og fornye 2 eldre hybeldører.',
      'TG2: det mangler branndør til hybelen. En branndør gir rømningstid og er et krav for utleiedel.',
      'Sett inn en EI30-klassifisert dør med tettelist (og gjerne dørpumpe) mot hybelen. Bytt samtidig de 2 eldre dørene fra byggeår.',
    ),
    category: 'fire-safety',
    source: 'from-report',
    priority: 'medium',
    season: 'year-round',
    costEstimate: '10 000–50 000',
    recurrenceKind: 'once',
    firstDueDate: '2026-08-15',
  },
  {
    seedKey: 'report-nedlop-nordost',
    title: 'Sjekk/utbedre nedløpsrør nordøst',
    description: wh(
      'Utbedre nedløpsrøret på nordøstsiden.',
      'TG2: påvist avvik på nedløpet. Dårlig nedløp leder vann mot grunnmur og fasade.',
      'Sjekk feste, skjøter og at vannet ledes bort fra grunnmuren; utbedre eller skift defekte deler.',
    ),
    category: 'roof',
    source: 'from-report',
    priority: 'low',
    season: 'autumn',
    recurrenceKind: 'once',
    firstDueDate: '2026-08-15',
  },
  {
    seedKey: 'report-hybelvinduer',
    title: 'Vedlikehold/skift hybelvinduer fra byggeår',
    description: wh(
      'Vedlikeholde og etter hvert skifte ut hybelvinduene fra byggeår.',
      'TG2: malte trevinduer med slitte karmer og sprekker i treverket. Råte og trekk øker hvis de ikke vedlikeholdes.',
      'Skrap, grunne og mal karmene; bytt tetningslister. Planlegg utskifting av de dårligste vinduene de nærmeste år.',
    ),
    category: 'windows-doors',
    source: 'from-report',
    priority: 'medium',
    season: 'spring',
    costEstimate: '10 000–50 000',
    recurrenceKind: 'once',
    firstDueDate: '2027-04-01',
  },
  {
    seedKey: 'report-radonmaling',
    title: 'Utfør radonmåling (vintersesong)',
    description: wh(
      'Måle radonnivået i boligen.',
      'TG2: ingen radonmåling eller radonsperre. Radon er en usynlig, radioaktiv gass som øker risiko for lungekreft, og måling er påbudt å dokumentere ved utleie.',
      'Legg ut sporfilm-bokser (kjøpes på nett) i oppholdsrom i minst 2 måneder i fyringssesongen (okt–apr), og send dem inn for analyse.',
    ),
    category: 'general',
    source: 'from-report',
    priority: 'medium',
    season: 'winter',
    costEstimate: 'Under 10 000',
    recurrenceKind: 'once',
    firstDueDate: '2026-11-01',
  },
  {
    seedKey: 'report-el-kontroll-periodisk',
    title: 'Periodisk el-kontroll (hvert 5. år)',
    description: wh(
      'Gjennomføre el-ettersyn med jevne mellomrom (hvert 5. år).',
      'Et eldre og utvidet anlegg trenger jevnlig kontroll for å fange opp slitasje og varmgang før det blir brannfare.',
      'Bestill el-kontroll fra registrert elektrovirksomhet hvert 5. år, og arkiver rapporten i boligmappa.',
    ),
    category: 'electrical',
    source: 'from-report',
    priority: 'medium',
    season: 'year-round',
    recurrenceKind: 'interval',
    intervalValue: 60,
    intervalUnit: 'month',
  },
  {
    seedKey: 'report-vatromssjekk',
    title: 'Årlig våtromssjekk',
    description: wh(
      'Årlig gjennomgang av alle våtrom (sluk, membran, fliser, fuger, avtrekk).',
      'Flere bad har membran/sluk med oppbrukt levetid og småavvik (TG2). Tidlig oppdaging hindrer dyre, skjulte vannskader.',
      'Gå gjennom sjekklisten under én gang i året: rengjør sluk, se etter løse fliser/fuger, misfarging, lukt og fukt. Noter endringer fra i fjor.',
    ),
    category: 'wetroom',
    source: 'from-report',
    priority: 'medium',
    season: 'autumn',
    estimatedMinutes: 60,
    recurrenceKind: 'annual',
    annualMonth: 10,
    annualDay: 1,
    subTasks: [
      'Bad hybel: kontrollér sluk, membran og klemring (TG2 – ikke-fagmessig utførelse rundt sluk)',
      'Bad loft: overvåk membran (>½ brukstid), rengjør sluk og sjekk fall mot sluk',
      'Bad 1. etasje: sjekk fliser/bom og fuger; vurder vannalarm',
      'Bad underetasje (bad 1): sjekk fliser/bom og fuger',
      'Alle bad: kontrollér at avtrekk/ventilasjon fungerer',
    ],
  },
  {
    seedKey: 'report-fukt-aldring',
    title: 'Årlig fukt- og aldringssjekk',
    description: wh(
      'Årlig kontroll av komponenter med fuktindikasjon eller oppbrukt levetid.',
      'Tilstandsrapporten flagger drenering, rør, varmepumper og garasje med >½ brukstid eller fuktfunn – alder gir økt sviktrisiko.',
      'Følg sjekklisten under; se etter nye fuktmerker, lukt, lyder og lekkasje. Vurder tiltak når noe forverres fra forrige gang.',
    ),
    category: 'plumbing',
    source: 'from-report',
    priority: 'medium',
    season: 'autumn',
    estimatedMinutes: 45,
    recurrenceKind: 'annual',
    annualMonth: 10,
    annualDay: 1,
    subTasks: [
      'Garasje/bod: sjekk saltutslag på nordvegg og fukt i betonghimling (Protimeter-funn)',
      'Drenering: se etter fukt i kjeller (>½ levetid overskredet – redrenering kan komme)',
      'Innvendige vannledninger (kobber) og avløp (plast): se etter lekkasje (>½ brukstid)',
      'Utvendige vann-/avløpsledninger: vær obs på alder (>½ brukstid)',
      'Varmepumper: kontrollér alder/funksjon (Panasonic fra 2006)',
    ],
  },

  // ── B) Inferred from facts in the salgsoppgave (inferred) ──────────────────
  {
    seedKey: 'inferred-tak-inspeksjon',
    title: 'Årlig inspeksjon av tegltak',
    description: wh(
      'Årlig visuell sjekk av tegltaket.',
      'Taket er tegl fra ca. 1977. Knuste/forskjøvne stein og mose slipper vann inn og gir lekkasje og råte.',
      'Se over taket (kikkert, eller fra stige i tørt og vindstille vær) etter sprukne/glidde takstein og mose, og sjekk beslag, snøfangere og pipehatt. Fjern mose forsiktig.',
    ),
    category: 'roof',
    source: 'inferred',
    priority: 'medium',
    season: 'autumn',
    estimatedMinutes: 60,
    recurrenceKind: 'annual',
    annualMonth: 9,
    annualDay: 15,
  },
  {
    seedKey: 'inferred-takrenner-host',
    title: 'Rens takrenner og nedløp – høst',
    description: wh(
      'Rense takrenner og nedløp om høsten.',
      'Løv og smuss tetter rennene; overvann renner ned fasaden og mot grunnmuren, og kan fryse og sprenge om vinteren.',
      'Etter løvfall: fjern løv/smuss for hånd, spyl rennene og sjekk at nedløpene er åpne og leder vann bort fra huset.',
    ),
    category: 'roof',
    source: 'inferred',
    priority: 'medium',
    season: 'autumn',
    estimatedMinutes: 60,
    recurrenceKind: 'annual',
    annualMonth: 10,
    annualDay: 15,
  },
  {
    seedKey: 'inferred-kledning-mal',
    title: 'Beis/mal liggende trekledning',
    description: wh(
      'Beise eller male den liggende trekledningen.',
      'I det fuktige, salte kystklimaet i Ålesund brytes maling raskt ned. Vedlikeholdt overflate hindrer at treet trekker vann og råtner.',
      'Ca. hvert 8–10 år (eller når malingen flasser/falmer): vask, skrap løs maling, grunne bare flekker og påfør 2 strøk utendørs beis/maling i tørt vær.',
    ),
    category: 'exterior',
    source: 'inferred',
    priority: 'medium',
    season: 'summer',
    recurrenceKind: 'interval',
    intervalValue: 120,
    intervalUnit: 'month',
  },
  {
    seedKey: 'inferred-varmepumpe-filter',
    title: 'Rengjør filter på varmepumpene',
    description: wh(
      'Rengjøre filtrene i de to varmepumpene.',
      'Tette filtre gir dårligere varme, høyere strømforbruk og dårligere luftkvalitet.',
      'Hvert kvartal: ta ut filtrene i innedelene (Toshiba u.et., Panasonic 1.et.), støvsug eller skyll dem, la dem tørke og sett tilbake. Tørk av innedelen.',
    ),
    category: 'heating',
    source: 'inferred',
    priority: 'low',
    season: 'year-round',
    estimatedMinutes: 20,
    recurrenceKind: 'interval',
    intervalValue: 3,
    intervalUnit: 'month',
  },
  {
    seedKey: 'inferred-varmepumpe-service',
    title: 'Service på luft-luft varmepumpene',
    description: wh(
      'Få fagservice på luft-luft-varmepumpene.',
      'Panasonic-pumpa er fra 2006 (TG2 varmesentral, >½ levetid). Service forlenger levetiden og holder effekten oppe; lekkasje av kuldemedium gir dårlig drift.',
      'Bestill jevnlig service fra kuldefirma: rens, sjekk kuldemedium, vifte og kondensavløp.',
    ),
    category: 'heating',
    source: 'inferred',
    priority: 'medium',
    season: 'spring',
    recurrenceKind: 'annual',
    annualMonth: 5,
    annualDay: 15,
  },
  {
    seedKey: 'inferred-feiing-pipe',
    title: 'Feiing og tilsyn av pipe/ildsted',
    description: wh(
      'Feiing og tilsyn av pipe og ildsteder.',
      'Sotavleiring i pipa gir brannfare (pipebrann). Antatt elementpipe med integrert peis (1. etasje) og vedovn (loft).',
      'Sørg for at kommunens feier får tilgang; sjekk selv pipehatt, stigetrinn, sotluke og at ildsteder og pakninger er hele.',
    ),
    category: 'fire-safety',
    source: 'inferred',
    priority: 'medium',
    season: 'autumn',
    recurrenceKind: 'annual',
    annualMonth: 9,
    annualDay: 1,
  },
  {
    seedKey: 'inferred-terrasse-kompositt',
    title: 'Vask og sjekk komposittterrasse og altan',
    description: wh(
      'Vaske og sjekke komposittterrassen og altanen.',
      '~80 m² terrasse + 51 m² altan. TG2 nevner overflateslitasje og glis i endeskjøter; løse bord og rekkverk er sikkerhetsrisiko.',
      'Om våren: vask med terrassesåpe, sjekk endeskjøter og innfesting, og kontrollér at glassrekkverket sitter godt; etterskru ved behov.',
    ),
    category: 'exterior',
    source: 'inferred',
    priority: 'low',
    season: 'spring',
    recurrenceKind: 'annual',
    annualMonth: 5,
    annualDay: 15,
  },
  {
    seedKey: 'inferred-kjokkenvifte-filter',
    title: 'Rengjør kjøkkenviftefiltre',
    description: wh(
      'Rengjøre fettfiltrene i kjøkkenviftene.',
      'Fettfilter (Falmec i 1. etasje, Røroshetta i hybel) blir tette og brannfarlige, og avtrekket mister effekt.',
      'Ta ut fettfiltrene og vask dem i oppvaskmaskin eller varmt såpevann hver 1–3 måned. Bytt eventuelt kullfilter.',
    ),
    category: 'ventilation',
    source: 'inferred',
    priority: 'low',
    season: 'year-round',
    recurrenceKind: 'interval',
    intervalValue: 3,
    intervalUnit: 'month',
  },
  {
    seedKey: 'inferred-garasjeport',
    title: 'Test og smør garasjeporter',
    description: wh(
      'Teste og smøre garasjeportene.',
      '2 porter med åpnere. Skinner som ikke smøres slites, og en auto-revers som svikter er klemfare.',
      'Om våren: smør skinner, hjul og fjærer, og test at porten reverserer når den møter motstand.',
    ),
    category: 'exterior',
    source: 'inferred',
    priority: 'low',
    season: 'spring',
    recurrenceKind: 'annual',
    annualMonth: 4,
    annualDay: 15,
  },

  // ── C) General Norwegian homeowner upkeep (general) ────────────────────────
  {
    seedKey: 'general-roykvarsler-test',
    title: 'Test røykvarslere',
    description: wh(
      'Teste alle røykvarslere.',
      'Røykvarslere redder liv – men bare hvis de virker. Batteri og sensor svikter over tid.',
      'Trykk og hold testknappen til den piper, månedlig. Bytt batteri eller enhet hvis den er svak eller stille.',
    ),
    category: 'fire-safety',
    source: 'general',
    priority: 'medium',
    season: 'year-round',
    estimatedMinutes: 10,
    recurrenceKind: 'interval',
    intervalValue: 1,
    intervalUnit: 'month',
  },
  {
    seedKey: 'general-roykvarsler-batteri',
    title: 'Bytt batteri i røykvarslere (røykvarslerens dag)',
    description: wh(
      'Bytte batteri i alle røykvarslere.',
      'Tomt batteri er vanligste årsak til at varslere ikke virker. 1. desember er den nasjonale røykvarslerdagen – lett å huske.',
      'Bytt batteri i alle varslere, støvsug dem, og bytt hele enheten hvert 10. år.',
    ),
    category: 'fire-safety',
    source: 'general',
    priority: 'medium',
    season: 'winter',
    recurrenceKind: 'annual',
    annualMonth: 12,
    annualDay: 1,
  },
  {
    seedKey: 'general-utekran-steng',
    title: 'Steng og tøm utvendige kraner før frost',
    description: wh(
      'Stenge og tømme utekranene før frosten.',
      'Vann som fryser i utekran eller rør utvider seg og sprenger røret – kan gi stor vannskade ved tining.',
      'Om høsten: steng den innvendige stoppeventilen til utekranen, åpne utekrana for å tømme den, og koble fra slanger.',
    ),
    category: 'plumbing',
    source: 'general',
    priority: 'medium',
    season: 'autumn',
    recurrenceKind: 'annual',
    annualMonth: 10,
    annualDay: 15,
  },
  {
    seedKey: 'general-snolast',
    title: 'Sjekk snølast, istapper og ising',
    description: wh(
      'Sjekke snølast, istapper og ising på taket.',
      'Mye snø og iskjøving ved takfot kan gi takskader og vann inn; istapper kan falle på folk.',
      'Etter store snøfall: vurder snømengden på taket, fjern farlige istapper fra bakken med stang, og hold inngangspartiet fritt.',
    ),
    category: 'roof',
    source: 'general',
    priority: 'medium',
    season: 'winter',
    recurrenceKind: 'annual',
    annualMonth: 1,
    annualDay: 15,
  },
  {
    seedKey: 'general-jordfeilbryter',
    title: 'Test jordfeilbryter',
    description: wh(
      'Teste jordfeilbryteren i sikringsskapet.',
      'Jordfeilbryteren kobler ut strømmen ved jordfeil og beskytter mot støt og brann – men bare hvis mekanismen virker.',
      'Trykk testknappen hvert halvår; bryteren skal slå ut. Slå den på igjen etterpå. Virker den ikke: kontakt elektriker.',
    ),
    category: 'electrical',
    source: 'general',
    priority: 'medium',
    season: 'year-round',
    estimatedMinutes: 5,
    recurrenceKind: 'interval',
    intervalValue: 6,
    intervalUnit: 'month',
  },

  // ── D) Garden — coastal W-Norway / Ålesund, zone ~H1 (gardening) ───────────
  {
    seedKey: 'garden-rose-beskjering',
    title: 'Roser: vårbeskjæring',
    description: wh(
      'Vårbeskjæring av rosebuskene.',
      'Beskjæring fjerner dødt og sykt ved, gir lys og luft inn i busken, og stimulerer kraftige nye skudd og mer blomstring.',
      'I mars/april når faren for hard frost er over: klipp bort dødt, skadet og kryssende ved, og kort inn til friske, utovervendte knopper.',
    ),
    category: 'garden',
    source: 'gardening',
    priority: 'medium',
    season: 'spring',
    recurrenceKind: 'annual',
    annualMonth: 4,
    annualDay: 1,
  },
  {
    seedKey: 'garden-tuja-klipp',
    title: 'Tujahekk: klipping',
    description: wh(
      'Klippe tujahekken.',
      'Regelmessig klipp gir en tett, frisk hekk. Tuja skyter ikke fra gammelt brunt ved, så hekken må holdes innenfor det grønne.',
      'Hovedklipp i juni/juli, eventuelt en lett klipp i august. Klipp litt smalere øverst enn nederst, og aldri inn i det brune veden.',
    ),
    category: 'garden',
    source: 'gardening',
    priority: 'low',
    season: 'summer',
    recurrenceKind: 'annual',
    annualMonth: 7,
    annualDay: 1,
  },
  {
    seedKey: 'garden-buksbom-klipp',
    title: 'Buksbom: formklipp',
    description: wh(
      'Formklippe buksbom.',
      'Buksbom brukes til formklipp; jevn klipping gir en tett og formfast plante.',
      'Klipp i mai/juni og eventuelt i august, helst på en overskyet dag så snittflatene ikke svies av sol. Gjødsle om våren.',
    ),
    category: 'garden',
    source: 'gardening',
    priority: 'low',
    season: 'summer',
    recurrenceKind: 'annual',
    annualMonth: 6,
    annualDay: 1,
  },
  {
    seedKey: 'garden-buksbom-vakt',
    title: 'Buksbom: buksbomsott- og buksbommøll-vakt',
    description: wh(
      'Overvåke buksbom for buksbomsott og buksbommøll.',
      'Buksbomsott (sopp) og buksbommøll (larver) kan ødelegge planten raskt; tidlig oppdaging er avgjørende.',
      'Mai–okt: se etter brune flekker/avløvede partier (sott) og larver/spinn (møll). Heng opp feromonfelle, sørg for luftig vekst, og unngå vanning på bladene. Fjern og kast angrepet materiale.',
    ),
    category: 'garden',
    source: 'gardening',
    priority: 'medium',
    season: 'summer',
    recurrenceKind: 'annual',
    annualMonth: 6,
    annualDay: 1,
  },
  {
    seedKey: 'garden-rhodo-gjodsel',
    title: 'Rhododendron: surjordsgjødsel og dekke',
    description: wh(
      'Gi rhododendron surjordsgjødsel og jorddekke.',
      'Rhododendron trives i sur jord og tåler verken kalk eller uttørking; riktig gjødsel og dekke gir frisk vekst.',
      'Gi rhododendron-/surjordsgjødsel etter blomstring (mai/juni), og legg bark- eller løvdekke rundt planten for å holde på fukten.',
    ),
    category: 'garden',
    source: 'gardening',
    priority: 'low',
    season: 'spring',
    recurrenceKind: 'annual',
    annualMonth: 5,
    annualDay: 15,
  },
  {
    seedKey: 'garden-eple-beskjering',
    title: 'Epletre: vinter-/vårbeskjæring',
    description: wh(
      'Vinter-/vårbeskjæring av epletreet.',
      'Beskjæring gir en åpen, luftig krone (mindre sopp), bedre lysforhold og jevnere fruktsetting.',
      'Feb–mars i en frostfri periode: fjern vannskudd, døde og kryssende greiner, og tynn kronen så lys og luft slipper inn. Ta ikke mer enn ~⅓ av treet.',
    ),
    category: 'garden',
    source: 'gardening',
    priority: 'medium',
    season: 'winter',
    recurrenceKind: 'annual',
    annualMonth: 3,
    annualDay: 1,
  },
  {
    seedKey: 'garden-plen-klipp',
    title: 'Plen: sesongstart klipping',
    description: wh(
      'Klippe plenen jevnlig gjennom sesongen.',
      'Jevn klipping gir en tett, sterk plen og holder mose og ugras nede.',
      'Start i mai og klipp jevnlig mai–sept. Ikke klipp kortere enn ~4 cm, og aldri mer enn ⅓ av høyden om gangen.',
    ),
    category: 'lawn',
    source: 'gardening',
    priority: 'low',
    season: 'spring',
    recurrenceKind: 'annual',
    annualMonth: 5,
    annualDay: 1,
  },
  {
    seedKey: 'garden-plen-gjodsel-var',
    title: 'Plen: vårgjødsling og mosefjerning',
    description: wh(
      'Vårgjødsling og mosefjerning i plenen.',
      'Gjødsel gir tett gress som utkonkurrerer mose – og mose er et stort problem i fuktig kystklima.',
      'Om våren: fjern mose med mosefjerner/vertikalskjærer, gjødsle, og kalk ved behov (sur jord fremmer mose). Så i bare flekker.',
    ),
    category: 'lawn',
    source: 'gardening',
    priority: 'low',
    season: 'spring',
    recurrenceKind: 'annual',
    annualMonth: 5,
    annualDay: 1,
  },
  {
    seedKey: 'garden-plen-gjodsel-host',
    title: 'Plen: høstgjødsling',
    description: wh(
      'Høstgjødsle plenen.',
      'Høstgjødsel (lite nitrogen, mer kalium) styrker røttene og gjør plenen mer motstandsdyktig mot vinter og sopp.',
      'Gi høstgjødsel i september, før veksten stopper.',
    ),
    category: 'lawn',
    source: 'gardening',
    priority: 'low',
    season: 'autumn',
    recurrenceKind: 'annual',
    annualMonth: 9,
    annualDay: 1,
  },
  {
    seedKey: 'garden-robot-start',
    title: 'Robotklipper: vårklargjøring',
    description: wh(
      'Vårklargjøre robotklipperen.',
      'Riktig oppstart og vedlikehold gir lang levetid og god klipp gjennom hele sesongen.',
      'Om våren: rengjør, sjekk/bytt kniver, oppdater programvare, og kontroller begrensningskabel og ladestasjon.',
    ),
    category: 'lawn',
    source: 'gardening',
    priority: 'low',
    season: 'spring',
    recurrenceKind: 'annual',
    annualMonth: 4,
    annualDay: 15,
  },
  {
    seedKey: 'garden-robot-vinter',
    title: 'Robotklipper: vinterlagring',
    description: wh(
      'Vinterlagre robotklipperen.',
      'Frost og fukt skader batteri og elektronikk; god vinterlagring forlenger levetiden.',
      'Om høsten: rengjør, lad opp, og lagre klipper og ladestasjon tørt og frostfritt. Bytt eller slip kniver.',
    ),
    category: 'lawn',
    source: 'gardening',
    priority: 'low',
    season: 'autumn',
    recurrenceKind: 'annual',
    annualMonth: 10,
    annualDay: 15,
  },
  {
    seedKey: 'garden-lovrydding',
    title: 'Løvrydding',
    description: wh(
      'Rydde løv om høsten.',
      'Løv kveler plenen, tetter renner og sluk, og kan gi sopp; under epletreet bryter raking også skurvsmitten.',
      'Rak og fjern løv fra plen, bed, takrenner og sluk i okt/nov. Komposter friskt løv (ikke sykt).',
    ),
    category: 'garden',
    source: 'gardening',
    priority: 'low',
    season: 'autumn',
    recurrenceKind: 'annual',
    annualMonth: 11,
    annualDay: 1,
  },
  {
    seedKey: 'garden-ugras',
    title: 'Ugraskontroll i bed og belegningsstein',
    description: wh(
      'Ugraskontroll i bed og i belegningsstein.',
      'Ugras konkurrerer om næring og vann og sprer seg raskt; i fuger kan det løfte belegningsstein.',
      'Luk bed jevnlig gjennom vår/sommer, og fjern ugras + etterfyll fugesand i belegningsstein på gårdsplassen.',
    ),
    category: 'garden',
    source: 'gardening',
    priority: 'low',
    season: 'summer',
    recurrenceKind: 'annual',
    annualMonth: 6,
    annualDay: 1,
  },
];

// ── Seeding logic ────────────────────────────────────────────────────────────

export function seedMaintenance(db, now = Date.now(), tz = TZ) {
  ensureSchema(db);

  const upsert = db.prepare(`
    INSERT INTO maintenance_task
      (id, title, notes, recurrence_kind, interval_value, interval_unit, annual_month, annual_day,
       due_ts, enabled, description, category, source, priority, season, estimated_minutes, cost_estimate, seed_key)
    VALUES
      (@id, @title, NULL, @recurrence_kind, @interval_value, @interval_unit, @annual_month, @annual_day,
       @due_ts, 1, @description, @category, @source, @priority, @season, @estimated_minutes, @cost_estimate, @seed_key)
    ON CONFLICT(seed_key) DO UPDATE SET
      title = excluded.title,
      recurrence_kind = excluded.recurrence_kind,
      interval_value = excluded.interval_value,
      interval_unit = excluded.interval_unit,
      annual_month = excluded.annual_month,
      annual_day = excluded.annual_day,
      description = excluded.description,
      category = excluded.category,
      source = excluded.source,
      priority = excluded.priority,
      season = excluded.season,
      estimated_minutes = excluded.estimated_minutes,
      cost_estimate = excluded.cost_estimate
  `);
  const getBySeed = db.prepare(`SELECT id FROM maintenance_task WHERE seed_key = ?`);
  const countSubs = db.prepare(`SELECT COUNT(*) AS c FROM sub_task WHERE parent_id = ?`);
  const insSub = db.prepare(
    `INSERT INTO sub_task (id, parent_id, title, done, sort_order) VALUES (?, ?, ?, 0, ?)`,
  );

  const stats = { inserted: 0, updated: 0, pruned: 0, subTasksAdded: 0, total: SEED_TASKS.length };

  const run = db.transaction(() => {
    for (const t of SEED_TASKS) {
      const existing = getBySeed.get(t.seedKey);
      upsert.run({
        id: existing ? existing.id : randomUUID(),
        title: t.title,
        recurrence_kind: t.recurrenceKind,
        interval_value: t.intervalValue ?? null,
        interval_unit: t.intervalUnit ?? null,
        annual_month: t.annualMonth ?? null,
        annual_day: t.annualDay ?? null,
        // due_ts is only applied on first insert; preserved on conflict.
        due_ts: computeInitialDue(t, now, tz),
        description: t.description ?? null,
        category: t.category ?? null,
        source: t.source,
        priority: t.priority ?? null,
        season: t.season ?? null,
        estimated_minutes: t.estimatedMinutes ?? null,
        cost_estimate: t.costEstimate ?? null,
        seed_key: t.seedKey,
      });
      if (existing) stats.updated++;
      else stats.inserted++;

      // Sub-tasks (checklists) are only created on first seed so re-running
      // never duplicates them or wipes the user's tick state.
      if (t.subTasks?.length) {
        const parentId = (existing ?? getBySeed.get(t.seedKey)).id;
        if (countSubs.get(parentId).c === 0) {
          t.subTasks.forEach((title, i) => {
            insSub.run(randomUUID(), parentId, title, i);
            stats.subTasksAdded++;
          });
        }
      }
    }

    // Declarative prune: drop previously-seeded rows no longer in SEED_TASKS.
    // Only managed rows (seed_key set) are affected; manual tasks (NULL) stay.
    const wanted = new Set(SEED_TASKS.map((x) => x.seedKey));
    const orphans = db
      .prepare(`SELECT id, seed_key FROM maintenance_task WHERE seed_key IS NOT NULL`)
      .all()
      .filter((r) => !wanted.has(r.seed_key));
    for (const o of orphans) {
      db.prepare(`DELETE FROM sub_task WHERE parent_id = ?`).run(o.id);
      db.prepare(`DELETE FROM maintenance_task WHERE id = ?`).run(o.id);
      stats.pruned++;
    }
  });
  run();
  return stats;
}

// ── CLI entry ────────────────────────────────────────────────────────────────

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const dbPath = process.env.DB_PATH ?? './data/spa.db';
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const s = seedMaintenance(db);
  db.close();
  console.log(
    `[seed] ${s.inserted} inserted, ${s.updated} updated, ${s.pruned} pruned, ` +
      `${s.subTasksAdded} sub-tasks added (${s.total} seed tasks) → ${dbPath}`,
  );
}
