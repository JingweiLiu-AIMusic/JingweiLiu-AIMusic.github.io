// PCM scheduling is independent of network chunk boundaries.
class StreamingAudioQueue {
  constructor(context, onState=()=>{}) {
    this.context=context;this.onState=onState;this.pending=[];this.sources=new Set();
    this.seconds=0;this.end=0;this.playing=false;this.finished=false;this.cancelled=false;
    this.target=1.5;this.hasPlayed=false;this.firstArrival=null;this.total=0;this.underruns=0;
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
      this.playing=false;this.underruns++;
    }
    if(!this.playing) {
      // Reserve audio once at startup. After a gap, play newly arrived audio
      // immediately instead of adding another 3.5–8 seconds of rebuffering.
      if(!this.finished && !this.hasPlayed && this.seconds<this.target) {
        this.onState('buffering');return;
      }
      if(!this.pending.length)return;
      this.playing=true;this.hasPlayed=true;this.end=now+0.08;this.onState('playing');
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
