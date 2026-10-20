// PCM scheduling is independent of network chunk boundaries.
class StreamingAudioQueue {
  constructor(context, onState=()=>{}) {
    this.context=context;this.onState=onState;this.pending=[];this.sources=new Set();
    this.seconds=0;this.end=0;this.playing=false;this.finished=false;this.cancelled=false;
    this.target=4;this.firstArrival=null;this.total=0;this.underruns=0;
  }
  push(buffer) {
    if(this.cancelled)return;
    const now=this.context.currentTime;
    if(this.firstArrival===null)this.firstArrival=now;
    this.total+=buffer.duration;
    this.pending.push(buffer);this.seconds+=buffer.duration;this.pump();
  }
  pump() {
    if(this.cancelled)return;
    const now=this.context.currentTime;
    if(this.playing && this.pending.length && this.end<now+0.025) {
      this.playing=false;this.underruns++;this.target=Math.min(8,this.target+2);
    }
    if(!this.playing) {
      // Keep a reserve for phrase restarts and network jitter. Short replies flush at EOF.
      const elapsed=now-(this.firstArrival??now);
      const rate=elapsed>0.5?this.total/elapsed:1;
      const target=Math.min(8,Math.max(this.target,rate<1?this.target+(1-rate)*12:this.target));
      if(!this.finished && (this.seconds<target || elapsed<(this.target>=4?1.5:0))) {
        this.onState('buffering');return;
      }
      if(!this.pending.length)return;
      this.playing=true;this.end=now+0.08;this.onState('playing');
    }
    for(const buffer of this.pending) {
      const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.context.destination);
      source.start(this.end);this.end+=buffer.duration;this.sources.add(source);
      source.onended=()=>this.sources.delete(source);
    }
    this.pending=[];this.seconds=0;
  }
  finish(){this.finished=true;this.pump();}
  get drained(){return !this.pending.length&&!this.sources.size;}
  cancel(){this.cancelled=true;for(const source of this.sources){try{source.stop();}catch{}}this.sources.clear();this.pending=[];this.seconds=0;}
}
