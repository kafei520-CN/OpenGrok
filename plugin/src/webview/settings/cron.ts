import { CRON_INTERVALS, emptyCronDraft, parseHm, parseLocalDateTime, type CronDraft } from '../../chat/cronJobs';
import type { CronJob, CronKind } from '../../core/types';
import { post, tr, ui } from '../app';
import { button } from '../dom';
import { escapeHtml } from '../transcript/markdown';

let draft: CronDraft = emptyCronDraft();

export function cronNavRow(): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'settings-row settings-link';
  const copy = document.createElement('div');
  copy.className = 'settings-copy';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = tr('cronTitle');
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  const n = (ui.state.cronJobs ?? []).filter((job) => job.enabled).length;
  hint.textContent = n ? tr('cronEnabledCount', { n }) : tr('cronHint');
  copy.append(name, hint);
  row.append(copy);
  row.addEventListener('click', () => post({ type: 'openCron' }));
  return row;
}

export function mountCronBody(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cron-body';
  el.append(formBlock(), listBlock());
  return el;
}

function formBlock(): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'cron-form og-set-card settings-card';
  const h = document.createElement('h3');
  h.textContent = tr('cronNew');
  wrap.append(h, p(tr('cronHint')));
  wrap.append(labeled(tr('cronTitleField'), textInput(draft.title, (v) => { draft.title = v; })));
  wrap.append(labeled(tr('cronPrompt'), textarea(draft.prompt, (v) => { draft.prompt = v; })));
  wrap.append(
    labeled(
      tr('cronWhen'),
      select(
        [
          ['once', tr('cronOnce')],
          ['daily', tr('cronDaily')],
          ['weekly', tr('cronWeekly')],
          ['interval', tr('cronInterval')],
        ],
        draft.kind,
        (value) => {
          draft.kind = value as CronKind;
          if (draft.kind === 'once' && !parseLocalDateTime(draft.at)) {
            draft.at = defaultOnceAt();
          }
          if ((draft.kind === 'daily' || draft.kind === 'weekly') && !parseHm(draft.at)) {
            draft.at = '09:00';
          }
          wrap.replaceWith(formBlock());
        },
      ),
    ),
  );
  if (draft.kind === 'once') {
    wrap.append(
      labeled(
        tr('cronAt'),
        input('datetime-local', draft.at || defaultOnceAt(), (v) => {
          draft.at = v;
        }),
      ),
    );
  } else if (draft.kind === 'daily') {
    wrap.append(labeled(tr('cronTime'), input('time', hm(draft.at), (v) => { draft.at = hm(v); })));
  } else if (draft.kind === 'weekly') {
    wrap.append(
      labeled(
        tr('cronWeekday'),
        select(
          weekdayOptions(),
          String(draft.weekday),
          (value) => {
            draft.weekday = Number(value);
          },
        ),
      ),
    );
    wrap.append(labeled(tr('cronTime'), input('time', hm(draft.at), (v) => { draft.at = hm(v); })));
  } else {
    wrap.append(
      labeled(
        tr('cronEvery'),
        select(
          CRON_INTERVALS.map((row) => [String(row.ms), intervalLabel(row.id)]),
          String(draft.everyMs),
          (value) => {
            draft.everyMs = Number(value);
          },
        ),
      ),
    );
  }
  const save = button(tr('cronSave'), () => {
    post({
      type: 'addCronJob',
      title: draft.title,
      prompt: draft.prompt,
      kind: draft.kind,
      at: draft.at,
      weekday: draft.weekday,
      everyMs: draft.everyMs,
    });
    draft = emptyCronDraft();
  });
  wrap.append(save);
  return wrap;
}

function listBlock(): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'cron-list og-set-card settings-card';
  const h = document.createElement('h3');
  h.textContent = tr('cronList');
  wrap.append(h);
  const jobs = ui.state.cronJobs ?? [];
  if (!jobs.length) {
    wrap.append(p(tr('cronEmpty')));
    return wrap;
  }
  for (const job of jobs) {
    wrap.append(jobRow(job));
  }
  return wrap;
}

