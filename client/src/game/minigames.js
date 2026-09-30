// The little games you play to get in. Each one mounts a panel over the main
// screen, styled like the rest of the rack, and resolves to true (you're in)
// or false (blown it). They're deliberately small and swappable: a break-in
// today is a coin toss or a timing bar, and tomorrow the same slot can hold
// something with more teeth, chosen by a prompt, without the rest of the game
// noticing. Each game takes an optional difficulty 0..1.
//
// The rule the whole game rests on: a human who knows the trick is always a
// little faster than an agent solving it cold, so the games reward a steady
// hand and a learned rhythm, not raw speed alone.

function panel(title, sub) {
  const el = document.createElement('div');
  el.className = 'mg';
  el.innerHTML = `
    <div class="mg-box">
      <div class="mg-head"><span>${title}</span><span class="mg-sub">${sub || ''}</span></div>
      <div class="mg-body"></div>
      <div class="mg-foot" id="mg-foot"></div>
    </div>`;
  document.body.appendChild(el);
  return el;
}

function finish(el, ok, verdict) {
  const foot = el.querySelector('#mg-foot');
  if (foot) foot.textContent = verdict || (ok ? 'ACCESS GRANTED' : 'DENIED');
  return new Promise((res) => setTimeout(() => {
    el.remove();
    res(ok);
  }, 850));
}

// A coin toss: press SPACE to call it, luck does the rest. The simplest way
// in, and the placeholder a prompt can grow from.
export function coinToss(diff = 0) {
  return new Promise((resolve) => {
    const el = panel('FORCE ENTRY', 'call it · SPACE');
    const body = el.querySelector('.mg-body');
    body.innerHTML = '<div class="mg-coin" id="coin">?</div><div class="mg-line">heads and the latch gives</div>';
    const coin = el.querySelector('#coin');
    let spinning = null;
    const go = () => {
      if (spinning) return;
      let n = 0;
      spinning = setInterval(() => {
        coin.textContent = n++ % 2 ? 'H' : 'T';
        if (n > 12) {
          clearInterval(spinning);
          const ok = Math.random() > 0.4 + diff * 0.2;
          coin.textContent = ok ? 'H' : 'T';
          cleanup();
          finish(el, ok, ok ? 'THE LATCH GIVES' : 'SOLID. NO LUCK').then(resolve);
        }
      }, 70);
    };
    const key = (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        go();
      } else if (e.key === 'Escape') {
        cleanup();
        el.remove();
        resolve(false);
      }
    };
    const cleanup = () => window.removeEventListener('keydown', key);
    window.addEventListener('keydown', key);
  });
}

// Lockpick: a marker sweeps a bar; stop it in the sweet spot. Three pins, each
// narrower than the last. Physical access — a door, a hatch, a gate.
export function lockpick(diff = 0) {
  return new Promise((resolve) => {
    const el = panel('LOCKPICK', 'stop in the notch · SPACE');
    const body = el.querySelector('.mg-body');
    body.innerHTML = '<div class="mg-bar"><div class="mg-notch" id="notch"></div><div class="mg-cursor" id="cur"></div></div><div class="mg-line" id="pins">pin 1 of 3</div>';
    const cur = el.querySelector('#cur');
    const notch = el.querySelector('#notch');
    const pinsEl = el.querySelector('#pins');
    let pin = 0;
    const pins = 3;
    let raf = null;
    const setup = () => {
      const w = 40 - diff * 12 - pin * 6; // notch shrinks each pin
      const pos = 15 + Math.random() * 60;
      notch.style.width = w + '%';
      notch.style.left = pos + '%';
      notch._lo = pos;
      notch._hi = pos + w;
      pinsEl.textContent = `pin ${pin + 1} of ${pins}`;
    };
    let t = 0;
    const speed = 0.9 + diff * 0.5;
    const tick = () => {
      t += 0.016 * speed;
      const x = (Math.sin(t * 3) * 0.5 + 0.5) * 100;
      cur._x = x;
      cur.style.left = x + '%';
      raf = requestAnimationFrame(tick);
    };
    const attempt = () => {
      const x = cur._x;
      if (x >= notch._lo && x <= notch._hi) {
        pin++;
        if (pin >= pins) {
          cancelAnimationFrame(raf);
          cleanup();
          finish(el, true, 'OPEN').then(resolve);
        } else {
          setup();
        }
      } else {
        cancelAnimationFrame(raf);
        cleanup();
        finish(el, false, 'SNAP — PICK BROKE').then(resolve);
      }
    };
    const key = (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        attempt();
      } else if (e.key === 'Escape') {
        cancelAnimationFrame(raf);
        cleanup();
        el.remove();
        resolve(false);
      }
    };
    const cleanup = () => window.removeEventListener('keydown', key);
    window.addEventListener('keydown', key);
    setup();
    tick();
  });
}

// Wiretap: repeat a growing tone sequence on the keypad (a blue-box echo).
// System access — the way to leave a door open for a hack you come back for.
export function wiretap(diff = 0) {
  return new Promise((resolve) => {
    const el = panel('WIRETAP', 'repeat the tones · keys 1-4');
    const body = el.querySelector('.mg-body');
    body.innerHTML = '<div class="mg-pads">' + [1, 2, 3, 4].map((n) => `<div class="mg-pad" data-n="${n}">${n}</div>`).join('') + '</div><div class="mg-line" id="seq">listen…</div>';
    const pads = [...el.querySelectorAll('.mg-pad')];
    const seqEl = el.querySelector('#seq');
    const target = 3 + Math.round(diff * 3);
    const seq = [];
    let input = [];
    const flash = (n) => {
      const pad = pads[n - 1];
      pad.classList.add('lit');
      setTimeout(() => pad.classList.remove('lit'), 260);
    };
    const play = () => {
      seqEl.textContent = 'listen…';
      let i = 0;
      const iv = setInterval(() => {
        flash(seq[i++]);
        if (i >= seq.length) {
          clearInterval(iv);
          setTimeout(() => (seqEl.textContent = 'now you'), 300);
          input = [];
        }
      }, 460);
    };
    const grow = () => {
      seq.push(1 + Math.floor(Math.random() * 4));
      play();
    };
    const press = (n) => {
      flash(n);
      input.push(n);
      const i = input.length - 1;
      if (input[i] !== seq[i]) {
        cleanup();
        finish(el, false, 'TONE MISMATCH').then(resolve);
        return;
      }
      if (input.length === seq.length) {
        if (seq.length >= target) {
          cleanup();
          finish(el, true, 'LINE OPEN').then(resolve);
        } else {
          setTimeout(grow, 500);
        }
      }
    };
    const key = (e) => {
      if (e.key >= '1' && e.key <= '4') press(Number(e.key));
      else if (e.key === 'Escape') {
        cleanup();
        el.remove();
        resolve(false);
      }
    };
    pads.forEach((p) => p.addEventListener('click', () => press(Number(p.dataset.n))));
    const cleanup = () => window.removeEventListener('keydown', key);
    window.addEventListener('keydown', key);
    grow();
  });
}

export const MINIGAMES = { coinToss, lockpick, wiretap };
