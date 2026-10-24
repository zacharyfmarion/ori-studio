/** Rebuild the local review UI without rerunning expensive captures. */
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export async function writeProductionGallery(output = 'artifacts/camera-spread/production') {
  const reports = [];
  for (const dpr of [1, 2]) {
    try {
      reports.push(JSON.parse(await readFile(`${output}/review-dpr${dpr}.json`, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const reference = JSON.parse(await readFile('artifacts/camera-spread/comparison/after.json', 'utf8'));
  const rows = reports.flatMap((report) => report.rows.map((row) => ({ ...row, dpr: report.dpr })));
  const models = [...new Set(rows.map((row) => row.model))];
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
    );
  await writeFile(
    `${output}/index.html`,
    `<!doctype html><meta charset="utf-8"><title>Production Default spread review</title>
<style>body{font:15px system-ui;background:#f5f6f8;margin:24px;color:#202631}header{position:sticky;top:0;background:#f5f6f8;padding:12px;z-index:1}section{margin-bottom:24px;background:white;padding:16px;border:1px solid #ddd;border-radius:8px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{width:100%}h2{font-size:16px}a{color:#276982}select{margin:0 12px 0 4px;max-width:340px}p{line-height:1.5}</style>
<header><h1>Default spread · production validation</h1><p>Live worker renderer beside the saved and reopened vector picture. ${models.length} models · 7 views · normal and Retina. <a href="/diagram">Open Ori Studio</a> · <a href="../comparison/index.html">Original before / after</a></p>
<label>Model <select id="model"><option value="all">All models</option>${models.map((model) => `<option>${escape(model)}</option>`).join('')}</select></label>
<label>View <select id="view"><option value="all">All views</option>${reference.views.map((view) => `<option value="${escape(view.id)}">${escape(view.id)}</option>`).join('')}</select></label>
<label>Display <select id="dpr">${reports.map((r) => `<option value="${r.dpr}">${r.dpr === 1 ? 'Normal · DPR 1' : 'Retina · DPR 2'}</option>`).join('')}</select></label></header>
${rows
  .map((row) => {
    const view = reference.views.find((view) => view.id === row.view);
    return `<section data-model="${escape(row.model)}" data-view="${escape(row.view)}" data-dpr="${row.dpr}"><h2>${escape(row.model)} · ${escape(row.view)}</h2><p>${escape(view.projection)} · Amount ${(view.amount * 100).toFixed(0)}% · Direction ${view.directionDeg}° · Inclination ${view.inclinationDeg}° · Zoom ${(view.zoom * 100).toFixed(0)}%</p><div class="pair"><div>Live preview<img loading="lazy" alt="Live ${escape(row.model)} ${escape(row.view)}" src="${escape(row.prefix)}-live.png"></div><div>Saved / reopened · <a href="${escape(row.prefix)}.svg">SVG</a><img loading="lazy" alt="Saved ${escape(row.model)} ${escape(row.view)}" src="${escape(row.prefix)}-saved.png"></div></div><p>Render + presentation: ${row.presentMs.toFixed(1)} ms · capture: ${row.captureMs.toFixed(0)} ms · ${(row.bytes / 1024).toFixed(0)} KB</p></section>`;
  })
  .join('')}
<script>const query=new URLSearchParams(location.search), controls=['model','view','dpr'].map(id=>document.getElementById(id)); for(const control of controls){const value=query.get(control.id)||(control.id==='dpr'?'${reports.at(-1)?.dpr ?? 1}':'all');if([...control.options].some(option=>option.value===value))control.value=value;}function filter(){const params=new URLSearchParams();for(const control of controls)params.set(control.id,control.value);history.replaceState(null,'','?'+params);for(const section of document.querySelectorAll('section'))section.hidden=controls.some(control=>control.value!=='all'&&section.dataset[control.id]!==control.value);}controls.forEach(control=>control.onchange=filter);filter();</script>`
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await writeProductionGallery();
