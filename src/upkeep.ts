import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateHypothesis, listHypotheses } from './analysis/hypotheses.ts';
import { standardMeasure } from './analysis/measures.ts';
import {
  ensureChampionIcons,
  ensureItemIcons,
  ensureMap,
  ensureRuneIcons,
  fetchChampionIndex,
} from './riot/assets.ts';
import {
  fetchChampions,
  fetchItems,
  fetchRunes,
  listVersions,
  versionForPatch,
} from './riot/ddragon.ts';
import { exposureOf } from './store/briefings.ts';
import { ASSETS_ROOT, type Db } from './store/db.ts';
import {
  catalogosCacheados,
  catalogVersions,
  hasCatalogForPatch,
  patchesInCache,
  saveChampions,
  saveItems,
  saveRunes,
} from './store/items.ts';

/**
 * Las tareas de mantenimiento, en un solo lugar y sin terminal.
 *
 * Antes cada una era un comando que había que acordarse de correr: `lol items` una vez por
 * parche, `lol assets` una vez a secas, `lol hip evaluar` cuando se te ocurriera. Un ritual que
 * depende de acordarse es un ritual que no se hace, y el costo no es cosmético — sin catálogo no
 * hay tiempos de ítem, sin imágenes el panel es texto, y sin evaluar el ledger el briefing previo
 * no puede mostrar nada (G-029).
 *
 * Así que viven acá, las corre el botón de sincronizar en cadena, y cada una es IDEMPOTENTE y
 * sabe sola cuánto le falta: preguntar "¿qué falta?" es una consulta local que no cuesta nada, y
 * bajar solo eso es lo que hace que se puedan correr siempre.
 *
 * Ninguna toca la API de Riot ni el rate limiter: Data Dragon es otro host y no pide key
 * (ADR-020), y la evaluación es aritmética local. Por eso pueden ser automáticas — el sync de
 * partidas, que sí gasta requests, sigue siendo un botón que él aprieta.
 */

export type UpkeepProgress = (hechas: number, total: number, detalle: string) => void;

export type ItemsResult = {
  bajados: number;
  yaEstaban: number;
  /** Parches jugados que Data Dragon no publica: esas partidas se quedan sin ítems, y se dice. */
  sinPublicar: string[];
};

/** Baja el catálogo de ítems de cada parche jugado que todavía no lo tenga. */
export async function bajarCatalogos(db: Db, onProgress?: UpkeepProgress): Promise<ItemsResult> {
  const patches = patchesInCache(db);
  const cacheados = catalogosCacheados(db);
  const have = {
    items: new Set(cacheados.items),
    runes: new Set(cacheados.runes),
    champions: new Set(cacheados.champions),
  };
  const result: ItemsResult = { bajados: 0, yaEstaban: 0, sinPublicar: [] };
  if (patches.length === 0) return result;

  const versions = await listVersions();
  let hechas = 0;
  for (const { patch } of patches) {
    const version = versionForPatch(versions, patch);
    hechas += 1;
    if (version === null) {
      // Nunca caer al catálogo más nuevo: el build path de un ítem cambia entre parches, así que
      // la tabla equivocada da una respuesta segura y errónea (G-015).
      result.sinPublicar.push(patch);
      continue;
    }
    // TRES tablas por parche, no una. Las otras dos entraron acá y no en un comando aparte
    // porque salen del mismo host, son inmutables por versión y no gastan un request de Riot ni
    // tocan el limiter: sumarlas cuesta un round trip por parche y ningún presupuesto.
    //
    // Las runas son la interesante: los perks están en cada partida de la caché desde el primer
    // sync y nada los leía, porque no había tabla que dijera qué significaba cada id. Eso es
    // ADR-004 funcionando como está escrito.
    const yaEstan =
      have.items.has(version) && have.runes.has(version) && have.champions.has(version);
    if (yaEstan) {
      result.yaEstaban += 1;
      continue;
    }
    onProgress?.(hechas, patches.length, `parche ${patch}`);
    if (!have.items.has(version)) saveItems(db, await fetchItems(version));
    if (!have.runes.has(version)) saveRunes(db, await fetchRunes(version));
    if (!have.champions.has(version)) saveChampions(db, await fetchChampions(version));
    result.bajados += 1;
  }
  return result;
}

export type AssetsResult = {
  bajadas: number;
  yaEstaban: number;
  sinArte: number;
  megas: number;
  /** null cuando no hay catálogo todavía: las imágenes de ítem salen de ahí. */
  bloqueado: string | null;
};

