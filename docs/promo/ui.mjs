// HTML mocks of the plugin UI. Labels and layout follow client/*.tsx; prompts are sample data.
import { icons } from './icons.mjs';

export const ic = (name, size = 16) =>
  `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;

export const githubMark = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

export const prompts = [
  { title: 'Code review', folder: 'engineering/security', description: 'Review a diff for bugs, security issues, and missing tests.', time: '2h ago', tags: ['review', 'security'] },
  { title: 'Release notes', folder: 'writing', description: 'Turn merged pull requests into user-facing release notes.', time: '1d ago', tags: ['writing', 'release'] },
  { title: 'Bug triage', folder: 'engineering', description: 'Reproduce, isolate, and rank a bug report.', time: '3d ago', tags: ['debugging'] },
  { title: 'Test plan', folder: 'engineering', description: 'List the cases a change needs before it ships.', time: '5d ago', tags: ['testing', 'qa', 'review', 'ci'] },
  { title: 'Commit message', folder: '', description: 'Summarize staged changes in one subject line and a short body.', time: '9/12/2026', tags: ['git'] },
];

export const codeReview = `# Code review

Review the staged diff as a senior engineer.

## Check
- Correctness and edge cases
- Security: input validation, secrets, auth
- Missing or weak tests

## Report
List each finding with file:line, severity,
and a one-line fix. Skip style nits.`;

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const highlight = (markdown) => escape(markdown).split('\n')
  .map((line) => line.startsWith('#') ? `<span class="h">${line}</span>` : line.startsWith('- ') ? `<span class="b">-</span>${line.slice(1)}` : line)
  .join('\n');
const words = (text) => text.trim().split(/\s+/).length;
export const previewLines = (markdown) => markdown.split('\n').filter((line) => line.trim() && !line.startsWith('# ')).slice(0, 4).map((line) => line.replace(/^#+\s*|^-\s*/, '')).join('\n');

export function tabbar(title) {
  return `<div class="tabbar"><div class="lights"><i></i><i></i><i></i></div><div class="tab">${ic('notebook-pen', 15)}<span>${title}</span></div></div>`;
}

export function header() {
  return `<div class="hstack" style="justify-content:space-between">
    <div class="hstack"><div class="logo-box">${ic('notebook-pen', 18)}</div>
      <div><div class="h-title">Prompts</div><div class="muted">Save instructions and send them to this agent.</div></div></div>
    <div class="hstack" style="gap:6px"><span class="btn primary">${ic('plus')}New prompt</span><span class="btn ghost">${ic('upload')}Import</span><span class="iconbtn">${ic('settings')}</span></div>
  </div>`;
}

function promptRow(prompt, selected) {
  const shown = prompt.tags.slice(0, 3);
  const extra = prompt.tags.length - shown.length;
  return `<div class="row${selected ? ' sel' : ''}">
    <div class="t ellipsis">${prompt.title}</div>
    <div class="d">${prompt.description}</div>
    <div class="hstack" style="gap:6px"><span class="meta">${ic('folder', 11)}${prompt.folder || 'Root'}</span><span class="tiny">·</span><span class="meta">${prompt.time}</span></div>
    <div class="tags">${shown.map((tag) => `<span class="tag">#${tag}</span>`).join('')}${extra > 0 ? `<span class="tiny">+${extra}</span>` : ''}</div>
  </div>`;
}

export function sidebar({ count = 12, rows = 4 } = {}) {
  return `<div class="vstack" style="width:300px;flex:none">
    <div class="input">${ic('search', 15)}<span class="placeholder">Search titles, tags, content…</span></div>
    <div class="hstack" style="gap:6px"><span class="chip">${ic('folder', 12)}All folders</span><span class="chip">${ic('archive', 12)}Archived</span><span class="grow"></span><span class="iconbtn" style="width:30px;height:30px">${ic('refresh-cw', 14)}</span></div>
    <div class="label">${count} prompts</div>
    <div class="vstack" style="gap:6px">${prompts.slice(0, rows).map((prompt, index) => promptRow(prompt, index === 0)).join('')}</div>
  </div>`;
}

export function versionHistory() {
  const versions = [
    { n: 3, when: '2h ago · latest', stamp: '10/5/2026, 9:14:00 AM' },
    { n: 2, when: '9/9/2026', stamp: '9/9/2026, 12:05:00 PM' },
    { n: 1, when: '9/9/2026', stamp: '9/9/2026, 12:00:00 PM' },
  ];
  const v1 = codeReview.split('\n').slice(0, 7).join('\n');
  return `<div class="card" style="width:320px;flex:none;display:flex;flex-direction:column;overflow:hidden">
    <div class="hstack" style="padding:8px 6px 8px 12px;border-bottom:1px solid var(--bd)"><span style="color:var(--ac)">${ic('history', 15)}</span><span class="strong grow" style="font-size:13px">Version history</span><span class="muted">3</span><span class="iconbtn" style="width:28px;height:28px">${ic('x', 13)}</span></div>
    <div class="vstack" style="padding:8px;gap:8px">
      ${versions.map((version) => `<div class="ver${version.n === 1 ? ' sel' : ''}"><span class="n">v${version.n}</span><div class="grow"><div style="font-size:13px">${version.when}</div><div class="tiny">${version.stamp}</div></div><span class="muted">${ic('chevron-right', 14)}</span></div>`).join('')}
      <div class="vstack" style="padding-top:8px;border-top:1px solid var(--bd)">
        <div class="hstack" style="justify-content:space-between;flex-wrap:wrap"><div class="seg"><span class="on">${ic('code', 13)}Source</span><span>${ic('eye', 13)}Preview</span></div><span class="btn sm primary">${ic('rotate-ccw', 14)}Restore as new version</span></div>
        <div class="tags"><span class="chip">${ic('hash', 12)}review</span></div>
        <div class="code" style="font-size:12px;line-height:19px;background:var(--s0);padding:12px;white-space:pre-wrap">${highlight(v1)}</div>
      </div>
    </div>
  </div>`;
}

export function editor({ history = false, expanded = false } = {}) {
  return `<div class="vstack grow">
    <div class="hstack">
      ${expanded ? `<span class="iconbtn">${ic('arrow-left')}</span>` : ''}<div class="grow"><div style="font-size:18px;font-weight:700">Code review</div>
        <div class="hstack" style="gap:6px"><span class="dot"></span><span class="muted">Saved</span><span class="muted ellipsis">· engineering/security/code-review.md · 2h ago</span></div></div>
      <div class="seg"><span class="on">${ic('pencil', 13)}Edit</span><span>${ic('eye', 13)}Preview</span></div><span class="iconbtn${expanded ? ' active' : ''}"${expanded ? ' style="background:var(--s2);border-color:var(--bd);color:var(--ac)"' : ''}>${ic(expanded ? 'minimize-2' : 'maximize-2')}</span>
    </div>
    <div class="hstack" style="gap:6px"><span class="btn primary dim">${ic('check')}Saved</span><span class="btn ghost${history ? ' active' : ''}">${ic('history')}History</span><span class="btn">${ic('send')}Send to agent</span><span class="grow"></span><span class="iconbtn danger">${ic('archive')}</span></div>
    ${expanded ? '' : `<div class="card hstack" style="padding:9px 12px"><span class="muted">${ic('chevron-right', 15)}</span><span class="strong" style="font-size:13px">Details</span><span class="muted ellipsis">engineering/security · 2 tags · described</span></div>`}
    <div class="hstack" style="align-items:stretch;gap:10px">
      <div class="vstack grow" style="gap:6px"><div class="code">${highlight(codeReview)}</div><div class="tiny">${words(codeReview)} words · ${codeReview.length} characters</div></div>
      ${history ? versionHistory() : ''}
    </div>
  </div>`;
}

export function library({ history = false, rows = 4 } = {}) {
  return `<div class="panel">${header()}<div class="hstack" style="align-items:flex-start;gap:20px">${sidebar({ rows })}${editor({ history })}</div></div>`;
}

export function picker() {
  const results = prompts.slice(0, 3).map((prompt, index) => ({ ...prompt, preview: index === 0 ? previewLines(codeReview) : prompt.description }));
  return `<div class="popover" style="width:300px">
    <div class="input" style="padding:7px 12px;font-size:13px">review</div>
    ${results.slice(0, 2).map((result, index) => `<div class="result${index === 0 ? ' hover' : ''}"><div class="hstack" style="gap:6px"><span class="strong grow ellipsis" style="font-size:13px">${result.title}</span><span class="muted">${ic('send', 12)}</span></div><div class="p">${result.preview}</div></div>`).join('')}
  </div>`;
}

export function composer() {
  return `<div class="composer">
    <div class="placeholder" style="font-size:15px">Message the agent, tag @files, or use /commands and /skills</div>
    <div class="hstack" style="gap:16px;color:var(--mu);font-size:14px">${ic('plus', 18)}<span>Opus 5.5</span><span>Medium</span><span>Always ask</span><span class="grow"></span></div>
  </div>`;
}

export function agentChat() {
  return `<div class="panel" style="gap:16px;padding:24px 28px">
    <div class="bubble">Review the payment retry change before I merge it.</div>
    <div style="padding:4px 2px;line-height:1.6">Found 2 issues in <span class="mono">retry.ts</span>: the backoff ignores <span class="mono">maxAttempts</span>, and the new branch has no test.</div>
    <div style="margin-top:12px">${picker()}</div>
    <div class="hstack"><span class="cpill open">${ic('notebook-pen', 14)}Prompts</span></div>
    ${composer()}
  </div>`;
}

function sectionTitle(title, subtitle, icon) {
  return `<div class="hstack" style="gap:10px">${icon ? `<span style="color:var(--ac)">${ic(icon, 18)}</span>` : ''}<div class="grow"><div style="font-size:17px;font-weight:600">${title}</div><div class="muted" style="line-height:17px">${subtitle}</div></div></div>`;
}

function field(label, body, hint = '') {
  return `<div class="vstack" style="gap:6px"><div class="strong" style="font-size:13px">${label}</div>${body}${hint ? `<div class="muted" style="line-height:17px">${hint}</div>` : ''}</div>`;
}

export function importView() {
  return `<div class="panel" style="gap:16px">
    <div class="hstack" style="gap:10px"><span class="iconbtn">${ic('arrow-left', 16)}</span>${sectionTitle('Import prompts', 'Copy Markdown files into the library with a first saved version. Source files stay in place.')}</div>
    ${field('Destination folder', `<div class="input">${ic('folder-input', 15)}<span>engineering</span></div>`)}
    <div class="card vstack" style="padding:14px;gap:12px">${sectionTitle('From this device', 'Pick Markdown files or a whole folder with the browser file picker.', 'monitor-up')}
      <div class="hstack"><span class="btn">${ic('file-text')}Choose Markdown files</span><span class="btn">${ic('folder-input')}Choose folder</span></div></div>
    ${sectionTitle('From the Paseo host', 'Absolute or ~/ paths to files or folders on the daemon host, one per line.', 'server')}
    <div class="input mono" style="align-items:flex-start;background:var(--s0);min-height:70px;line-height:20px;white-space:pre">~/notes/prompts\n~/work/review-checklist.md</div>
    <div class="hstack" style="gap:12px"><span class="muted grow" style="line-height:17px">Up to 100 Markdown files and 8 MB per import. Hidden entries, symlinks, and version folders are skipped.</span><span class="btn primary">${ic('upload')}Import 2 paths</span></div>
    <div class="card vstack" style="padding:14px;gap:10px">
      <div class="hstack"><span style="color:var(--ok)">${ic('circle-check', 18)}</span><span class="strong">2 imported · 1 skipped</span></div>
      <div class="vstack" style="gap:4px">${['engineering/review-checklist', 'engineering/api-design'].map((id) => `<div class="hstack"><span style="color:var(--ok)">${ic('file-text', 13)}</span><span class="mono">${id}.md</span></div>`).join('')}</div>
      <div class="hstack" style="align-items:flex-start;padding:10px;border-radius:8px;background:var(--s0);border:1px solid var(--bd)"><span style="color:var(--warn)">${ic('circle-alert', 13)}</span><span class="muted" style="line-height:17px"><span style="color:var(--fg)">code-review.md</span> · Prompt "engineering/code-review" already exists, including archived versions.</span></div>
    </div>
  </div>`;
}

export function settingsView() {
  const stat = (icon, label, value, tone = '') => `<div class="stat"><span class="meta">${ic(icon, 11)}${label}</span><span class="strong ellipsis" style="font-size:13px${tone ? `;color:${tone}` : ''}">${value}</span></div>`;
  return `<div class="panel" style="gap:16px">
    <div class="hstack" style="gap:10px"><span class="iconbtn">${ic('arrow-left', 16)}</span>${sectionTitle('Library settings', 'Where prompts live on this host, and how they sync.')}</div>
    ${field('Library directory', `<div class="input mono" style="background:var(--s0)">~/.config/paseo/prompt-lib</div>`, 'Changing the directory opens a different library. Existing files stay where they are.')}
    <div class="card hstack" style="padding:14px;gap:14px"><div class="grow"><div class="strong" style="font-size:13px">Git sync</div><div class="muted" style="line-height:17px">Commit prompts and version history to a Git repository in the library directory.</div></div><span class="switch"></span></div>
    <div class="card vstack" style="padding:14px;gap:12px">${sectionTitle('Repository', "Sync commits library changes, pulls, and pushes with this host's Git credentials.", 'git-branch')}
      <div class="hstack" style="gap:8px;align-items:stretch">${stat('circle-check', 'Status', 'Initialized', 'var(--ok)')}${stat('git-branch', 'Branch', 'main')}${stat('file-diff', 'Pending', '3 changed files', 'var(--warn)')}${stat('globe', 'Remote', 'git@github.com:you/prompts.git')}</div>
      <div class="hstack" style="justify-content:flex-end"><span class="btn primary">${ic('refresh-cw')}Sync now</span></div>
    </div>
  </div>`;
}