function jobRow(job: CronJob): HTMLElement {
  const row = document.createElement('div');
  row.className = 'cron-job';
  const head = document.createElement('div');
  head.className = 'cron-job-head';
  const copy = document.createElement('div');
  copy.className = 'cron-job-copy';
  copy.innerHTML = `<strong>${escapeHtml(job.title)}</strong><span>${escapeHtml(scheduleLabel(job))}</span><em>${escapeHtml(nextLabel(job))}</em>`;
  const sw = document.createElement('button');
  sw.type = 'button';
  sw.className = job.enabled ? 'switch on' : 'switch';
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', job.enabled ? 'true' : 'false');
  const knob = document.createElement('span');
  knob.className = 'knob';
  sw.append(knob);
  sw.addEventListener('click', () => post({ type: 'patchCronJob', id: job.id, enabled: !job.enabled }));
  head.append(copy, sw);
  const tools = document.createElement('div');
  tools.className = 'cron-job-tools og-set-actions';
  tools.append(
    button(tr('cronRunNow'), () => post({ type: 'runCronJob', id: job.id })),
    button(tr('cronDelete'), () => post({ type: 'deleteCronJob', id: job.id })),
  );
  const preview = document.createElement('p');
  preview.className = 'cron-job-prompt';
  preview.textContent = job.prompt;
  row.append(head, preview, tools);
  return row;
}

function scheduleLabel(job: CronJob): string {
  if (job.kind === 'once') {
    return tr('cronOnceAt', { at: job.at ?? '' });
  }
  if (job.kind === 'daily') {
    return tr('cronDailyAt', { at: job.at ?? '' });
  }
  if (job.kind === 'weekly') {
    return tr('cronWeeklyAt', { day: weekdayLabel(job.weekday ?? 0), at: job.at ?? '' });
  }
  const row = CRON_INTERVALS.find((item) => item.ms === job.everyMs);
  return tr('cronEveryLabel', { every: row ? intervalLabel(row.id) : String(job.everyMs ?? '') });
}

function nextLabel(job: CronJob): string {
  if (!job.enabled) {
    return tr('cronPaused');
  }
  if (!job.nextRunAt) {
    return tr('cronNoNext');
  }
  return tr('cronNext', { at: formatWhen(job.nextRunAt) });
}

function formatWhen(ms: number): string {
  const locale = ui.state.locale === 'zh-CN' ? 'zh-CN' : 'en';
  return new Date(ms).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function weekdayOptions(): Array<[string, string]> {
  return [0, 1, 2, 3, 4, 5, 6].map((day) => [String(day), weekdayLabel(day)]);
}

function weekdayLabel(day: number): string {
  const keys = ['cronSun', 'cronMon', 'cronTue', 'cronWed', 'cronThu', 'cronFri', 'cronSat'] as const;
  return tr(keys[day] ?? 'cronMon');
}

function intervalLabel(id: string): string {
  if (id === '15m') {
    return tr('cronEvery15m');
  }
  if (id === '1h') {
    return tr('cronEvery1h');
  }
  if (id === '6h') {
    return tr('cronEvery6h');
  }
  if (id === '12h') {
    return tr('cronEvery12h');
  }
  return tr('cronEvery1d');
}

function labeled(label: string, field: HTMLElement): HTMLElement {
  const row = document.createElement('label');
  row.className = 'cron-field';
  const name = document.createElement('span');
  name.textContent = label;
  row.append(name, field);
  return row;
}

function textInput(value: string, onChange: (value: string) => void): HTMLInputElement {
  return input('text', value, onChange);
}

function input(type: string, value: string, onChange: (value: string) => void): HTMLInputElement {
  const el = document.createElement('input');
  el.type = type;
  el.className = 'settings-field';
  el.value = value;
  el.addEventListener('input', () => onChange(el.value));
  return el;
}

function textarea(value: string, onChange: (value: string) => void): HTMLTextAreaElement {
  const el = document.createElement('textarea');
  el.className = 'settings-field cron-prompt';
  el.rows = 3;
  el.value = value;
  el.addEventListener('input', () => onChange(el.value));
  return el;
}

function select(options: Array<[string, string]>, current: string, onChange: (value: string) => void): HTMLSelectElement {
  const el = document.createElement('select');
  el.className = 'settings-field';
  for (const [id, label] of options) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    if (id === current) {
      opt.selected = true;
    }
    el.append(opt);
  }
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function p(text: string): HTMLParagraphElement {
  const el = document.createElement('p');
  el.className = 'og-set-copy settings-hint';
  el.textContent = text;
  return el;
}

function hm(value: string): string {
  const match = /(\d{1,2}):(\d{2})/.exec(value);
  if (!match) {
    return '09:00';
  }
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function defaultOnceAt(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
