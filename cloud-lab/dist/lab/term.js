// Terminal compartida por los laboratorios (xterm.js): edición de línea, historial, Tab, heredocs,
// pegado de varias líneas y preguntas interactivas (y/n, contraseñas) que devuelve el motor.
// Uso: new CloudLabTerm(elemento, {run, answer, cancel, complete, prompt, history, colorize, after})
(()=>{
const THEME={background:'#10242a',foreground:'#d5e8e3',cursor:'#5fd4bb',cursorAccent:'#10242a',selectionBackground:'#2b5d57',black:'#10242a',red:'#ff8b7e',green:'#7ddcb0',yellow:'#f1cc74',blue:'#7fb6ff',magenta:'#d6a6ff',cyan:'#5fd4bb',white:'#d5e8e3',brightBlack:'#6e8d89',brightRed:'#ffa69b',brightGreen:'#9be8c4',brightYellow:'#f6db99',brightBlue:'#a3cbff',brightMagenta:'#e4c2ff',brightCyan:'#8ae6d2',brightWhite:'#ffffff'};

class CloudLabTerm{
  constructor(el,o){
    this.o=o;
    const term=this.term=new Terminal({convertEol:true,cursorBlink:true,fontFamily:'"SFMono-Regular",Menlo,Consolas,"Liberation Mono",monospace',fontSize:innerWidth<760?11.5:13,lineHeight:1.25,scrollback:3000,theme:THEME});
    const fit=new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(el);
    const doFit=()=>{try{fit.fit()}catch{}};
    doFit();
    this.ro=new ResizeObserver(doFit);this.ro.observe(el);
    this.buf='';this.cur=0;this.hist=(o.history||[]).slice();this.hIdx=this.hist.length;this.heredoc=null;this.asking=null;this.lastTab=0;this.rendered={rows:0,curRow:0};
    term.onData(d=>this.onData(d));
  }
  dispose(){this.ro&&this.ro.disconnect();this.term.dispose()}
  write(s){this.term.write(s)}
  focus(){this.term.focus()}
  clearHistory(){this.hist=[];this.hIdx=0}
  visLen(s){return s.replace(/\x1b\[[0-9;]*m/g,'').length}
  prompt(){this.p=this.heredoc?'> ':this.o.prompt();this.buf='';this.cur=0;this.rendered={rows:0,curRow:0};this.term.write(this.p)}
  shown(){return this.asking&&this.asking.secret?'*'.repeat(this.buf.length):this.buf}
  redraw(){
    const t=this.term,cols=t.cols,pl=this.visLen(this.p);
    if(this.rendered.curRow>0)t.write(`\x1b[${this.rendered.curRow}A`);
    t.write('\r\x1b[J'+this.p+this.shown());
    const len=pl+this.buf.length;
    if(len>0&&len%cols===0)t.write('\r\n');
    const endRow=Math.floor(len/cols),tgt=pl+this.cur,tRow=Math.floor(tgt/cols),tCol=tgt%cols;
    if(endRow-tRow>0)t.write(`\x1b[${endRow-tRow}A`);
    t.write('\r'+(tCol?`\x1b[${tCol}C`:''));
    this.rendered={rows:endRow,curRow:tRow};
  }
  setLine(s){this.buf=s;this.cur=s.length;this.redraw()}
  insert(s){this.buf=this.buf.slice(0,this.cur)+s+this.buf.slice(this.cur);this.cur+=s.length;this.redraw()}
  onData(d){
    // Pegar varias líneas: se ejecutan una a una.
    if(d.length>1&&/[\r\n]/.test(d)&&!d.startsWith('\x1b')){
      const parts=d.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
      parts.forEach((p,i)=>{if(p)this.insert(p.replace(/\t/g,'  '));if(i<parts.length-1)this.enter()});
      return;
    }
    switch(d){
      case'\r':case'\n':return this.enter();
      case'\x7f':case'\b':if(this.cur>0){this.buf=this.buf.slice(0,this.cur-1)+this.buf.slice(this.cur);this.cur--;this.redraw()}return;
      case'\x1b[3~':if(this.cur<this.buf.length){this.buf=this.buf.slice(0,this.cur)+this.buf.slice(this.cur+1);this.redraw()}return;
      case'\x1b[D':if(this.cur>0){this.cur--;this.redraw()}return;
      case'\x1b[C':if(this.cur<this.buf.length){this.cur++;this.redraw()}return;
      case'\x1b[H':case'\x01':case'\x1bOH':this.cur=0;this.redraw();return;
      case'\x1b[F':case'\x05':case'\x1bOF':this.cur=this.buf.length;this.redraw();return;
      case'\x1b[1;5D':case'\x1bb':{const m=this.buf.slice(0,this.cur).match(/\S+\s*$/);this.cur=m?m.index:0;this.redraw();return}
      case'\x1b[1;5C':case'\x1bf':{const m=this.buf.slice(this.cur).match(/^\s*\S+/);this.cur+=m?m[0].length:this.buf.length-this.cur;this.redraw();return}
      case'\x1b[A':if(this.heredoc||this.asking)return;if(this.hIdx>0){this.hIdx--;this.setLine(this.hist[this.hIdx])}return;
      case'\x1b[B':if(this.heredoc||this.asking)return;if(this.hIdx<this.hist.length-1){this.hIdx++;this.setLine(this.hist[this.hIdx])}else{this.hIdx=this.hist.length;this.setLine('')}return;
      case'\x03':this.term.write('^C\n');this.heredoc=null;if(this.asking){this.asking=null;this.o.cancel&&this.o.cancel()}this.prompt();return;
      case'\x0c':this.term.clear();this.term.write('\x1b[2J\x1b[H');this.redraw();return;
      case'\x15':this.buf=this.buf.slice(this.cur);this.cur=0;this.redraw();return;
      case'\x0b':this.buf=this.buf.slice(0,this.cur);this.redraw();return;
      case'\x17':{const m=this.buf.slice(0,this.cur).match(/\S+\s*$/);if(m){this.buf=this.buf.slice(0,m.index)+this.buf.slice(this.cur);this.cur=m.index;this.redraw()}return}
      case'\t':return this.tab();
    }
    if(d.startsWith('\x1b'))return;
    const clean=d.replace(/[\x00-\x1f]/g,'');
    if(clean)this.insert(clean);
  }
  tab(){
    if(this.asking)return;
    if(this.heredoc){this.insert('  ');return}
    const before=this.buf.slice(0,this.cur);
    const{candidates,word}=this.o.complete(before);
    if(!candidates.length)return;
    const common=candidates.reduce((a,b)=>{let i=0;while(i<a.length&&a[i]===b[i])i++;return a.slice(0,i)});
    if(candidates.length===1){
      const c=candidates[0];
      this.insert(c.slice(word.length)+(/[=/]$/.test(c)?'':' '));
      return;
    }
    if(common.length>word.length){this.insert(common.slice(word.length));return}
    const now=Date.now();
    if(now-this.lastTab<900||candidates.length<=12){
      const w=Math.max(...candidates.map(c=>c.length))+2,per=Math.max(1,Math.floor(this.term.cols/w));
      let out='';candidates.slice(0,120).forEach((c,i)=>{out+=c.padEnd(w);if((i+1)%per===0)out+='\n'});
      this.term.write('\n'+out.trimEnd()+'\n');
      this.rendered={rows:0,curRow:0};
      this.redraw();
    }
    this.lastTab=now;
  }
  enter(){
    const line=this.buf;
    // Mueve el cursor al final antes de escribir la salida.
    this.cur=this.buf.length;this.redraw();this.term.write('\n');
    if(this.asking){this.asking=null;this.show(this.o.answer(line));return}
    if(this.heredoc){
      if(line.trim()===this.heredoc.word){const hd=this.heredoc;this.heredoc=null;this.exec(hd.line,hd.body.join('\n')+'\n',true);return}
      this.heredoc.body.push(line);this.p='> ';this.buf='';this.cur=0;this.rendered={rows:0,curRow:0};this.term.write(this.p);return;
    }
    const m=line.match(/<<-?\s*['"]?(\w+)['"]?/);
    if(m){this.heredoc={word:m[1],line,body:[]};this.p='> ';this.buf='';this.cur=0;this.rendered={rows:0,curRow:0};this.term.write(this.p);return}
    if(line.trim()){this.hist=this.hist.filter(x=>x!==line.trim());this.hist.push(line.trim())}
    this.hIdx=this.hist.length;
    this.exec(line,undefined,true);
  }
  // Ejecuta una línea; si no la ha escrito el usuario (botones, clics en el mapa) la muestra primero.
  exec(line,stdin,typed){
    if(this.asking){this.term.write('^C\n');this.asking=null;this.o.cancel&&this.o.cancel()}
    if(!typed){this.setLine(line);this.term.write('\n');if(line.trim()){this.hist.push(line);this.hIdx=this.hist.length}}
    this.show(this.o.run(line,stdin));
  }
  show(r){
    if(r.clear){this.term.clear();this.term.write('\x1b[2J\x1b[H')}
    for(const p of r.parts||[])if(p.out)this.term.write(this.o.colorize(p.out,p.err,p.warn)+'\n');
    this.o.after&&this.o.after(r);
    if(r.ask){
      this.asking=r.ask;this.p=r.ask.text;this.buf='';this.cur=0;this.rendered={rows:0,curRow:0};this.term.write(this.p);return;
    }
    this.prompt();
  }
}
window.CloudLabTerm=CloudLabTerm;
})();
