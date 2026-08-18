import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SearchDoc } from '../types.js';
import { useSearchAdmin } from '../hooks/useSearchAdmin.js';
import {
  deriveMatchRules,
  parseQueries,
  rulesToText,
  textToRules,
  toSearchId,
  validateDraft,
  type SearchDraft,
} from '../lib/searchRules.js';

interface Props {
  searches: SearchDoc[];
  counts: Map<string, number>;
  onClose: () => void;
}

type Mode = { kind: 'lista' } | { kind: 'edicion'; search: SearchDoc | null };

export function SearchManager({ searches, counts, onClose }: Props): ReactNode {
  const [mode, setMode] = useState<Mode>({ kind: 'lista' });
  const { saving, error, save, remove, clearError } = useSearchAdmin();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Administrar busquedas">
      <button type="button" className="modal__backdrop" onClick={onClose} aria-label="Cerrar" />

      <div className="modal__panel">
        <header className="modal__header">
          <div>
            <p className="modal__store">Monitoreo</p>
            <h2 className="modal__title">
              {mode.kind === 'lista'
                ? 'Búsquedas'
                : mode.search
                  ? `Editar "${mode.search.label}"`
                  : 'Nueva búsqueda'}
            </h2>
          </div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>

        <div className="modal__body">
          {error && (
            <div className="alert alert--error" role="alert">
              <span>{error}</span>
              <button type="button" className="alert__close" onClick={clearError} aria-label="Cerrar">
                ×
              </button>
            </div>
          )}

          {mode.kind === 'lista' ? (
            <SearchList
              searches={searches}
              counts={counts}
              saving={saving}
              onNew={() => setMode({ kind: 'edicion', search: null })}
              onEdit={(search) => setMode({ kind: 'edicion', search })}
              onToggle={(search) =>
                void save({
                  id: search.id,
                  label: search.label,
                  queries: search.queries,
                  match: search.match,
                  enabled: !search.enabled,
                })
              }
              onDelete={(search) => void remove(search.id)}
            />
          ) : (
            <SearchForm
              search={mode.search}
              saving={saving}
              onCancel={() => setMode({ kind: 'lista' })}
              onSubmit={async (draft) => {
                if (await save(draft, { create: mode.search === null })) setMode({ kind: 'lista' });
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SearchList({
  searches,
  counts,
  saving,
  onNew,
  onEdit,
  onToggle,
  onDelete,
}: {
  searches: SearchDoc[];
  counts: Map<string, number>;
  saving: boolean;
  onNew: () => void;
  onEdit: (search: SearchDoc) => void;
  onToggle: (search: SearchDoc) => void;
  onDelete: (search: SearchDoc) => void;
}): ReactNode {
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <>
      <p className="muted small">
        Cada búsqueda se consulta en todas las tiendas activas dos veces al día. Los cambios se
        aplican en la próxima corrida.
      </p>

      <ul className="search-list">
        {searches.map((search) => (
          <li key={search.id} className={search.enabled ? '' : 'is-disabled'}>
            <div className="search-list__main">
              <span className="search-list__label">{search.label}</span>
              <span className="muted small">
                {search.lastRunAt === null ? (
                  <span className="badge badge--pending">Pendiente de la primera corrida</span>
                ) : (
                  `${counts.get(search.id) ?? 0} productos`
                )}{' '}
                · {search.queries.length} término(s)
              </span>
              <span className="muted small search-list__queries">
                {search.queries.join(' · ')}
              </span>
            </div>

            <div className="search-list__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => onToggle(search)}
                disabled={saving}
              >
                {search.enabled ? 'Pausar' : 'Activar'}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => onEdit(search)}
                disabled={saving}
              >
                Editar
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm btn--danger"
                onClick={() => setConfirming(search.id)}
                disabled={saving}
              >
                Borrar
              </button>
            </div>

            {confirming === search.id && (
              <div className="confirm">
                <p className="small">
                  ¿Borrar <strong>{search.label}</strong>?
                </p>
                <div className="confirm__actions">
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => setConfirming(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--danger"
                    onClick={() => {
                      onDelete(search);
                      setConfirming(null);
                    }}
                  >
                    Borrar
                  </button>
                </div>
                <p className="muted small">
                  Sus productos se desligan de esta búsqueda. Los que también estén en otra se
                  conservan con su historial; el resto los limpia la próxima corrida.
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>

      <button type="button" className="btn btn--primary" onClick={onNew} disabled={saving}>
        + Nueva búsqueda
      </button>
    </>
  );
}

function SearchForm({
  search,
  saving,
  onCancel,
  onSubmit,
}: {
  search: SearchDoc | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (draft: SearchDraft) => void;
}): ReactNode {
  const [label, setLabel] = useState(search?.label ?? '');
  const [queriesText, setQueriesText] = useState((search?.queries ?? []).join('\n'));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rulesText, setRulesText] = useState(
    search ? rulesToText(search.match) : '',
  );
  const [excludeText, setExcludeText] = useState((search?.match.exclude ?? []).join(', '));
  // Se marca cuando el usuario toca las reglas, para dejar de autocompletarlas.
  const [rulesTouched, setRulesTouched] = useState(Boolean(search));

  // Mientras no las edite a mano, las reglas siguen al nombre.
  const derived = useMemo(() => deriveMatchRules(label), [label]);
  const effectiveRulesText = rulesTouched ? rulesText : rulesToText(derived);

  const draft: SearchDraft = {
    id: search?.id ?? toSearchId(label),
    label: label.trim(),
    queries: parseQueries(queriesText || label),
    match: textToRules(effectiveRulesText, excludeText),
    enabled: search?.enabled ?? true,
  };

  const validation = validateDraft(draft);

  return (
    <form
      className="search-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (validation.ok) onSubmit(draft);
      }}
    >
      <div className="field">
        <label className="field__label" htmlFor="label">
          Nombre
        </label>
        <input
          id="label"
          className="input"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Pañales"
          autoFocus
          maxLength={60}
        />
        <span className="field__hint">Como aparecerá la pestaña en el panel.</span>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="queries">
          Términos a buscar en las tiendas
        </label>
        <textarea
          id="queries"
          className="input"
          rows={3}
          value={queriesText}
          onChange={(event) => setQueriesText(event.target.value)}
          placeholder={label ? `${label}\n${label} pack` : 'pañales\npañales talla g'}
        />
        <span className="field__hint">
          Uno por línea. Si lo dejas vacío se usa el nombre. Cada término es una consulta por
          tienda, así que conviene ser específico.
        </span>
      </div>

      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => setShowAdvanced((prev) => !prev)}
      >
        {showAdvanced ? 'Ocultar filtros' : 'Ajustar filtros de relevancia'}
      </button>

      {showAdvanced && (
        <>
          <div className="field">
            <label className="field__label" htmlFor="rules">
              Palabras obligatorias
            </label>
            <textarea
              id="rules"
              className="input"
              rows={3}
              value={effectiveRulesText}
              onChange={(event) => {
                setRulesTouched(true);
                setRulesText(event.target.value);
              }}
            />
            <span className="field__hint">
              Una línea por requisito; las palabras de una misma línea son alternativas. El título
              del producto debe cumplir todas las líneas. Se rellena solo desde el nombre.
            </span>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="exclude">
              Palabras a excluir
            </label>
            <textarea
              id="exclude"
              className="input"
              rows={2}
              value={excludeText}
              onChange={(event) => setExcludeText(event.target.value)}
              placeholder="juguete, miniatura"
            />
            <span className="field__hint">
              Separadas por coma. Si el título contiene alguna, el producto se descarta.
            </span>
          </div>
        </>
      )}

      {!validation.ok && label.length > 0 && (
        <ul className="form-errors">
          {validation.errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      <div className="search-form__actions">
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button type="submit" className="btn btn--primary" disabled={saving || !validation.ok}>
          {saving ? 'Guardando…' : search ? 'Guardar cambios' : 'Crear búsqueda'}
        </button>
      </div>
    </form>
  );
}
