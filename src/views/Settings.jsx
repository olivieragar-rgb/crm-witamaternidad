import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field } from '../components/ui.jsx';

const TABS = [
  { id: 'issuer', label: 'Datos fiscales' },
  { id: 'invoicing', label: 'Facturación' },
];

const ISSUER_FIELDS = [
  { key: 'name', label: 'Nombre o razón social', required: true },
  { key: 'taxId', label: 'NIF / CIF', required: true },
  { key: 'address', label: 'Dirección', required: true },
  { key: 'postalCode', label: 'Código postal' },
  { key: 'city', label: 'Población', required: true },
  { key: 'province', label: 'Provincia' },
  { key: 'country', label: 'País' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Teléfono' },
];

/** Ajustes del negocio. Solo para administradoras. */
export default function Settings() {
  const [tab, setTab] = useState('issuer');
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.settings().then((s) => {
      setSettings(s);
      setDraft(s);
    });
  }, []);

  if (!draft) return <p className="muted">Cargando…</p>;

  const set = (key, field) => (e) =>
    setDraft({ ...draft, [key]: { ...draft[key], [field]: e.target.value } });

  async function save(key) {
    setError('');
    try {
      const value = await api.saveSettings(key, draft[key]);
      setSettings({ ...settings, [key]: value });
      setDraft({ ...draft, [key]: value });
      setSaved(key);
      setTimeout(() => setSaved(''), 2500);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section>
      <div className="toolbar">
        <h1>Ajustes</h1>
      </div>

      <div className="filters">
        {TABS.map((t) => (
          <button key={t.id} className={'chip' + (tab === t.id ? ' active' : '')} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      {tab === 'issuer' && (
        <div className="panel">
          <p className="muted">
            Estos datos salen en todas tus facturas y son obligatorios para que sean válidas. Sin el nombre
            fiscal, el NIF, la dirección y la población no se puede emitir.
          </p>
          <div className="form-grid">
            {ISSUER_FIELDS.map((f) => (
              <Field key={f.key} label={f.label + (f.required ? ' *' : '')}>
                <input value={draft.issuer[f.key]} onChange={set('issuer', f.key)} />
              </Field>
            ))}
          </div>
          <SaveRow onSave={() => save('issuer')} saved={saved === 'issuer'} />
        </div>
      )}

      {tab === 'invoicing' && (
        <div className="panel">
          <p className="muted">
            Valores por defecto al crear una factura. Cada factura puede luego llevar los suyos.
          </p>
          <div className="form-grid">
            <Field label="Serie de las facturas">
              <input
                value={draft.invoicing.series}
                onChange={set('invoicing', 'series')}
                placeholder="(vacío: 2026-0001)"
              />
            </Field>
            <Field label="Serie de las rectificativas">
              <input value={draft.invoicing.rectifySeries} onChange={set('invoicing', 'rectifySeries')} />
            </Field>
            <Field label="IVA por defecto %">
              <input
                type="number"
                step="1"
                min="0"
                value={draft.invoicing.vatRate}
                onChange={set('invoicing', 'vatRate')}
              />
            </Field>
            <Field label="Retención de IRPF por defecto %">
              <input
                type="number"
                step="0.01"
                min="0"
                value={draft.invoicing.irpfRate}
                onChange={set('invoicing', 'irpfRate')}
              />
            </Field>
          </div>

          <Field label="Nota de exención de IVA">
            <textarea rows={3} value={draft.invoicing.exemptionNote} onChange={set('invoicing', 'exemptionNote')} />
          </Field>
          <p className="muted small">
            Sale en la factura cuando el IVA es cero. Si facturas servicios sanitarios exentos, este texto es
            obligatorio.
          </p>

          <Field label="Datos de pago (salen en la factura)">
            <textarea
              rows={2}
              value={draft.invoicing.paymentDetails}
              onChange={set('invoicing', 'paymentDetails')}
              placeholder="IBAN, Bizum…"
            />
          </Field>

          <Field label="Pie de la factura">
            <input value={draft.invoicing.footer} onChange={set('invoicing', 'footer')} />
          </Field>

          <SaveRow onSave={() => save('invoicing')} saved={saved === 'invoicing'} />
        </div>
      )}
    </section>
  );
}

function SaveRow({ onSave, saved }) {
  return (
    <div className="save-row">
      <button className="primary" onClick={onSave}>
        Guardar
      </button>
      {saved && <span className="saved-note">Guardado</span>}
    </div>
  );
}
