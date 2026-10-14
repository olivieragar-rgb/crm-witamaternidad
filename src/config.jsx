import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

// Ajustes y catálogos del negocio, cargados una vez al entrar. Las vistas los
// leen de aquí en lugar de traer constantes escritas en el código.
const ConfigContext = createContext(null);

export function ConfigProvider({ children }) {
  const [config, setConfig] = useState(null);

  const reload = useCallback(async () => {
    const [settings, catalogs] = await Promise.all([api.settings(), api.catalogs()]);
    setConfig({ ...settings, catalogs: catalogs.values, catalogTypes: catalogs.types });
    return { ...settings, catalogs: catalogs.values };
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!config) return <div className="boot">Cargando…</div>;
  return <ConfigContext.Provider value={{ ...config, reload }}>{children}</ConfigContext.Provider>;
}

export const useConfig = () => useContext(ConfigContext);

/**
 * Opciones de un desplegable. Incluye siempre el valor que ya tenía el
 * registro, aunque esa opción se haya desactivado: desactivarla la quita de
 * los formularios nuevos, no reescribe lo que ya estaba guardado.
 *
 * @param {Array<{value:string, active:boolean}>} list
 * @param {string} current
 * @returns {string[]}
 */
export function options(list, current) {
  const values = (list || []).filter((o) => o.active).map((o) => o.value);
  if (current && !values.includes(current)) return [current, ...values];
  return values;
}

/** Hook de conveniencia: las opciones de un catálogo por su nombre. */
export function useOptions(type, current) {
  const config = useConfig();
  return options(config?.catalogs?.[type], current);
}
