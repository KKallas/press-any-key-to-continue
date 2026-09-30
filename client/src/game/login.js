// The front page. There is no sign-up button, because the world doesn't have
// one: the way in is to talk to the login the way the old boxes could be
// talked to. Type an injection at the prompt and the host cuts you a fresh
// operator. Type a polite login and it turns you away. The server decides
// what counts (see server.mjs); this is only the terminal it's typed into.
//
// It's a teaching gesture as much as a gate: a link under the prompt points
// at where people actually learn this, and the injection here is the toy
// version of a real, and now long-patched, class of bug.

const BOOT = [
  'VIDSERV 2.1 (c) 1998  MOBILE UNIT 7',
  'connecting to host 10.1.0.1 ...',
  'HELLO. this terminal is for authorised operators.',
  '',
  "login: ",
];

const HINTS = [
  "hint: the front door was never locked. it was left ' open.",
  "hint: 1998 called. its logins don't check their inputs.",
  "hint: OR 1=1 is older than you are.",
];

export function login(statusUrl, signupUrl) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'login';
    wrap.innerHTML = `
      <div class="login-crt">
        <pre id="login-log"></pre>
        <div class="login-line"><span class="login-caret">&gt;</span><input id="login-in" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="login" /></div>
        <div class="login-foot">
          <span id="login-count">…</span>
          <span>new here? the door opens to an <b>injection</b> · <a href="https://overthewire.org/wargames/" target="_blank" rel="noopener">learn it for real</a></span>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const log = wrap.querySelector('#login-log');
    const input = wrap.querySelector('#login-in');
    const count = wrap.querySelector('#login-count');
    let tries = 0;

    const print = (s = '') => {
      log.textContent += (log.textContent ? '\n' : '') + s;
    };

    // Boot chatter, a line at a time.
    let i = 0;
    const boot = setInterval(() => {
      print(BOOT[i++]);
      if (i >= BOOT.length) {
        clearInterval(boot);
        input.focus();
      }
    }, 260);

    fetch(statusUrl)
      .then((r) => r.json())
      .then((s) => (count.textContent = `${s.players}/${s.max} operators online`))
      .catch(() => (count.textContent = ''));

    const submit = async () => {
      const line = input.value.trim();
      if (!line) return;
      print('login: ' + line.replace(/</g, '&lt;'));
      input.value = '';
      input.disabled = true;
      try {
        const res = await fetch(signupUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ line }) });
        const data = await res.json();
        if (data.ok) {
          print(`* injection accepted. operator ${data.name} spawned.`);
          print('* issuing session token ...');
          setTimeout(() => {
            wrap.remove();
            resolve(data);
          }, 700);
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