/** Baja los retratos, los íconos y el mapa que falten. Idempotente por existencia de archivo. */
export async function bajarImagenes(db: Db, onProgress?: UpkeepProgress): Promise<AssetsResult> {
  const vacio: AssetsResult = {
    bajadas: 0,
    yaEstaban: 0,
    sinArte: 0,
    megas: 0,
    bloqueado: null,
  };

  const newest = catalogVersions(db)[0]?.version;
  if (newest === undefined) {
    return {
      ...vacio,
      bloqueado: 'todavía no hay catálogo de ítems, así que no sé qué íconos bajar',
    };
  }

  const champions = (
    db.prepare('SELECT DISTINCT champion FROM participants ORDER BY champion').all() as Record<
      string,
      unknown
    >[]
  ).map((r) => String(r['champion']));
  const itemIds = (
    db
      .prepare('SELECT item_id FROM items WHERE version = ? ORDER BY item_id')
      .all(newest) as Record<string, unknown>[]
  ).map((r) => Number(r['item_id']));

  const version = (await listVersions())[0];
  if (version === undefined) return { ...vacio, bloqueado: 'Data Dragon no devolvió versiones' };

  onProgress?.(0, 3, 'campeones');
  const index = await fetchChampionIndex(version);
  const champs = await ensureChampionIcons(version, champions, index, ASSETS_ROOT);

  onProgress?.(1, 3, 'ítems');
  const items = await ensureItemIcons(version, itemIds, ASSETS_ROOT);

  // Sólo el slot 0: el panel muestra la keystone y nada más, así que bajar las otras sesenta
  // runas serían sesenta archivos que nadie mira.
  onProgress?.(2, 4, 'runas');
  const keystones = (
    db
      .prepare(
        'SELECT DISTINCT rune_id, icon FROM runes WHERE slot = 0 AND version = ? ORDER BY rune_id',
      )
      .all(newest) as Record<string, unknown>[]
  ).map((r) => ({ runeId: Number(r['rune_id']), icon: String(r['icon']) }));
  const runes = await ensureRuneIcons(keystones, ASSETS_ROOT);

  onProgress?.(3, 4, 'mapa');
  const map = await ensureMap(version, ASSETS_ROOT);
  onProgress?.(4, 4, 'listo');

  return {
    bajadas: champs.downloaded + items.downloaded + runes.downloaded + map.downloaded,
    yaEstaban: champs.skipped + items.skipped + runes.skipped + map.skipped,
    sinArte: champs.missing.length + items.missing.length + runes.missing.length,
    megas: (champs.bytes + items.bytes + runes.bytes + map.bytes) / 1024 / 1024,
    bloqueado: null,
  };
}

export type LedgerResult = { evaluadas: number; veredictos: Record<string, number> };

/**
 * Corre la evaluación de cada hipótesis viva y la appendea al ledger.
 *
 * Se llama después de un sync que trajo partidas, que es la única cadencia honesta: una
 * evaluación es una medición fechada contra las partidas posteriores al registro, así que sin
 * partidas nuevas repetirla solo agrega una fila idéntica. `insufficient_n` durante meses es la
 * respuesta correcta y no un error que haya que reintentar.
 */
export function evaluarLedger(db: Db, now: number = Date.now()): LedgerResult {
  const measure = standardMeasure(db);
  const result: LedgerResult = { evaluadas: 0, veredictos: {} };
  for (const h of listHypotheses(db)) {
    // La spec se pasa explícita para que un call site que se desvió falle fuerte (G-013).
    const evaluation = evaluateHypothesis(db, h.id, h.spec, measure, { now });
    result.evaluadas += 1;
    result.veredictos[evaluation.verdict] = (result.veredictos[evaluation.verdict] ?? 0) + 1;
  }
  return result;
}

// --------------------------------------------------------------------------- qué falta

export type Upkeep = {
  catalogos: { tengo: number; faltan: number; sinPublicar: string[] };
  imagenes: { campeones: number; items: number; mapa: boolean; faltanCampeones: number };
  ledger: { vivas: number; evaluadas: number; expuestas: number };
};

function contarArchivos(root: string, carpeta: string): number {
  const ruta = join(root, carpeta);
  if (!existsSync(ruta)) return 0;
  return readdirSync(ruta).filter((f) => f.endsWith('.png')).length;
}

/**
 * Qué está al día y qué no, sin bajar nada.
 *
 * Todo lo de acá es una consulta local. Es lo que deja que el panel muestre botones que dicen
 * cuánto falta en vez de botones que hay que apretar para averiguarlo.
 *
 * `root` se puede pasar por la misma razón que en `openDb` y `writeKey`: sin eso un test lee la
 * carpeta de arte REAL de la máquina y su resultado depende de si alguien bajó las imágenes
 * alguna vez, que es un test que miente en las dos direcciones.
 */
export function upkeepState(db: Db, root: string = ASSETS_ROOT): Upkeep {
  const patches = patchesInCache(db);
  const catalogos = catalogVersions(db);
  // Sin pedirle nada a Data Dragon, y con EL MISMO predicado que usa la lectura real: un prefijo
  // hecho a mano acá contestaría distinto que `catalogForPatch` para una versión de dos partes.
  const faltan = patches.filter((p) => !hasCatalogForPatch(db, p.patch));

  const champions = (
    db.prepare('SELECT DISTINCT champion FROM participants').all() as Record<string, unknown>[]
  ).map((r) => String(r['champion']));
  const enDisco = contarArchivos(root, 'champion');

  const vivas = listHypotheses(db);
  return {
    catalogos: {
      tengo: catalogos.length,
      faltan: faltan.length,
      // Nombrados, no contados: un parche que Data Dragon no publica es un hecho que hay que
      // poder ver, y el botón no lo va a resolver por más veces que se apriete.
      sinPublicar: faltan.map((p) => p.patch),
    },
    imagenes: {
      campeones: enDisco,
      items: contarArchivos(root, 'item'),
      mapa: existsSync(join(root, 'map', 'map11.png')),
      faltanCampeones: Math.max(0, champions.length - enDisco),
    },
    ledger: {
      vivas: vivas.length,
      evaluadas: vivas.filter((h) => evaluacionesDe(db, h.id) > 0).length,
      expuestas: vivas.filter((h) => exposureOf(db, h.id) !== null).length,
    },
  };
}

function evaluacionesDe(db: Db, id: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM hypothesis_evaluations WHERE hypothesis_id = ?')
    .get(id) as Record<string, unknown>;
  return Number(row['n']);
}
