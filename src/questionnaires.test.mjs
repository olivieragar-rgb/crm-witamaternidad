import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTIONNAIRES,
  KINDS,
  kindForService,
  visibleFields,
  computeStatus,
  sanitize,
  labelled,
} from './data/questionnaires.js';

test('hay dos cuestionarios y cada campo tiene lo que necesita para pintarse', () => {
  assert.deepEqual(KINDS, ['lactancia', 'parto']);
  for (const kind of KINDS) {
    const { label, fields } = QUESTIONNAIRES[kind];
    assert.ok(label, `${kind} necesita un nombre visible`);
    const ids = fields.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length, `${kind} tiene ids repetidos`);
    for (const f of fields) {
      assert.ok(f.label, `${f.id} sin etiqueta`);
      assert.ok(['text', 'textarea', 'number', 'date', 'select'].includes(f.type), `${f.id}: tipo ${f.type}`);
      if (f.type === 'select') assert.ok(f.options?.length, `${f.id} es select y no trae opciones`);
      if (f.type !== 'select') assert.equal(f.other, undefined, `${f.id}: "otro" solo tiene sentido en un select`);
    }
  }
});

test('el cuestionario de lactancia no vuelve a pedir lo que ya está en la ficha', () => {
  const ids = QUESTIONNAIRES.lactancia.fields.map((f) => f.id);
  assert.equal(ids.length, 13);
  for (const repetido of ['name', 'nombre', 'email', 'correo', 'phone']) {
    assert.ok(!ids.includes(repetido));
  }
  // La fecha del parto es la real, y no toca la FPP de la ficha.
  assert.ok(ids.includes('birthDate'));
});

test('el servicio decide el cuestionario, con tildes o sin ellas', () => {
  assert.equal(kindForService('Lactancia'), 'lactancia');
  assert.equal(kindForService('Consulta de lactancia online'), 'lactancia');
  assert.equal(kindForService('Hipnoparto / Preparación al parto'), 'parto');
  assert.equal(kindForService('PREPARACION AL PARTO'), 'parto');
  assert.equal(kindForService('Consulta online'), null);
  assert.equal(kindForService(''), null);
  assert.equal(kindForService(undefined), null);
  // Si el servicio nombra los dos, manda la lactancia.
  assert.equal(kindForService('Lactancia y preparación al parto'), 'lactancia');
});

test('en el primer parto no se pregunta por los anteriores', () => {
  const primero = { birthNumber: 'Primero' };
  const ids = visibleFields('parto', primero).map((f) => f.id);
  assert.ok(!ids.includes('previousBirths'));
  assert.ok(!ids.includes('previousCountry'));

  const segundo = { birthNumber: 'Segundo' };
  const ids2 = visibleFields('parto', segundo).map((f) => f.id);
  assert.ok(ids2.includes('previousBirths'));
  assert.ok(ids2.includes('previousCountry'));
});

test('un campo oculto no deja el cuestionario pendiente', () => {
  // Primer parto: basta con el número de parto y la semana de gestación.
  assert.equal(computeStatus('parto', { birthNumber: 'Primero', gestWeeks: '32' }), 'completo');
  // Segundo parto: ahora sí faltan los anteriores.
  assert.equal(computeStatus('parto', { birthNumber: 'Segundo', gestWeeks: '32' }), 'pendiente');
  assert.equal(
    computeStatus('parto', {
      birthNumber: 'Segundo',
      gestWeeks: '32',
      previousBirths: 'Cesárea de urgencia',
      previousCountry: 'Francia',
    }),
    'completo',
  );
});

test('vacío está pendiente y los espacios no cuentan como respuesta', () => {
  assert.equal(computeStatus('lactancia', {}), 'pendiente');
  assert.equal(computeStatus('parto', { birthNumber: '   ', gestWeeks: '32' }), 'pendiente');
});

test('sanitize descarta lo que no es una pregunta del cuestionario', () => {
  const out = sanitize('parto', {
    birthNumber: 'Primero',
    gestWeeks: ' 32 ',
    extra: '',
    inventado: 'x',
    status: 'completo',
  });
  assert.deepEqual(out, { birthNumber: 'Primero', gestWeeks: '32' });
});

test('sanitize olvida las respuestas de los campos que se han ocultado', () => {
  const out = sanitize('parto', {
    birthNumber: 'Primero',
    gestWeeks: '32',
    previousBirths: 'quedó de cuando puso "Segundo"',
  });
  assert.equal(out.previousBirths, undefined);
});

test('labelled devuelve la pregunta en texto, para el export', () => {
  const filas = labelled('parto', { birthNumber: 'Primero', gestWeeks: '32' });
  assert.deepEqual(filas[0], { pregunta: '¿Qué parto es?', respuesta: 'Primero' });
  // Las preguntas sin responder salen igualmente: el export dice qué se preguntó.
  assert.ok(filas.some((f) => f.pregunta === 'Datos adicionales' && f.respuesta === ''));
  // Las ocultas no.
  assert.ok(!filas.some((f) => f.pregunta.includes('partos anteriores')));
});
