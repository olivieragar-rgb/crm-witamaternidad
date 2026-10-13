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
