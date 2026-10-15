// Thin fetch helper for the CRM API.
//
// La sesion viaja en una cookie HttpOnly, asi que aqui no se guarda ningun
// token: basta con 'same-origin' para que el navegador la mande.
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Al caducar la sesion no sirve seguir pintando la vista: avisamos a la
// aplicacion para que vuelva al login.
const unauthorized = new Set();
export const onUnauthorized = (fn) => {
  unauthorized.add(fn);
  return () => unauthorized.delete(fn);
};

/**
 * @param {{ expireOn401?: boolean }} [opts]  Un 401 al intentar entrar no es
 *   una sesion caducada, es una contrasena mal escrita: ahi hay que enseniar
 *   el mensaje del servidor, no echar al usuario a la pantalla de acceso.
 */
async function req(method, url, body, { expireOn401 = true } = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && expireOn401) {
    for (const fn of unauthorized) fn();
    throw new ApiError('Se ha cerrado la sesión. Vuelve a entrar.', 401);
  }
  if (!res.ok) throw new ApiError(data.error || `Error ${res.status}`, res.status);
  return data;
}

export const api = {
  list: (resource, q = '') => req('GET', `/api/${resource}${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  get: (resource, id) => req('GET', `/api/${resource}/${id}`),
  create: (resource, body) => req('POST', `/api/${resource}`, body),
  update: (resource, id, body) => req('PUT', `/api/${resource}/${id}`, body),
  remove: (resource, id) => req('DELETE', `/api/${resource}/${id}`),
  dashboard: () => req('GET', '/api/dashboard'),

  setupStatus: () => req('GET', '/api/setup-status', undefined, { expireOn401: false }),
  setup: (body) => req('POST', '/api/auth/setup', body, { expireOn401: false }),
  login: (body) => req('POST', '/api/auth/login', body, { expireOn401: false }),
  logout: () => req('POST', '/api/auth/logout', {}, { expireOn401: false }),
  me: () => req('GET', '/api/auth/me', undefined, { expireOn401: false }),
  changePassword: (body) => req('POST', '/api/auth/password', body),
  emailInvoice: (id) => req('POST', `/api/invoices/${id}/email`, {}),

  // Facturas: el listado viene filtrado y paginado del servidor.
  invoices: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null),
    ).toString();
    return req('GET', `/api/invoices${qs ? `?${qs}` : ''}`);
  },
  issueInvoice: (id) => req('POST', `/api/invoices/${id}/issue`, {}),
  invoiceStatus: (id, body) => req('POST', `/api/invoices/${id}/status`, body),
  rectifyInvoice: (id, body) => req('POST', `/api/invoices/${id}/rectify`, body),
  voidInvoice: (id, body) => req('POST', `/api/invoices/${id}/void`, body),
  invoicePdfUrl: (id) => `/api/invoices/${id}/pdf`,
  invoicesPdfUrl: (ids) => `/api/invoices/pdf?ids=${ids.join(',')}`,

  settings: () => req('GET', '/api/settings'),
  saveSettings: (key, body) => req('PUT', `/api/settings/${key}`, body),

  // Privacidad
  exportClientUrl: (id) => `/api/clients/${id}/export`,
  anonymize: (id, body) => req('POST', `/api/clients/${id}/anonymize`, body),
  retention: () => req('GET', '/api/clients/retention'),
  audit: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null),
    ).toString();
    return req('GET', `/api/audit${qs ? `?${qs}` : ''}`);
  },

  // Recordatorios
  reminders: () => req('GET', '/api/reminders'),
  reminderPreview: (kind, id) => req('GET', `/api/reminders/preview/${kind}/${id}`),
  sendReminder: (kind, id) => req('POST', `/api/reminders/${kind}/${id}`, {}),

  // Gastos e impuestos
  expenses: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null),
    ).toString();
    return req('GET', `/api/expenses${qs ? `?${qs}` : ''}`);
  },
  createExpense: (body) => req('POST', '/api/expenses', body),
  updateExpense: (id, body) => req('PUT', `/api/expenses/${id}`, body),
  removeExpense: (id) => req('DELETE', `/api/expenses/${id}`),
  taxes: (year, quarter) => req('GET', `/api/taxes?year=${year}&quarter=${quarter}`),

  // Guardia alrededor de la FPP
  oncall: () => req('GET', '/api/oncall'),
  oncallConflicts: (dueDate, excludeId) =>
    req('GET', `/api/oncall/conflicts?dueDate=${encodeURIComponent(dueDate)}${excludeId ? `&excludeId=${excludeId}` : ''}`),

  calendarToken: (revoke) => req('POST', '/api/settings/calendar/token', { revoke: !!revoke }),

  catalogs: () => req('GET', '/api/catalogs'),
  addCatalog: (body) => req('POST', '/api/catalogs', body),
  updateCatalog: (id, body) => req('PUT', `/api/catalogs/${id}`, body),
  removeCatalog: (id) => req('DELETE', `/api/catalogs/${id}`),
};

export const eur = (n) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);

// Semanas de gestación a partir de la fecha probable de parto (FPP).
// Embarazo a término ≈ 40 semanas (280 días) contados hacia atrás desde la FPP.
export const gestWeeks = (dueDate) => {
  if (!dueDate) return null;
  const due = new Date(dueDate + 'T00:00:00');
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysToDue = Math.round((due - today) / 86400000);
  const totalDays = 280 - daysToDue; // días de gestación transcurridos
  if (totalDays < 0) return { label: 'Pre', weeks: 0, days: 0, past: false };
  const weeks = Math.floor(totalDays / 7);
  const days = totalDays % 7;
  const past = daysToDue < 0; // FPP ya pasada
  return { label: `${weeks}+${days}`, weeks, days, past };
};

export const fmtDate = (d) => {
  if (!d) return '';
  const iso = d.length > 10 ? d.replace(' ', 'T') : d + 'T00:00:00';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return d;
  const hasTime = d.length > 10;
  return date.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(hasTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
};
