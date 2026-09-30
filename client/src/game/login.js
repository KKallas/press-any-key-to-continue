// The front page. Two ways through it, and it teaches the first.
//
//   new operator      Type an injection at the login. The host creates a
//                     persistent account and hands you a KEY. Write it down:
//                     it's how you come back as the same operator.
//   returning         Type your handle. The host knows you and asks for the
//                     key. Give it and you're back, colour and all.
//
// A plain handle it doesn't know, and no injection, is turned away, with a
// nudge toward the injection. The server decides all of this (auth.mjs); this
// is only the terminal it's typed into, and the link under the prompt points
// at where the real thing is taught.

const BOOT = [
  'VIDSERV 2.1 (c) 1998  MOBILE UNIT 7',
  'connecting to host 10.1.0.1 ...',
  'HELLO. this terminal is for authorised operators.',
  '',
  'login: ',
];

const HINTS = [
  "hint: the front door was never locked. it was left ' open.",
  "hint: 1998 called. its logins don't check their inputs.",
  "hint: OR 1=1 is older than you are.",
];

export function login(statusUrl, signupUrl, loginUrl) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'login';
    wrap.innerHTML = `
      <div class="login-crt">
        <pre id="login-log"></pre>
        <div class="login-line"><span class="login-caret" id="login-prompt">&gt;</span><input id="login-in" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="login" /></div>
        <div class="login-foot">
          <span id="login-count">…</span>
          <span>new here? the door opens to an <b>injection</b> · <a href="https://overthewire.org/wargames/" target="_blank" rel="noopener">learn it for real</a></span>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const log = wrap.querySelector('#login-log');
    const input = wrap.querySelector('#login-in');
    const promptEl = wrap.querySelector('#login-prompt');
    const count = wrap.querySelector('#login-count');
    let tries = 0;
    let stage = { mode: 'line' }; // or { mode:'key', handle }

    const print = (s = '') => {
      log.textContent += (log.textContent ? '\n' : '') + s;
      log.scrollTop = log.scrollHeight;
    };
    const done = (data) => {
      setTimeout(() => {
        wrap.remove();
        resolve(data);
      }, 800);
    };

    let i = 0;
    const boot = setInterval(() => {
      print(BOOT[i++]);
      if (i >= BOOT.length) {
        clearInterval(boot);
        input.focus();
      }
    }, 240);

    fetch(statusUrl)
      .then((r) => r.json())
      .then((s) => (count.textContent = `${s.players}/${s.max} online · ${s.operators ?? 0} operators`))
      .catch(() => (count.textContent = ''));

    const askKey = (handle) => {
      stage = { mode: 'key', handle };
      promptEl.textContent = 'key:';
      input.type = 'text';
      input.value = '';
      input.focus();
    };
    const askLine = () => {
      stage = { mode: 'line' };
      promptEl.textContent = '>';
      input.focus();
    };

    const submit = async () => {
      const value = input.value.trim();
      if (!value) return;
      input.value = '';
      input.disabled = true;

      try {
        if (stage.mode === 'key') {
          print('key: ' + value.replace(/./g, '*'));
          const res = await fetch(loginUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: stage.handle, key: value }) });
          const data = await res.json();
          if (data.ok) {
            print(`* welcome back, ${data.handle}. session ${data.runs}.`);
            done(data);
            return;
          }
          print(`* ${data.reason || 'BAD KEY'}`);
          print("  (type 'back' to try another way in)");
          input.disabled = false;
          input.focus();
          return;
        }

        // stage: a fresh line — an injection, a handle, or 'back'.
        print('login: ' + value.replace(/</g, '&lt;'));
        if (value.toLowerCase() === 'back') {
          askLine();
          input.disabled = false;
          return;
        }
        const res = await fetch(signupUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ line: value }) });
        const data = await res.json();
        if (data.ok && data.created) {
          print(`* injection accepted. operator ${data.handle} created.`);
          print(`* your key:  ${data.key}`);
          print('* WRITE THIS DOWN. it is how you log back in as ' + data.handle + '.');
          done(data);
          return;
        }
        if (data.needKey) {
          print(`* operator ${data.handle} on file.`);
          askKey(data.handle);
          input.disabled = false;
          return;
        }
        print(`* ${data.reason || 'ACCESS DENIED'}`);
        if (++tries >= 2) print(HINTS[Math.min(tries - 2, HINTS.length - 1)]);
      } catch (e) {
        print('* host unreachable.');
      }
      input.disabled = false;
      input.focus();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  });
}
