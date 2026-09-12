/**
 * Poda lo que crece sin techo y evita los barridos que no hacen falta.
 *
 * El proyecto vive en el plan gratis de Firestore, donde lo que se agota no
 * es tanto el espacio como las lecturas diarias. Dos cosas crecen solas: la
 * coleccion `runs`, que suma un documento por corrida para siempre, y el
 * barrido completo de `products` que busca huerfanos en cada corrida aunque
 * no haya ninguno.
 */
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS } from './persist.js';

/**
 * Corridas que se conservan.
 *
 * Con dos al dia son casi tres meses de historial, suficiente para mirar
 * atras cuando una tienda empieza a fallar y preguntarse desde cuando. El
 * panel solo lee la ultima.
 */
export const KEEP_RUNS = 180;

/**
 * Cada cuanto se barre `products` entero aunque nada sugiera que hay
 * huerfanos.
 *
 * Es la red de seguridad: si el panel se quedo a medias desligando productos
 * —se corto la conexion mientras borraba una busqueda—, nadie volveria a
 * mirarlos. Una vez por semana es barato y cierra ese hueco.
 */
export const FULL_SCAN_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

/** Documento donde el scraper anota que vio la ultima vez. */
const ORPHAN_SCAN_DOC = 'orphanScan';

/** Lo anotado tras el ultimo barrido. */
export interface OrphanScanState {
  /** Ids de busqueda que existian entonces. */
  searchIds: string[];
  lastFullScanAt: Date | null;
}

export interface ScanDecision {
  scan: boolean;
  /** Para el log: por que se barre, o por que no. */
  reason: string;
}

/**
 * Decide si toca barrer `products` buscando huerfanos.
 *
 * Un producto queda huerfano solo cuando el panel le quita su ultima
 * etiqueta, y eso pasa unicamente al borrar una busqueda: el scraper nunca
 * deja `searchIds` vacio, porque a un producto que no encontro ni siquiera lo
 * escribe. Asi que si la lista de busquedas no perdio ninguna, no hay nada
 * nuevo que limpiar y el barrido seria una lectura por producto a cambio de
 * cero borrados.
 *
 * Funcion pura para poder probar el calendario sin Firestore.
 */
export function decideOrphanScan(
  previous: OrphanScanState | null,
  currentSearchIds: readonly string[],
  now: Date,
  fullScanEveryMs: number = FULL_SCAN_EVERY_MS,
): ScanDecision {
  if (!previous) {
    return { scan: true, reason: 'primer barrido registrado' };
  }

  const current = new Set(currentSearchIds);
  const gone = previous.searchIds.filter((id) => !current.has(id));

  if (gone.length > 0) {
    return { scan: true, reason: `se borro/borraron ${gone.join(', ')}` };
  }

  const last = previous.lastFullScanAt;
  if (!last || now.getTime() - last.getTime() >= fullScanEveryMs) {
    return { scan: true, reason: 'barrido periodico de seguridad' };
  }

  return { scan: false, reason: 'ninguna busqueda desaparecio desde el ultimo barrido' };
}

/** Lee lo anotado en el ultimo barrido. */
export async function readOrphanScanState(db: Firestore): Promise<OrphanScanState | null> {
  const snapshot = await db.collection(COLLECTIONS.meta).doc(ORPHAN_SCAN_DOC).get();
  if (!snapshot.exists) return null;

  const data = snapshot.data() ?? {};
  const raw = data['lastFullScanAt'];

  return {
    searchIds: Array.isArray(data['searchIds']) ? (data['searchIds'] as string[]) : [],
    lastFullScanAt: raw instanceof Timestamp ? raw.toDate() : null,
  };
}

/** Anota que busquedas habia y, si se barrio, cuando. */
export async function writeOrphanScanState(
  db: Firestore,
  searchIds: readonly string[],
  scannedAt: Date | null,
  previous: OrphanScanState | null,
): Promise<void> {
  // Si esta vez no se barrio, se conserva la fecha anterior: es la que decide
  // cuando toca el barrido periodico.
  const lastFullScanAt = scannedAt ?? previous?.lastFullScanAt ?? null;

  await db
    .collection(COLLECTIONS.meta)
    .doc(ORPHAN_SCAN_DOC)
    .set({
      searchIds: [...searchIds].sort(),
      lastFullScanAt: lastFullScanAt ? Timestamp.fromDate(lastFullScanAt) : null,
    });
}

/**
 * Borra las corridas mas viejas, dejando las `keep` mas recientes.
 *
 * Se ordena por id y no por fecha porque el id *es* la fecha en formato
 * ordenable (`buildRunId`), asi la consulta no depende de ningun indice.
 */
export async function pruneRuns(db: Firestore, keep: number = KEEP_RUNS): Promise<number> {
  // Se piden solo los ids: el documento entero trae el resumen por tienda y
  // aca no se mira ningun campo.
  const snapshot = await db
    .collection(COLLECTIONS.runs)
    .orderBy('__name__', 'desc')
    .offset(keep)
    .select()
    .get();

  if (snapshot.empty) return 0;

  // `offset` no ahorra lecturas —Firestore igual cobra los saltados—, pero a
  // 180 documentos eso es ruido frente a mantener la coleccion acotada.
  let batch = db.batch();
  let ops = 0;

  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
    ops += 1;

    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();
  return snapshot.size;
}
