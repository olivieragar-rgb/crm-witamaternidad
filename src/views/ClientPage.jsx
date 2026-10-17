import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import ClientRecord from '../components/ClientRecord.jsx';
import QuestionnaireModal from '../components/QuestionnaireModal.jsx';
import ConsentSignModal from '../components/ConsentSignModal.jsx';
import { kindForService } from '../data/questionnaires.js';
import { useConfig } from '../config.jsx';

/**
 * La ficha de una clienta en su propia ventana (`/?ficha=<id>`): pantalla
 * completa, con sus secciones, para leerla y rellenarla con calma. Aloja los
 * cuadros del cuestionario y del consentimiento, que se abren encima.
 */
export default function ClientPage({ clientId }) {
  const config = useConfig();
  const [client, setClient] = useState(null);
  const [forms, setForms] = useState([]);
  const [formFor, setFormFor] = useState(null);
  const [signFor, setSignFor] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    const [c, f] = await Promise.all([api.get('clients', clientId), api.clientForms().catch(() => ({}))]);
    setClient(c);
    setForms(f[clientId] || []);
  }, [clientId]);
  useEffect(() => {
    load().catch(() => setClient(false));
  }, [load, refreshKey]);

  useEffect(() => {
    if (client) document.title = `${client.name} · Ficha`;
  }, [client]);

  // El cuestionario que le toca por su servicio, o el que ya tenga guardado.
  const kind = client ? kindForService(client.service) || forms[0]?.kind : null;
  const formState = kind ? { kind, status: forms.find((f) => f.kind === kind)?.status ?? null } : undefined;

  // Al cerrar la ventana la ficha se bloquea sola, porque el candado vive en ella.
  const closePage = () => {
    window.close();
    // Si no la abrió el programa (pestaña normal), no se deja cerrar: vuelta al listado.
    setTimeout(() => {
      window.location.href = '/';
    }, 150);
  };

  if (client === false) return <div className="boot">No se encontró esta ficha.</div>;
  if (!client) return <div className="boot">Cargando…</div>;

  return (
    <>
      <ClientRecord
        clientId={clientId}
        formState={formState}
        refreshKey={refreshKey}
        onClose={closePage}
        onChanged={() => setRefreshKey((k) => k + 1)}
        onQuestionnaire={(c, k) => setFormFor({ client: c, kind: k, startLocked: formState?.status === 'completo' })}
        onSign={setSignFor}
      />
      {signFor && (
        <ConsentSignModal
          clientName={signFor.name}
          consentText={config.privacy.consentText}
          consentVersion={config.privacy.consentVersion}
          onClose={() => setSignFor(null)}
          onSigned={async (signature) => {
            await api.consent(signFor.id, { action: 'grant', signature });
            setSignFor(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
      {formFor && (
        <QuestionnaireModal
          client={formFor.client}
          kind={formFor.kind}
          startLocked={formFor.startLocked}
          onClose={() => setFormFor(null)}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </>
  );
}
