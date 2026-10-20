const $ = id => document.getElementById(id);
let endpoint = '', key = sessionStorage.getItem('voiceAccessKey') || '', active = false, busy = false, stream, recorder, context, detector, audioUrl, generation = 0;
let callVoice, callPrompt;
let displayName="Jennifer · Private Companion", avatarUrl;
let personaLoaded=false, personaDirty=false, personaBusy=false;
let session = crypto.randomUUID();
const playback = new Audio();
function status(text, error=false) { $('status').textContent=text; $('status').className=error?'error':''; }
async function api(path, options={}) {
  if (!endpoint) throw Error('服务器连接尚未就绪');
  const response=await fetch(endpoint+path,{...options,signal:options.signal||AbortSignal.timeout(options.body instanceof FormData?120000:30000),headers:{...options.headers,Authorization:'Bearer '+key},cache:'no-store'});
  if (!response.ok) {
    if(response.status===401) { sessionStorage.removeItem('voiceAccessKey'); $('accessPanel').hidden=false; throw Error('访问密钥无效，请重新连接'); }
    let message='请求失败 ('+response.status+')';
    try { const data=await response.json(); message=typeof data.detail==='string'?data.detail:message; } catch {}
    throw Error(message);
  }
  return response;
}
async function json(path,options) { return (await api(path,options)).json(); }
async function runJob(path,options,epoch=generation,onProgress=null) {
  const {job}=await json(path,options);
  const deadline=Date.now()+650000;
  while(Date.now()<deadline) {
    if(epoch!==generation) throw Error('已结束本次操作');
    const result=await json('/jobs/'+job);
    if(onProgress) await onProgress({...result,job});
    if(result.status==='error') throw Error(result.detail);
    if(result.status==='done') return {...result,job};
    await new Promise(resolve=>setTimeout(resolve,400));
  }
  throw Error('处理超时，请稍后重试');
}
function post(data) { return {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}; }
function transcript(text,local) {
  const p=document.createElement('p'); p.className=local?'user':'agent'; const speaker=document.createElement('span'); speaker.className=local?'user-label':'character-label'; speaker.textContent=(local?'You':displayName)+': '; p.append(speaker,document.createTextNode(text));
  $('transcript').append(p); $('transcript').scrollTop=$('transcript').scrollHeight;
}
function applyProfile(profile) {
  displayName=profile.name;
  $('conversationTitle').textContent=displayName; document.title=displayName;
  $('conversationName').value=displayName;
  document.querySelectorAll('.character-label').forEach(label=>label.textContent=displayName+': ');
}
async function loadAvatar() {
  const blob=await (await api('/profile/avatar')).blob();
  const previous=avatarUrl; avatarUrl=URL.createObjectURL(blob);
  $('characterAvatar').src=avatarUrl; $('characterAvatar').hidden=false;
  $('avatarPlaceholder').hidden=true;
  if(previous)URL.revokeObjectURL(previous);
}
async function loadProfile() {
  try {
    const profile=await json('/profile'); applyProfile(profile);
    $('saveProfile').disabled=false;
    if(profile.has_avatar)await loadAvatar();
  } catch(e) { $('profileStatus').textContent='展示设置加载失败：'+e.message; }
}
$('profileForm').onsubmit=async event=>{
  event.preventDefault(); const name=$('conversationName').value.trim();
  if(!name)return;
  $('saveProfile').disabled=true; $('conversationName').readOnly=true;
  $('profileStatus').textContent='正在保存…';
  try {
    const profile=await json('/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
    applyProfile(profile); $('profileStatus').textContent='名称已保存';
  } catch(e) { $('profileStatus').textContent='保存失败：'+e.message; }
  finally { $('saveProfile').disabled=false; $('conversationName').readOnly=false; }
};
$('uploadAvatar').onclick=()=>{ $('avatarFile').value=''; $('avatarFile').click(); };
$('avatarFile').onchange=async()=>{
  const file=$('avatarFile').files[0]; if(!file)return;
  if(!file.size || file.size>8*1024*1024) { $('avatarStatus').textContent='请选择非空、最大 8MB 的照片'; return; }
  $('uploadAvatar').disabled=true; $('avatarStatus').textContent='正在上传并保存头像…';
  const data=new FormData(); data.append('file',file);
  try {
    await json('/profile/avatar',{method:'POST',body:data});
    await loadAvatar(); $('avatarStatus').textContent='头像已保存，刷新后仍会显示';
  } catch(e) { $('avatarStatus').textContent='头像处理失败：'+e.message; }
  finally { $('uploadAvatar').disabled=false; }
};
async function loadVoices() {
  const voices=await json('/data/voices');
  for(const option of [...$('voice').options]) if(option.dataset.custom) option.remove();
  for(const voice of voices) { const option=new Option(voice.name+(voice.id.startsWith('ft-')?'':' · reference voice'),voice.id); option.dataset.custom='1'; $('voice').add(option); }
}
async function health() {
  try {
    const response=await fetch('./connection.json?t='+Date.now(),{cache:'no-store'});
    if(!response.ok) throw Error('配置不可用');
    const config=await response.json();
    if(!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(config.api)) throw Error('连接地址无效');
    endpoint=config.api;
    const h=await (await fetch(endpoint+'/health',{cache:'no-store',signal:AbortSignal.timeout(12000)})).json();
    $('health').textContent=h.llm&&h.speech?'服务器在线 · 语音模型就绪':'服务器在线 · 模型准备中';
  } catch { $('health').textContent='服务器离线 · 请让 Codex 启动服务'; }
}
async function memoryStatus(loadHistory=false) {
  const epoch=generation;
  const memory=await json('/data/memory');
  if(epoch!==generation)return;
  $('memoryStatus').textContent='已保存 '+memory.messages+' 条消息';
  $('memoryText').textContent=memory.summary||'暂无长期记忆';
  if(loadHistory && !$('transcript').childElementCount) for(const item of memory.recent) transcript(item.text,item.role==='user');
}
async function unlock() {
  await json('/session'); sessionStorage.setItem('voiceAccessKey',key);
  $('accessPanel').hidden=true; $('workspace').inert=false;
  status('已连接。可以开始语音或文字对话。');
  await Promise.allSettled([loadVoices(),memoryStatus(true),resumeFineTune(),loadPersona(),loadProfile()]);
}
$('accessForm').onsubmit=async event=>{ event.preventDefault(); key=$('accessKey').value.trim(); try { await unlock(); $('accessKey').value=''; } catch(error) { $('accessStatus').textContent=error.message; } };
async function playResult(result,epoch) {
  if(epoch!==generation) return;
  if(result.text) transcript(result.text,false);
  if(result.has_audio) {
    const blob=await (await api('/jobs/'+result.job+'/audio'+(result.chunkIndex===undefined?'':'/'+result.chunkIndex))).blob();
    if(epoch!==generation) return;
    if(audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl=URL.createObjectURL(blob); playback.src=audioUrl;
    $('sample').src=audioUrl; $('sample').hidden=false;
    status('正在回复…');
    try { await playback.play(); await new Promise(resolve=>{ playback.onended=resolve; playback.onerror=resolve; playback.onpause=resolve; }); }
    catch { status('浏览器暂停了自动播放，可点击试听播放器播放。'); }
  }
  if(result.audio_error) status(result.audio_error,true);
}
let outputContext, audioQueue, turnAbort;
async function prepareAudio() {
  if(!outputContext||outputContext.state==='closed') outputContext=new AudioContext();
  await outputContext.resume();
}
function cancelReply() {
  turnAbort?.abort();
  audioQueue?.cancel();
}
function queuePCM(event) {
  const raw=atob(event.pcm), bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  const view=new DataView(bytes.buffer), buffer=outputContext.createBuffer(1,bytes.length/2,event.sample_rate);
  const channel=buffer.getChannelData(0);
  for(let i=0;i<channel.length;i++) channel[i]=view.getInt16(i*2,true)/32768;
  if(audioQueue.firstArrival===null && Number.isFinite(event.playback_buffer_s))audioQueue.target=Math.min(8,Math.max(0.5,event.playback_buffer_s));
  audioQueue.push(buffer);
}
async function sendTurn(path,options,fromAudio=false) {
  if(busy) return;
  busy=true; $('send').disabled=true; $('interrupt').disabled=false; const epoch=generation;
  const controller=new AbortController();turnAbort=controller;
  const timeout=setTimeout(()=>controller.abort(),600000);
  let reader;
  try {
    await prepareAudio();
    audioQueue=new StreamingAudioQueue(outputContext,state=>status(state==='buffering'?'正在缓冲语音…':'正在回复…'));
    status(fromAudio?'正在识别语音…':'正在生成回复…');
    const response=await api(path.replace('/jobs/','/realtime/'),{...options,signal:controller.signal});
    reader=response.body.getReader();const decoder=new TextDecoder();let pending='', paragraph,done=false;
    while(true) {
      const packet=await reader.read();if(packet.done)break;
      if(epoch!==generation)throw Error('对话已结束');
      pending+=decoder.decode(packet.value,{stream:true});
      let newline;
      while((newline=pending.indexOf('\n'))>=0) {
        const line=pending.slice(0,newline);pending=pending.slice(newline+1);if(!line)continue;
        const event=JSON.parse(line);
        if(event.type==='transcript')transcript(event.text,true);
        if(event.type==='text') {
          if(!paragraph) {transcript('',false);paragraph=$('transcript').lastElementChild;}
          paragraph.textContent+=event.delta;
          $('transcript').scrollTop=$('transcript').scrollHeight;
        }
        if(event.type==='audio') {queuePCM(event);}
        if(event.type==='error')throw Error(event.detail);
        if(event.type==='done'){done=true;audioQueue.finish();}
      }
    }
    if(!done)throw Error('连接中断，请重试');
    while(!audioQueue.drained&&epoch===generation)await new Promise(resolve=>setTimeout(resolve,80));
    if(epoch===generation) {
      memoryStatus().catch(()=>{});
      status(active?'正在听，请继续说话。':'已回复。');
    }
  } catch(error) {
    cancelReply();if(epoch===generation)status(error.message,true);
  } finally {
    clearTimeout(timeout);reader?.releaseLock();if(turnAbort===controller)turnAbort=null;
    busy=false; $('send').disabled=false; $('interrupt').disabled=true;
  }
}
function stopVoice(consolidate=true) {
  active=false; generation++; cancelReply(); clearInterval(detector);
  if(recorder && recorder.state!=='inactive') { recorder.onstop=null; recorder.stop(); }
  stream?.getTracks().forEach(track=>track.stop()); context?.close(); playback.pause();
  $('call').textContent='开始语音对话'; $('mute').disabled=true; $('orb').classList.remove('active'); status('语音对话已结束');
  if(consolidate) finishConversation();
}
async function startVoice() {
  if(active) return stopVoice();
  if(busy) return status('请等待当前回复完成');
  try {
    await prepareAudio();
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    context=new AudioContext(); await context.resume();
    const analyser=context.createAnalyser(); analyser.fftSize=2048; context.createMediaStreamSource(stream).connect(analyser);
    const samples=new Float32Array(analyser.fftSize);
    active=true; callVoice=$('voice').value; callPrompt=$('prompt').value;
    $('call').textContent='结束语音对话'; $('mute').disabled=false; $('mute').textContent='静音'; $('orb').classList.add('active');
    status('正在听。说完后会自动识别并回复。');
    let lastSound=0,start=0,heard=false;
    function record() {
      if(!active||busy||!stream.getAudioTracks()[0].enabled) return;
      const parts=[];
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));
      recorder=new MediaRecorder(stream,mime?{mimeType:mime}:{});
      recorder.ondataavailable=e=>{if(e.data.size) parts.push(e.data);};
      recorder.onstop=()=>{
        if(!active||!heard) return;
        const blob=new Blob(parts,{type:recorder.mimeType});
        sendTurn('/jobs/recording',{method:'POST',headers:{'X-Voice':encodeURIComponent(callVoice),'X-Session':session,'X-Prompt':encodeURIComponent(callPrompt)},body:blob},true);
      };
      start=Date.now(); lastSound=start; heard=false; recorder.start();
    }
    detector=setInterval(()=>{
      if(!active||busy||!stream.getAudioTracks()[0].enabled) return;
      if(!recorder||recorder.state==='inactive') record();
      analyser.getFloatTimeDomainData(samples);
      const rms=Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length);
      if(rms>0.018) { heard=true; lastSound=Date.now(); }
      if(recorder?.state==='recording' && ((heard&&Date.now()-lastSound>550&&Date.now()-start>750)||Date.now()-start>30000)) recorder.stop();
    },100);
  } catch(error) { stopVoice(false); status('无法打开麦克风：'+error.message,true); }
}
async function finishConversation() {
  if($('endSession').disabled) return;
  $('endSession').disabled=true;
  const epoch=generation;
  status('本轮对话已结束，正在整理长期记忆…');
  try {
    await runJob('/session/end',{method:'POST'},epoch);
    if(epoch===generation && !active) status('本轮对话已结束，长期记忆已更新。');
    memoryStatus().catch(()=>{});
  } catch(error) { if(epoch===generation && !active) status('聊天原文已保存；记忆整理状态：'+error.message,true); }
  finally { $('endSession').disabled=false; }
}
$('restartConversation').onclick=async()=>{
  if(!confirm('重新开始会永久删除所有聊天记录和长期记忆，人设和音色保留。继续吗？'))return;
  const button=$('restartConversation');button.disabled=true;
  stopVoice(false);playback.pause();
  $('send').disabled=true;$('call').disabled=true;$('endSession').disabled=true;
  status('正在清空对话…');
  try {
    await json('/session/reset',{method:'POST'});
    while(busy)await new Promise(resolve=>setTimeout(resolve,30));
    session=crypto.randomUUID();
    $('transcript').replaceChildren();$('message').value='';
    $('memoryStatus').textContent='已保存 0 条消息';$('memoryText').textContent='暂无长期记忆';
    if(audioUrl){URL.revokeObjectURL(audioUrl);audioUrl=null;}
    playback.removeAttribute('src');$('sample').removeAttribute('src');$('sample').hidden=true;
    status('旧对话和长期记忆已删除，可以开始新对话。');
  } catch(error){status('重新开始失败：'+error.message,true);}
  finally {button.disabled=false;$('send').disabled=false;$('call').disabled=false;$('endSession').disabled=false;}
};
$('endSession').onclick=()=>{ if(active) stopVoice(); else {generation++; cancelReply(); playback.pause(); finishConversation();} };
$('call').onclick=startVoice;
$('interrupt').onclick=()=>{generation++;cancelReply();status(active?'已打断，正在听。':'已打断回复。');};
$('textCall').onclick=()=>{ $('message').focus(); status('输入文字后点击 Send，即可收到语音回复。'); };
$('mute').onclick=()=>{
  if(!stream) return;
  const enabled=!stream.getAudioTracks()[0].enabled;
  stream.getAudioTracks().forEach(track=>track.enabled=enabled);
  if(!enabled&&recorder?.state==='recording') { recorder.onstop=null; recorder.stop(); }
  $('mute').textContent=enabled?'静音':'开启麦克风'; status(enabled?'正在听…':'麦克风已静音');
};
$('messageForm').onsubmit=event=>{
  event.preventDefault(); const text=$('message').value.trim(); if(!text||busy) return;
  if(recorder?.state==='recording') {recorder.onstop=null;recorder.stop();}
  transcript(text,true); $('message').value='';
  sendTurn('/jobs/turn',post({text,voice:active?callVoice:$('voice').value,prompt:active?callPrompt:$('prompt').value,session}));
};
$('preview').onclick=async()=>{
  if(active||busy) return status('请先结束语音对话并等待回复完成，再试听音色。');
  $('preview').disabled=true;
  try { status('正在生成试听…'); const result=await runJob('/jobs/preview',post({voice:$('voice').value,text:$('previewText').value.trim()})); await playResult(result,generation); status('试听已生成'); }
  catch(error) {status(error.message,true);} finally {$('preview').disabled=false;}
};
$('clone').onsubmit=async event=>{
  event.preventDefault(); const file=$('referenceFile').files[0];
  if(!file||!file.size||file.size>25*1024*1024) { $('cloneStatus').textContent='请选择非空、最大 25MB 的音频文件'; return; }
  $('cloneButton').disabled=true; $('cloneStatus').textContent='正在上传并处理，请稍候…';
  try {
    const result=await runJob('/jobs/voice',{method:'POST',body:new FormData(event.target)});
    await loadVoices(); $('voice').value=result.voice.id; event.target.reset();
    $('cloneStatus').textContent='已创建并选中：'+result.voice.name+'。可试听；下一次语音对话生效。';
  } catch(error) { $('cloneStatus').textContent=error.message; } finally { $('cloneButton').disabled=false; }
};
async function loadPersona() {
  if(personaBusy || personaDirty)return;
  personaBusy=true; $('loadPersona').disabled=true; $('savePersona').disabled=true;
  $('personaText').readOnly=true; $('personaStatus').textContent='正在加载人设…';
  try {
    $('personaText').value=await (await api('/data/persona')).text();
    personaLoaded=true; personaDirty=false;
    $('personaStatus').textContent='已加载，可直接编辑。';
  } catch(e) { $('personaStatus').textContent='加载失败：'+e.message; }
  finally {
    personaBusy=false; $('loadPersona').disabled=false;
    $('personaText').readOnly=!personaLoaded;
    $('savePersona').disabled=!personaLoaded || !personaDirty;
  }
}
$('loadPersona').onclick=async()=>{
  if(personaBusy)return;
  if(personaDirty && !confirm('重新加载会丢弃尚未保存的修改，是否继续？'))return;
  // Keep the draft if the refresh fails.
  const wasDirty=personaDirty; personaDirty=false;
  await loadPersona();
  if($('personaStatus').textContent.startsWith('加载失败：')) {
    personaDirty=wasDirty; $('savePersona').disabled=!personaLoaded || !personaDirty;
  }
};
$('personaText').oninput=()=>{
  personaDirty=true; $('savePersona').disabled=!personaLoaded || personaBusy;
  $('personaStatus').textContent='有未保存的修改';
};
$('savePersona').onclick=async()=>{
  if(!personaLoaded || personaBusy)return;
  const draft=$('personaText').value;
  personaBusy=true; $('savePersona').disabled=true; $('loadPersona').disabled=true;
  $('personaStatus').textContent='正在保存…';
  try {
    await api('/data/persona',{method:'PUT',headers:{'Content-Type':'text/plain;charset=utf-8'},body:draft});
    personaDirty=$('personaText').value!==draft;
    $('personaStatus').textContent=personaDirty?'已保存提交的内容，还有新的修改未保存':'已保存，后续对话读取新内容';
  } catch(e) { $('personaStatus').textContent='保存失败：'+e.message; }
  finally {
    personaBusy=false; $('loadPersona').disabled=false;
    $('savePersona').disabled=!personaDirty;
  }
};
$('exportMemory').onclick=async event=>{event.preventDefault();try {const blob=await (await api('/data/memory/export')).blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='companion-memory.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){status(e.message,true);} };
window.addEventListener('beforeunload',()=>stream?.getTracks().forEach(track=>track.stop()));
(async()=>{await health();if(key)try{await unlock();}catch{sessionStorage.removeItem('voiceAccessKey');}setInterval(health,30000);})();

let ftJob=null, ftTimer=null;
const ftActive = new Set(['queued','preparing','training','exporting']);
async function showFineTune(job) {
  ftJob=job.job;
  const running=ftActive.has(job.status);
  $('ftStart').disabled=running;
  $('ftCancel').hidden=!running;
  $('ftProgress').hidden=false;
  $('ftProgress').value=job.progress||0;
  $('ftStatus').textContent=job.name+'：'+(job.error||job.phase||job.status)+(job.total_steps?' · '+(job.step||0)+' / '+job.total_steps+' 步':'');
  clearTimeout(ftTimer);
  if(running) ftTimer=setTimeout(pollFineTune,3000);
  else if(job.status==='ready') {await loadVoices(); $('voice').value='ft-'+job.job;}
}
async function pollFineTune() {
  if(!ftJob)return;
  try {await showFineTune(await json('/ft/jobs/'+ftJob));}
  catch(e) {$('ftStatus').textContent='进度暂时不可用：'+e.message;ftTimer=setTimeout(pollFineTune,10000);}
}
async function resumeFineTune() {
  const jobs=await json('/ft/jobs');
  const job=jobs.find(j=>ftActive.has(j.status));
  if(job)await showFineTune(job);
}
$('ftForm').onsubmit=async event=>{
  event.preventDefault();
  const files=[...$('ftFiles').files];
  if(files.length<2||files.length>20){$('ftStatus').textContent='请选择 2–20 个音频文件';return;}
  if(files.some(f=>f.size>25*1024*1024)||files.reduce((a,f)=>a+f.size,0)>90*1024*1024){$('ftStatus').textContent='单文件最多 25MB，合计最多 90MB';return;}
  $('ftStart').disabled=true;$('ftStatus').textContent='正在上传录音…';
  try {const result=await json('/ft/jobs',{method:'POST',body:new FormData(event.target)});ftJob=result.job;await pollFineTune();}
  catch(e){$('ftStatus').textContent=e.message;$('ftStart').disabled=false;}
};
$('ftCancel').onclick=async()=>{
  if(!ftJob)return;
  $('ftCancel').disabled=true;
  try {await json('/ft/jobs/'+ftJob+'/cancel',{method:'POST'});$('ftStatus').textContent='已请求取消，将在当前处理步骤完成后停止';}
  catch(e){$('ftStatus').textContent=e.message;}
  finally {$('ftCancel').disabled=false;}
};
