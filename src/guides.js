// Between how Claude writes the guides and how the AmplifAI tool stores them.
//
//   Claude:  { ordered: { intro: { text: {nl,en}, src }, tips: [{ text, src }], questions: [{ question, answers: [{ label, reply, next, src }] }] }, … }
//            with next as "next", "end" or the index of a later question
//   stored:  the same, plus an id on every question and answer, and next as "next", "end" or a question id
//   tool:    per language and moment exactly the tool's guideContentSchema (intro, tips: [string],
//            questions: [{ id, question, answers: [{ id, label, reply|null, next }] }]), and the sources
//            per text in `citations`, keyed by path: "ordered.intro", "ordered.tips.0", "ordered.questions.0.answers.1"
import crypto from 'node:crypto';
import { MOMENTS } from './ai.js';
import { SettingsError } from './settings.js';

const newId = () => crypto.randomUUID();

// next from Claude (an index) to a question id; anything that does not point forward becomes "next"
function nextId(next, index, questions) {
  if (next === 'next' || next === 'end') return next;
  const k = Number(next);
  return Number.isInteger(k) && k > index && k < questions.length ? questions[k].id : 'next';
}
// and back, for a revision: Claude sees indices, not ids
function nextIndex(next, questions) {
  if (next === 'next' || next === 'end') return next;
  const k = questions.findIndex(q => q.id === next);
  return k >= 0 ? k : 'next';
}

// Give every question and answer an id. `old` keeps the ids a piece already had, by position.
export function withIds(guide, old) {
  const questions = guide.questions.map((q, i) => ({
    id: old?.questions?.[i]?.id || newId(),
    question: q.question,
    answers: q.answers.map((a, j) => ({ id: old?.questions?.[i]?.answers?.[j]?.id || newId(), label: a.label, reply: a.reply, next: a.next, src: a.src || [] })),
  }));
  for (const [i, q] of questions.entries()) for (const a of q.answers) a.next = nextId(a.next, i, questions);
  return { intro: guide.intro, questions, tips: guide.tips };
}
export const contentWithIds = (content, old) => Object.fromEntries(MOMENTS.map(m => [m, withIds(content[m], old?.[m])]));

// The stored content as Claude reads it.
export function forClaude(content) {
  return Object.fromEntries(MOMENTS.map(m => {
    const g = content[m];
    return [m, { intro: g.intro, tips: g.tips, questions: g.questions.map(q => ({ question: q.question, answers: q.answers.map(a => ({ label: a.label, reply: a.reply, next: nextIndex(a.next, g.questions), src: a.src })) })) }];
  }));
}

// Put a rewritten piece in place, keeping its ids and, for one answer, where it leads.
export function placePiece(content, path, kind, piece) {
  const [m, , qi, , ai] = path.split('.');
  const g = content[m];
  if (kind === 'moment') content[m] = withIds(piece, g);
  else if (kind === 'intro') g.intro = piece;
  else if (kind === 'tip') g.tips[Number(path.split('.')[2])] = piece;
  else if (kind === 'question') {
    const old = g.questions[qi];
    const q = { id: old.id, question: piece.question, answers: piece.answers.map((a, j) => ({ id: old.answers[j]?.id || newId(), label: a.label, reply: a.reply, next: a.next, src: a.src || [] })) };
    q.answers.forEach(a => { a.next = nextId(a.next, Number(qi), g.questions) });
    g.questions[qi] = q;
  } else if (kind === 'answer') {
    const old = g.questions[qi].answers[ai];
    g.questions[qi].answers[ai] = { id: old.id, label: piece.label, reply: piece.reply, next: old.next, src: piece.src || [] };
  }
}

// The stored content as the tool stores it: per language, per moment.
export function toTool(content, langs) {
  const guides = {}, citations = {};
  for (const l of langs) {
    guides[l] = {};
    for (const m of MOMENTS) {
      const g = content[m];
      guides[l][m] = {
        intro: g.intro.text[l],
        tips: g.tips.map(t => t.text[l]),
        questions: g.questions.map(q => ({ id: q.id, question: q.question[l], answers: q.answers.map(a => ({ id: a.id, label: a.label[l], reply: a.reply?.[l] || null, next: a.next })) })),
      };
    }
  }
  for (const m of MOMENTS) {
    const g = content[m], put = (k, src) => { if (src?.length) citations[k] = src };
    put(`${m}.intro`, g.intro.src);
    g.tips.forEach((t, i) => put(`${m}.tips.${i}`, t.src));
    g.questions.forEach((q, i) => q.answers.forEach((a, j) => put(`${m}.questions.${i}.answers.${j}`, a.src)));
  }
  return { guides, citations };
}

// Back from the tool, e.g. after the shop edited a text: every language must have the same guides,
// questions and answers (same ids, same order), so the texts can be paired up again.
export function fromTool(guides, citations, langs) {
  const bad = msg => { throw new SettingsError('content.guides: ' + msg, 'content') };
  if (!guides || typeof guides !== 'object') bad('ontbreekt');
  const [first] = langs;
  const str = v => typeof v === 'string' ? v : bad('tekst verwacht');
  const txt = get => Object.fromEntries(langs.map(l => [l, get(guides[l]) ?? '']));
  const out = {};
  for (const m of MOMENTS) {
    for (const l of langs) if (!guides[l]?.[m]) bad(`${l}.${m} ontbreekt`);
    const base = guides[first][m];
    if (!Array.isArray(base.tips) || !Array.isArray(base.questions)) bad(`${first}.${m}: tips en questions zijn lijsten`);
    for (const l of langs) {
      const g = guides[l][m];
      if (g.tips?.length !== base.tips.length || g.questions?.length !== base.questions.length) bad(`${l}.${m} heeft andere aantallen dan ${first}.${m}`);
      g.questions.forEach((q, i) => { if (q.id !== base.questions[i].id || q.answers?.length !== base.questions[i].answers?.length) bad(`${l}.${m}.questions.${i} past niet bij ${first}`) });
    }
    out[m] = {
      intro: { text: txt(g => str(g[m].intro)), src: citations?.[`${m}.intro`] || [] },
      tips: base.tips.map((_, i) => ({ text: txt(g => str(g[m].tips[i])), src: citations?.[`${m}.tips.${i}`] || [] })),
      questions: base.questions.map((q, i) => ({
        id: String(q.id || bad(`${m}.questions.${i}.id ontbreekt`)),
        question: txt(g => str(g[m].questions[i].question)),
        answers: q.answers.map((a, j) => ({
          id: String(a.id || bad(`${m}.questions.${i}.answers.${j}.id ontbreekt`)),
          label: txt(g => str(g[m].questions[i].answers[j].label)),
          reply: txt(g => g[m].questions[i].answers[j].reply || ''),
          next: a.next,
          src: citations?.[`${m}.questions.${i}.answers.${j}`] || [],
        })),
      })),
    };
  }
  return out;
}
