// Simulador AZ-900: modo práctica (responder y corregir) y modo estudio (respuestas visibles).
(()=>{
const Q=window.AZ900_QUESTIONS||[];
const h=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=t=>String(t??'').trim().toLowerCase().replace(/[\s.]+$/,'');
const YN=['yes','no'];
const TYPE={single:'Respuesta única',multi:'Respuesta múltiple',hotspot:'Hotspot',dragdrop:'Arrastrar y soltar'};
const letters='ABCDEFGHIJ';

// Normaliza cada pregunta a un formato de respuesta que se pueda corregir.
function prepare(q){
  const opts=Array.isArray(q.options)?q.options:null;
  if(q.pairs){
    const choices=[...new Set(q.pairs.map(p=>p.correct))].sort();
    return{kind:'match',choices};
  }
  if(q.statements){
    const vals=q.statements.map(s=>norm(s.correct));
    const allYN=vals.every(v=>YN.includes(v));
    const onlyYesNoOpts=!opts||opts.every(o=>YN.includes(norm(o)));
    if(opts&&allYN&&vals.every(v=>v==='yes')&&!onlyYesNoOpts){
      const correct=opts.map((o,i)=>q.statements.some(s=>norm(s.statement_en)===norm(o))?letters[i]:null).filter(Boolean);
      if(correct.length===q.statements.length)return{kind:'choice',entries:opts.map((o,i)=>({key:letters[i],en:o})),correct};
    }
    if(opts&&!allYN&&vals.every(v=>opts.some(o=>norm(o)===v)))return{kind:'select',choices:opts};
    if(allYN&&onlyYesNoOpts)return{kind:'yesno'};
    return{kind:'reveal'};
  }
  if(q.options&&q.correct){
    if(opts){
      const entries=opts.map((o,i)=>({key:letters[i],en:o}));
      return{kind:'choice',entries,correct:entries.filter(e=>q.correct.includes(e.en)).map(e=>e.key)};
    }
    const es=q.options_es||{};
    const entries=Object.keys(q.options).sort().map(k=>({key:k,en:q.options[k],es:es[k]&&es[k]!==q.options[k]?es[k]:''}));
    return{kind:'choice',entries,correct:q.correct.slice()};
  }
  return{kind:'reveal'};
}
const P=Q.map(prepare);

let results={},answers={},pos=0;
try{results=JSON.parse(localStorage.getItem('cloudlab-az900')||'{}')||{};answers=JSON.parse(localStorage.getItem('cloudlab-az900-answers')||'{}')||{};pos=+localStorage.getItem('cloudlab-az900-pos')||0}catch{}
if(!(pos>=0&&pos<Q.length))pos=0;
function save(){try{localStorage.setItem('cloudlab-az900',JSON.stringify(results));localStorage.setItem('cloudlab-az900-answers',JSON.stringify(answers));localStorage.setItem('cloudlab-az900-pos',String(pos))}catch{}}
function stopVoice(){if('speechSynthesis' in window)speechSynthesis.cancel()}
function speak(q){
  if(!('speechSynthesis' in window))return;
  stopVoice();
  const u=new SpeechSynthesisUtterance(q.question_es||q.question_en);
  u.lang='es-ES';speechSynthesis.speak(u);
}

// Respuesta correcta en texto, usada en modo estudio y tras corregir.
function solution(q,p){
  const yn=v=>norm(v)==='yes'?'Sí':norm(v)==='no'?'No':h(v);
  if(p.kind==='choice')return`<ul class="answer-list">${p.entries.filter(e=>p.correct.includes(e.key)).map(e=>`<li><b>${e.key}.</b> ${h(e.en)}${e.es?` <small>${h(e.es)}</small>`:''}</li>`).join('')}</ul>`;
  if(p.kind==='match')return`<ul class="answer-list">${q.pairs.map(x=>`<li>${h(x.description_es||x.description_en)} → <b>${h(x.correct)}</b></li>`).join('')}</ul>`;
  return`<ul class="answer-list">${q.statements.map(s=>`<li>${h(s.statement_es||s.statement_en)} → <b>${yn(s.correct)}</b></li>`).join('')}</ul>`;
}

function inputs(q,p,i){
  if(p.kind==='choice'){
    const multi=p.correct.length>1;
    return`${multi?`<p class="q-hint">Selecciona ${p.correct.length} respuestas.</p>`:''}${p.entries.map(e=>`<label class="option"><input type="${multi?'checkbox':'radio'}" name="a" value="${e.key}"><b>${e.key}.</b> ${h(e.en)}${e.es?`<small>${h(e.es)}</small>`:''}</label>`).join('')}`;
  }
  if(p.kind==='yesno')return q.statements.map((s,j)=>`<div class="statement"><div><span>${j+1}.</span> ${h(s.statement_en)}${s.statement_es&&s.statement_es!==s.statement_en?`<small>${h(s.statement_es)}</small>`:''}</div><div class="yn"><label><input type="radio" name="s${j}" value="yes">Sí</label><label><input type="radio" name="s${j}" value="no">No</label></div></div>`).join('');
  if(p.kind==='select'||p.kind==='match'){
    const rows=p.kind==='match'?q.pairs.map(x=>[x.description_en,x.description_es]):q.statements.map(s=>[s.statement_en,s.statement_es]);
    return rows.map(([en,es],j)=>`<div class="statement"><div><span>${j+1}.</span> ${h(en)}${es&&es!==en?`<small>${h(es)}</small>`:''}</div><select name="s${j}" aria-label="Respuesta ${j+1}"><option value="">Elige…</option>${p.choices.map(c=>`<option value="${h(c)}">${h(c)}</option>`).join('')}</select></div>`).join('');
  }
  const opts=Array.isArray(q.options)?`<p class="q-hint">Opciones disponibles:</p><ul class="answer-list muted">${q.options.map(o=>`<li>${h(o)}</li>`).join('')}</ul>`:'';
  return`${opts}<p class="q-hint">Piensa tu respuesta y luego muéstrala para autoevaluarte.</p>`;
}

function grade(q,p,form){
  const fd=new FormData(form);
  if(p.kind==='choice'){
    const sel=fd.getAll('a');
    if(!sel.length)return null;
    return sel.length===p.correct.length&&sel.every(k=>p.correct.includes(k));
  }
  const rows=p.kind==='match'?q.pairs:q.statements;
  const vals=rows.map((_,j)=>fd.get(`s${j}`));
  if(vals.some(v=>!v))return null;
  return rows.every((r,j)=>norm(vals[j])===norm(r.correct));
}

function markChoices(form,p){
  form.querySelectorAll('label.option').forEach(l=>{
    const inp=l.querySelector('input'),ok=p.correct.includes(inp.value);
    l.classList.toggle('correct',ok);
    l.classList.toggle('wrong',inp.checked&&!ok);
  });
}

function stats(){
  const answered=Object.keys(results).length,ok=Object.values(results).filter(v=>v==='ok').length;
  return`<div><small>Preguntas</small><b>${Q.length}</b></div><div><small>Respondidas</small><b>${answered}</b></div><div><small>Aciertos</small><b>${answered?Math.round(ok/answered*100):0}%</b></div><div><small>Pendientes</small><b>${Q.length-answered}</b></div>`;
}

window.renderExam=(app,part)=>{
  stopVoice();
  const study=part==='estudio';
  const q=Q[pos],p=P[pos];
  const state=results[q.id];
  app.innerHTML=`<a class="back" href="#inicio">← Volver al inicio</a><p class="eyebrow">SIMULADOR DE EXAMEN · MICROSOFT AZURE</p><h1>AZ-900: Azure Fundamentals</h1><p class="intro">${Q.length} preguntas tipo examen, en inglés como el examen real, con traducción y explicación en español.</p>
<div class="stats">${stats()}</div>
<div class="progress exam-progress"><i></i></div>
<div class="tabs"><a href="#examen" class="${study?'':'selected'}">✎ &nbsp;Práctica</a><a href="#examen/estudio" class="${study?'selected':''}">▥ &nbsp;Estudio</a></div>
<div class="exam-layout"><form class="lesson q-card" novalidate>
<div class="q-meta"><span>Pregunta ${pos+1} de ${Q.length} · ID ${q.id}</span><span class="pill">${TYPE[q.type]||'Pregunta'}</span>${state?`<span class="pill ${state}">${state==='ok'?'✓ Acertada':'✗ Fallada'}</span>`:''}</div>
<h2 class="q-en">${h(q.question_en)}</h2>${q.question_es&&q.question_es!==q.question_en?`<p class="q-es">${h(q.question_es)}</p>`:''}
<div class="q-body">${study?`<p class="q-hint">Respuesta correcta</p>${solution(q,p)}`:inputs(q,p,pos)}</div>
<div class="feedback" role="status">${study?`<div class="explain">${h(q.explanation)}</div>`:''}</div>
<div class="q-actions"><button type="button" class="btn" data-go="-1" ${pos===0?'disabled':''}>← Anterior</button><button type="button" class="btn" data-speak title="Leer la pregunta en español">🔊 Escuchar</button>${study?'':`<button type="submit" class="btn primary">${p.kind==='reveal'?'Mostrar respuesta':'Comprobar'}</button>`}<button type="button" class="btn" data-go="1" ${pos===Q.length-1?'disabled':''}>Siguiente →</button></div>
</form><div class="q-side"><div class="lesson"><h3>Mapa de preguntas</h3><p class="legend"><i class="ok"></i>Acertada <i class="ko"></i>Fallada <i></i>Pendiente</p><div class="q-map">${Q.map((x,j)=>`<button type="button" data-jump="${j}" class="${results[x.id]||''} ${j===pos?'current':''}" aria-label="Pregunta ${j+1}">${j+1}</button>`).join('')}</div>
<div class="side-actions"><button type="button" class="btn" data-random>⤨ Aleatoria</button><button type="button" class="btn" data-pending>Siguiente pendiente</button><button type="button" class="btn" data-failed>Repasar falladas</button><button type="button" class="btn danger" data-reset>Reiniciar progreso</button></div></div></div></div>
<p class="bottom-note">Tu progreso del simulador se guarda en este navegador.</p>`;

  const form=app.querySelector('.q-card'),fb=form.querySelector('.feedback');
  const go=j=>{if(j>=0&&j<Q.length){pos=j;save();window.renderExam(app,part);document.querySelector('.q-card').scrollIntoView({block:'start',behavior:'smooth'})}};
  const find=test=>{for(let k=1;k<=Q.length;k++){const j=(pos+k)%Q.length;if(test(Q[j]))return j}return -1};
  const paint=()=>{app.querySelector('.stats').innerHTML=stats();app.querySelector('.exam-progress i').style.width=`${Math.round(Object.keys(results).length/Q.length*100)}%`};
  const record=v=>{results[q.id]=v?'ok':'ko';save();paint()};
  paint();
  app.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(pos+ +b.dataset.go));
  app.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>go(+b.dataset.jump));
  app.querySelector('[data-speak]').onclick=()=>speak(q);
  app.querySelector('[data-random]').onclick=()=>go(Math.floor(Math.random()*Q.length));
  app.querySelector('[data-pending]').onclick=()=>{const j=find(x=>!results[x.id]);j<0?alert('¡No te quedan preguntas pendientes!'):go(j)};
  app.querySelector('[data-failed]').onclick=()=>{const j=find(x=>results[x.id]==='ko');j<0?alert('No tienes preguntas falladas.'):go(j)};
  app.querySelector('[data-reset]').onclick=()=>{if(confirm('¿Borrar todo tu progreso del simulador AZ-900?')){results={};answers={};pos=0;save();window.renderExam(app,part)}};
  form.onsubmit=e=>{
    e.preventDefault();
    if(study)return;
    if(p.kind==='reveal'){
      fb.innerHTML=`<p class="q-hint">Respuesta correcta</p>${solution(q,p)}<div class="explain">${h(q.explanation)}</div><div class="self">¿Acertaste? <button type="button" class="btn" data-self="1">Sí, acerté</button><button type="button" class="btn" data-self="0">No</button></div>`;
      fb.querySelectorAll('[data-self]').forEach(b=>b.onclick=()=>{record(b.dataset.self==='1');go(Math.min(pos+1,Q.length-1))});
      return;
    }
    const r=grade(q,p,form);
    if(r===null){fb.innerHTML='<p class="warn">Responde todas las partes antes de comprobar.</p>';return}
    const fd=new FormData(form),saved={};
    for(const[k,v]of fd.entries())(saved[k]=saved[k]||[]).push(v);
    answers[q.id]=saved;
    record(r);
    show(r);
    const m=app.querySelector(`[data-jump="${pos}"]`);m.classList.remove('ok','ko');m.classList.add(r?'ok':'ko');
  };
  function show(r,again){
    if(p.kind==='choice')markChoices(form,p);
    fb.innerHTML=`${again?'<p class="q-hint">Tu respuesta anterior</p>':''}<p class="${r?'good':'bad'}">${r?'✓ ¡Correcto!':'✗ Todavía no.'}</p>${r||p.kind==='choice'?'':`<p class="q-hint">Respuesta correcta</p>${solution(q,p)}`}<div class="explain">${h(q.explanation)}</div>`;
  }
  // Al volver a una pregunta ya respondida se ve lo que marcaste y su corrección (puedes cambiarla y comprobar de nuevo).
  const prev=answers[q.id];
  if(!study&&prev&&p.kind!=='reveal'){
    for(const[k,vals]of Object.entries(prev))for(const v of vals){
      const el=form.querySelector(`[name="${k}"]`);
      if(!el)continue;
      if(el.tagName==='SELECT')el.value=v;
      else{const box=form.querySelector(`[name="${k}"][value="${CSS.escape(v)}"]`);if(box)box.checked=true}
    }
    const r=grade(q,p,form);
    if(r!==null)show(r,true);
  }
  else if(!study&&results[q.id]&&p.kind==='reveal')fb.innerHTML=`<p class="q-hint">Te autoevaluaste: ${results[q.id]==='ok'?'acertada':'fallada'}</p>`;
};
window.az900Stats=()=>({total:Q.length,answered:Object.keys(results).length});
})();
