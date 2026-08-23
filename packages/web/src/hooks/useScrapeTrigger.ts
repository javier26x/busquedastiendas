import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { getDb } from '../firebase.js';

/**
 * Lanza una corrida del scraper a demanda, sin esperar al cron.
 *
 * El scraper corre en GitHub Actions, asi que "actualizar ahora" es disparar
 * su workflow (`workflow_dispatch`). Eso necesita un token de GitHub, y el
 * sitio es publico: el token NO puede ir en el bundle. Vive en Firestore, en
 * un documento que las reglas solo dejan leer al correo autorizado, y se lee
 * recien despues del login. Nunca toca el codigo ni el repositorio.
 *
 * Tras disparar, se sondea la lista de corridas para reflejar el estado. Los
 * datos del panel se actualizan solos por los listeners de Firestore cuando
 * la corrida termina de escribir.
 */

interface GithubConfig {
  token: string;
  owner: string;
  repo: string;
  /** Archivo del workflow, ej: "scrape.yml". */
  workflow: string;
  /** Rama sobre la que corre, ej: "main". */
  ref: string;
}

export type ScrapeState =
  | { kind: 'idle' }
  | { kind: 'dispatching' }
  | { kind: 'running'; url: string | null }
  | { kind: 'done'; url: string | null }
  | { kind: 'error'; message: string; needsSetup: boolean };

const GH = 'https://api.github.com';
const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

/** Cada cuanto se pregunta a GitHub por el estado de la corrida. */
const POLL_MS = 5000;
/** Techo de sondeo: una corrida larga ronda los 15 min; 25 da margen. */
const POLL_MAX_MS = 25 * 60 * 1000;

interface Trigger {
  state: ScrapeState;
  /** true mientras hay una corrida en curso: sirve para deshabilitar el boton. */
  busy: boolean;
  run: () => Promise<void>;
  reset: () => void;
}

export function useScrapeTrigger(): Trigger {
  const [state, setState] = useState<ScrapeState>({ kind: 'idle' });

  // El sondeo se cancela al desmontar o al empezar uno nuevo, para no dejar
  // timers colgando ni pisar el estado de una corrida por otra.
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cancelled.current = true;
      stopPolling();
    };
  }, [stopPolling]);

  // Se define antes que `run` porque este la llama: asi la dependencia es
  // explicita y no una referencia hacia adelante.
  const poll = useCallback(
    async (config: GithubConfig, since: number, startedAt: number): Promise<void> => {
      if (cancelled.current) return;

      // GitHub tarda un momento en registrar la corrida disparada; hasta que
      // aparece se muestra "running" sin enlace y se sigue preguntando.
      const found = await findRun(config, since).catch(() => null);

      if (found?.completed) {
        setState({ kind: 'done', url: found.url });
        return;
      }

      if (found) setState({ kind: 'running', url: found.url });

      if (Date.now() - startedAt > POLL_MAX_MS) {
        // No se declara fracaso: la corrida puede seguir viva en GitHub. Se
        // deja de seguir y el enlace permite verla alli.
        setState({ kind: 'done', url: found?.url ?? null });
        return;
      }

      pollTimer.current = setTimeout(() => void poll(config, since, startedAt), POLL_MS);
    },
    [],
  );

  const run = useCallback(async () => {
    stopPolling();
    cancelled.current = false;
    setState({ kind: 'dispatching' });

    let config: GithubConfig;
    try {
      config = await loadConfig();
    } catch (error) {
      setState({ kind: 'error', message: describe(error), needsSetup: error instanceof SetupError });
      return;
    }

    const since = Date.now();

    try {
      const res = await fetch(
        `${GH}/repos/${config.owner}/${config.repo}/actions/workflows/${config.workflow}/dispatches`,
        {
          method: 'POST',
          headers: { ...GH_HEADERS, Authorization: `Bearer ${config.token}` },
          body: JSON.stringify({ ref: config.ref }),
        },
      );

      if (!res.ok) {
        setState({ kind: 'error', message: await dispatchError(res), needsSetup: false });
        return;
      }
    } catch (error) {
      setState({ kind: 'error', message: describe(error), needsSetup: false });
      return;
    }

    setState({ kind: 'running', url: null });
    void poll(config, since, since);
  }, [stopPolling, poll]);

  const reset = useCallback(() => {
    stopPolling();
    setState({ kind: 'idle' });
  }, [stopPolling]);

  const busy = state.kind === 'dispatching' || state.kind === 'running';

  return { state, busy, run, reset };
}

/** Marca los errores de configuracion, que piden setup en vez de reintento. */
class SetupError extends Error {}

async function loadConfig(): Promise<GithubConfig> {
  // Un permission-denied aca lo traduce describe(): significa que el correo no
  // esta autorizado, no que falte configurar el disparo.
  const snapshot = await getDoc(doc(getDb(), 'config', 'github'));

  if (!snapshot.exists()) {
    throw new SetupError('Falta configurar el disparo. Corre scripts/set-github-token.sh una vez.');
  }

  const data = snapshot.data();
  const config: GithubConfig = {
    token: str(data['token']),
    owner: str(data['owner']),
    repo: str(data['repo']),
    workflow: str(data['workflow']) || 'scrape.yml',
    ref: str(data['ref']) || 'main',
  };

  if (!config.token || !config.owner || !config.repo) {
    throw new SetupError('La configuracion de GitHub esta incompleta (token, owner o repo).');
  }

  return config;
}

interface FoundRun {
  url: string;
  completed: boolean;
}

/** Ubica la corrida disparada por nosotros y devuelve su estado y enlace. */
async function findRun(config: GithubConfig, since: number): Promise<FoundRun | null> {
  const res = await fetch(
    `${GH}/repos/${config.owner}/${config.repo}/actions/workflows/${config.workflow}` +
      `/runs?event=workflow_dispatch&per_page=5`,
    { headers: { ...GH_HEADERS, Authorization: `Bearer ${config.token}` } },
  );
  if (!res.ok) return null;

  const body = (await res.json()) as { workflow_runs?: GithubRun[] };
  const runs = body.workflow_runs ?? [];

  // La que se creo desde que apretamos el boton. El margen cubre el pequeno
  // desfase de reloj entre el navegador y GitHub.
  const mine = runs.find((r) => Date.parse(r.created_at) >= since - 60_000);
  if (!mine) return null;

  return { url: mine.html_url, completed: mine.status === 'completed' };
}

interface GithubRun {
  html_url: string;
  created_at: string;
  status: string;
}

async function dispatchError(res: Response): Promise<string> {
  const detail = await res.text().catch(() => '');
  const hint =
    res.status === 401
      ? 'el token no es valido o expiro'
      : res.status === 403
        ? 'al token le falta permiso de Actions (write) sobre el repositorio'
        : res.status === 404
          ? 'no se encontro el workflow o la rama (revisa owner, repo, workflow y ref)'
          : detail.slice(0, 140) || 'error desconocido';
  return `GitHub respondio ${res.status}: ${hint}`;
}

function describe(error: unknown): string {
  if (error instanceof SetupError) return error.message;
  const code = (error as { code?: string }).code;
  if (code === 'permission-denied') return 'Tu cuenta no puede leer la configuracion del disparo.';
  return error instanceof Error ? error.message : 'No se pudo lanzar la corrida.';
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
