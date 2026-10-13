(() => {
  const demos = [...document.querySelectorAll('.song-demo[data-lyrics]')];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const demo of demos) {
    const audio = demo.querySelector('audio');
    const window = demo.querySelector('.lyric-window');
    const cues = JSON.parse(demo.querySelector('.lyric-data').textContent);
    let active = -2;
    const lines = cues.map((cue) => {
      const line = document.createElement('button');
      line.type = 'button'; line.className = 'lyric-line'; line.textContent = cue.text;
      line.setAttribute('aria-label', `跳转到 ${cue.text}`);
      line.addEventListener('click', () => { audio.currentTime = cue.start; update(); });
      window.append(line); return line;
    });
    function update() {
      const time = audio.currentTime;
      const index = cues.findIndex(cue => time >= cue.start && time < cue.end);
      if (index === active) return;
      if (active >= 0) { lines[active].classList.remove('is-active'); lines[active].removeAttribute('aria-current'); }
      active = index;
      if (index >= 0) {
        const line = lines[index]; line.classList.add('is-active'); line.setAttribute('aria-current', 'true');
        window.scrollTo({top: line.offsetTop - window.clientHeight / 2 + line.offsetHeight / 2, behavior: reducedMotion ? 'instant' : 'smooth'});
      }
    }
    for (const event of ['timeupdate', 'seeking', 'seeked', 'loadedmetadata', 'ended']) audio.addEventListener(event, update);
    audio.addEventListener('play', () => { for (const other of demos) if (other !== demo) other.querySelector('audio').pause(); update(); });
    audio.addEventListener('ended', () => { active = -2; lines.forEach(line => {line.classList.remove('is-active');line.removeAttribute('aria-current');}); });
    update();
  }
})();
