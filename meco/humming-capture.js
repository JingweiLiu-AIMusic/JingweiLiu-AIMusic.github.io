// Audio-clock sample boundaries exclude the count-in and cap recording at 16 bars.
class HummingCapture extends AudioWorkletProcessor {
 constructor(){super();this.start=Infinity;this.end=Infinity;this.sent=false;this.port.onmessage=({data})=>{if(data.type==='arm'){this.start=data.start;this.end=data.end;}if(data.type==='stop')this.end=Math.min(this.end,data.at);};}
 process(inputs){
  const input=inputs[0]?.[0];
  if(input&&!this.sent){
   const a=Math.max(0,Math.ceil((this.start-currentTime)*sampleRate));
   const b=Math.min(input.length,Math.ceil((this.end-currentTime)*sampleRate));
   if(b>a){const chunk=input.slice(a,b);this.port.postMessage({type:'chunk',samples:chunk},[chunk.buffer]);}
  }
  if(!this.sent&&currentTime>=this.end){this.sent=true;this.port.postMessage({type:'done'});}
  return true;
 }
}
registerProcessor('humming-capture',HummingCapture);
