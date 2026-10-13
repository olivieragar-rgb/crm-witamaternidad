// Thin fetch helper for the CRM API.
async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export const api = {
  list: (resource, q = '') => req('GET', `/api/${resource}${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  get: (resource, id) => req('GET', `/api/${resource}/${id}`),
  create: (resource, body) => req('POST', `/api/${resource}`, body),
  update: (resource, id, body) => req('PUT', `/api/${resource}/${id}`, body),
  remove: (resource, id) => req('DELETE', `/api/${resource}/${id}`),
  dashboard: () => req('GET', '/api/dashboard'),
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
