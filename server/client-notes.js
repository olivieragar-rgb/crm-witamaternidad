// Notas de la ficha de una clienta: un historial con fecha y autora.
//
// Lo que se anota aquí son datos de salud en la práctica (cómo va el embarazo,
// la lactancia...), así que, como las fichas, leerlas y cambiarlas queda en el
// registro de accesos. Las rutas se auditan solas y por eso van antes del
// middleware genérico de /api/clients.
import express from 'express';
import { all, get, run } from './db.js';
import { audit } from './auth.js';

export const clientNotesRouter = express.Router();

async function clientOr404(req, res) {
  const id = Number(req.params.id);
  const client = Number.isInteger(id) ? await get('SELECT id, anonymizedAt FROM clients WHERE id = ?', [id]) : null;
  if (!client) {
    res.status(404).json({ error: 'No encontrada' });
    return null;
  }
  return client;
}

clientNotesRouter.get('/:id/notes', async (req, res, next) => {
  try {
    const client = await clientOr404(req, res);
    if (!client) return;
    const rows = await all('SELECT * FROM client_notes WHERE clientId = ? ORDER BY createdAt DESC, id DESC', [client.id]);
    await audit(req, { action: 'client_notes_view', entity: 'clients', entityId: client.id });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

clientNotesRouter.post('/:id/notes', async (req, res, next) => {
  try {
    const client = await clientOr404(req, res);
    if (!client) return;
    if (client.anonymizedAt) {
      return res.status(409).json({ error: 'Esta ficha está anonimizada, así que ya no se le pueden añadir notas' });
    }
    const text = String(req.body?.text ?? '').trim();
    if (!text) return res.status(400).json({ error: 'Escribe la nota' });
    if (text.length > 5000) return res.status(400).json({ error: 'La nota es demasiado larga' });
    const info = await run('INSERT INTO client_notes (clientId, text, author) VALUES (?, ?, ?)', [
      client.id,
      text,
      req.user?.name || req.user?.email || '',
    ]);
    await audit(req, { action: 'client_note_add', entity: 'clients', entityId: client.id, detail: String(info.lastInsertRowid) });
    res.status(201).json(await get('SELECT * FROM client_notes WHERE id = ?', [info.lastInsertRowid]));
  } catch (e) {
    next(e);
  }
});

clientNotesRouter.put('/:id/notes/:noteId', async (req, res, next) => {
  try {
    const client = await clientOr404(req, res);
    if (!client) return;
    const noteId = Number(req.params.noteId);
    const note = await get('SELECT * FROM client_notes WHERE id = ? AND clientId = ?', [noteId, client.id]);
    if (!note) return res.status(404).json({ error: 'Nota no encontrada' });
    const text = String(req.body?.text ?? '').trim();
    if (!text) return res.status(400).json({ error: 'La nota no puede quedar vacía' });
    if (text.length > 5000) return res.status(400).json({ error: 'La nota es demasiado larga' });
    await run("UPDATE client_notes SET text = ?, updatedAt = datetime('now') WHERE id = ?", [text, noteId]);
    await audit(req, { action: 'client_note_edit', entity: 'clients', entityId: client.id, detail: String(noteId) });
    res.json(await get('SELECT * FROM client_notes WHERE id = ?', [noteId]));
  } catch (e) {
    next(e);
  }
});

clientNotesRouter.delete('/:id/notes/:noteId', async (req, res, next) => {
  try {
    const client = await clientOr404(req, res);
    if (!client) return;
    const noteId = Number(req.params.noteId);
    const info = await run('DELETE FROM client_notes WHERE id = ? AND clientId = ?', [noteId, client.id]);
    if (info.changes === 0) return res.status(404).json({ error: 'Nota no encontrada' });
    await audit(req, { action: 'client_note_delete', entity: 'clients', entityId: client.id, detail: String(noteId) });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
