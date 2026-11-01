const path = require('node:path');
const fs = require('node:fs/promises');
const { test: base, expect, chromium } = require('@playwright/test');

const original = 'שלום לך, מה שלומך היום?';
const translated = 'Hello, how are you today?';

// These local pages model composer event handling. No real chat or Google request is sent.
function composerPage({ editable = false, form = true, button = 'testid' } = {}) {
  const editor = editable
    ? '<div id="prompt-textarea" contenteditable="true" data-placeholder="Message"></div>'
    : '<textarea id="prompt-textarea"></textarea>';
  const buttonAttributes = {
    testid: 'data-testid="send-button" aria-label="Send prompt" type="submit"',
    claude: 'aria-label="Send message" type="button"',
    hebrew: 'aria-label="שליחת הודעה" type="button"',
    submit: 'type="submit"',
    none: '',
  }[button];
  return `<!doctype html><meta charset="utf-8">
    <style>#composer { margin: 80px; } textarea,[contenteditable] { display:block; width:400px; min-height:100px; border:1px solid; } button { min-width:50px; min-height:40px; }</style>
    <input id="unrelated" aria-label="Search">
    <form id="other-form"><input><button id="other-submit" type="submit">Search</button></form>
    <${form ? 'form' : 'div'} id="composer">
      ${editor}
      ${button === 'none' ? '' : `<button id="send" ${buttonAttributes}><svg width="24" height="24"><path d="M12 2L22 20H2Z" fill="black"/></svg></button>`}
    </${form ? 'form' : 'div'}>
    <script>
      const editor = document.querySelector('#prompt-textarea');
      const read = () => editor.tagName === 'TEXTAREA' ? editor.value : editor.innerText;
      let draft = read();
      // Model a controlled textarea's value tracker. Direct assignment alone must not
      // fool the test into thinking the application's state received the new text.
      if (editor.tagName === 'TEXTAREA') {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        let tracked = editor.value;
        Object.defineProperty(editor, 'value', {
          get() { return descriptor.get.call(this); },
          set(value) { tracked = String(value); descriptor.set.call(this, value); },
        });
        editor.addEventListener('input', () => {
          if (read() !== tracked) { draft = read(); tracked = draft; }
        });
      } else {
        editor.addEventListener('input', () => { draft = read(); });
      }
      window.sent = [];
      window.otherSubmits = 0;
      window.send = () => window.sent.push(draft);
      document.addEventListener('keydown', event => {
        if (editor.contains(event.target) && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault(); window.send();
        }
      }, true);
      document.querySelector('#other-form').addEventListener('submit', event => {
        event.preventDefault(); window.otherSubmits++;
      });
      ${form ? `document.querySelector('#composer').addEventListener('submit', event => {
        event.preventDefault(); window.send();
      });` : `document.querySelector('#send')?.addEventListener('click', () => window.send());`}
    </script>`;
}

const test = base.extend({
  createApp: async ({}, use) => {
    const contexts = [];
    // Keep Windows profile paths short; browser cache paths add many more components.
    const profileRoot = path.resolve(__dirname, '..', '..', 'browser-profiles');
    await fs.mkdir(profileRoot, { recursive: true });
    await use(async (options = {}) => {
      const extensionPath = path.resolve(__dirname, '..');
      const profilePath = await fs.mkdtemp(path.join(profileRoot, 'p-'));
      const context = await chromium.launchPersistentContext(profilePath, {
        channel: 'chromium',
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        ignoreDefaultArgs: ['--disable-extensions'],
        headless: true,
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
      });
      contexts.push({ context, profilePath });
      const requests = [];
      let releaseTranslation;
      const gate = options.hold ? new Promise(resolve => { releaseTranslation = resolve; }) : Promise.resolve();
      await context.route('https://translate.googleapis.com/**', async route => {
        requests.push(new URL(route.request().url()).searchParams.get('q'));
        await gate;
        await route.fulfill({
          status: options.fail ? 503 : 200,
          headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
          body: JSON.stringify([[[options.translation || translated]], null, 'iw']),
        });
      });
      const origin = options.claude ? 'https://claude.ai' : 'https://chatgpt.com';
      await context.route(`${origin}/**`, route => route.fulfill({
        contentType: 'text/html; charset=utf-8', body: composerPage(options),
      }));
      const page = context.pages()[0];
      await page.goto('chrome://extensions');
      await expect.poll(() => page.evaluate(() => new Promise(resolve => {
        chrome.developerPrivate.getExtensionsInfo({}, extensions => {
          resolve(extensions.some(extension => extension.name.includes('token-saver-he') && extension.state === 'ENABLED'));
        });
      }))).toBe(true);
      await page.goto(`${origin}/extension-test`);
      await expect(page.locator('#he-en-bubble')).toBeVisible();
      const input = page.locator('#prompt-textarea');
      await input.fill(original);
      return { page, input, requests, releaseTranslation };
    });
    for (const { context, profilePath } of contexts) {
      await context.close();
      if (path.dirname(profilePath) !== profileRoot || !path.basename(profilePath).startsWith('p-')) {
        throw new Error('Unexpected browser profile cleanup path');
      }
      await fs.rm(profilePath, { recursive: true, force: true, maxRetries: 3 });
    }
  },
});

async function expectOneSend(page, text = translated) {
  await expect.poll(() => page.evaluate(() => window.sent)).toEqual([text]);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.sent)).toEqual([text]);
}

for (const [name, options] of [
  ['ChatGPT textarea', {}],
  ['ChatGPT contenteditable', { editable: true }],
  ['Claude contenteditable', { editable: true, form: false, button: 'claude', claude: true }],
  ['Hebrew send label', { editable: true, form: false, button: 'hebrew' }],
  ['composer submit button', { button: 'submit' }],
]) {
  test(`arrow click translates and sends once: ${name}`, async ({ createApp }) => {
    const { page, requests } = await createApp(options);
    await page.locator('#send svg').click();
    await expectOneSend(page);
    expect(requests).toEqual([original]);
  });
}

for (const editable of [false, true]) {
  test(`Enter translates and sends once (${editable ? 'contenteditable' : 'textarea'})`, async ({ createApp }) => {
    const { page, input, requests } = await createApp({ editable });
    await input.press('Enter');
    await expectOneSend(page);
    expect(requests).toEqual([original]);
  });
}

test('form submission translates before forwarding', async ({ createApp }) => {
  const { page, requests } = await createApp();
  await page.locator('#composer').evaluate(form => form.requestSubmit());
  await expectOneSend(page);
  expect(requests).toEqual([original]);
});

test('keyboard fallback sends once when there is no button or form', async ({ createApp }) => {
  const { page, input, requests } = await createApp({ form: false, button: 'none' });
  await input.press('Enter');
  await expectOneSend(page);
  expect(requests).toEqual([original]);
});

test('Shift+Enter stays a newline without translation or send', async ({ createApp }) => {
  const { page, input, requests } = await createApp();
  await input.press('Shift+Enter');
  expect(await input.inputValue()).toContain('\n');
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => window.sent)).toEqual([]);
});

test('Enter outside the composer and unrelated form buttons are left alone', async ({ createApp }) => {
  const { page, requests } = await createApp();
  await page.locator('#unrelated').press('Enter');
  await page.locator('#other-submit').click();
  expect(await page.evaluate(() => window.otherSubmits)).toBe(1);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => window.sent)).toEqual([]);
});

test('English text passes through with one send and no translation', async ({ createApp }) => {
  const { page, input, requests } = await createApp();
  await input.fill('English draft');
  await page.locator('#send').click();
  await expectOneSend(page, 'English draft');
  expect(requests).toEqual([]);
});

test('disabled extension leaves arrow and Enter submissions alone', async ({ createApp }) => {
  const { page, input, requests } = await createApp();
  await page.locator('#he-en-bubble').click();
  await expect(page.locator('#he-en-bubble')).toHaveClass('he-en-off');
  await page.locator('#send').click();
  await input.press('Enter');
  expect(await page.evaluate(() => window.sent)).toEqual([original, original]);
  expect(requests).toEqual([]);
});

test('repeated clicks and Enter during translation cannot send the original or send twice', async ({ createApp }) => {
  const { page, input, requests, releaseTranslation } = await createApp({ hold: true });
  await page.locator('#send').click();
  await expect.poll(() => requests.length).toBe(1);
  await page.locator('#send').click();
  await input.press('Enter');
  expect(await page.evaluate(() => window.sent)).toEqual([]);
  releaseTranslation();
  await expectOneSend(page);
  expect(requests).toEqual([original]);
});

test('translation failure keeps the original draft and does not send', async ({ createApp }) => {
  const { page, input, requests } = await createApp({ fail: true });
  await page.locator('#send').click();
  await expect.poll(() => requests.length).toBe(1);
  await page.waitForTimeout(250);
  expect(await input.inputValue()).toBe(original);
  expect(await page.evaluate(() => window.sent)).toEqual([]);
});

test('editing a draft during translation preserves the new text without sending', async ({ createApp }) => {
  const { page, input, requests, releaseTranslation } = await createApp({ hold: true });
  await page.locator('#send').click();
  await expect.poll(() => requests.length).toBe(1);
  await input.fill('טיוטה חדשה שלא שולחים');
  releaseTranslation();
  await page.waitForTimeout(250);
  expect(await input.inputValue()).toBe('טיוטה חדשה שלא שולחים');
  expect(await page.evaluate(() => window.sent)).toEqual([]);
});

test('a translation still containing Hebrew is sent once without recursive translation', async ({ createApp }) => {
  const { page, requests } = await createApp({ translation: original });
  await page.locator('#send').click();
  await expectOneSend(page, original);
  expect(requests).toEqual([original]);
});

test('replacement send button after an input update is used once', async ({ createApp }) => {
  const { page, requests } = await createApp();
  await page.evaluate(() => {
    document.querySelector('#prompt-textarea').addEventListener('input', () => {
      const button = document.querySelector('#send');
      button.replaceWith(button.cloneNode(true));
    }, { once: true });
  });
  await page.locator('#send').click();
  await expectOneSend(page);
  expect(requests).toEqual([original]);
});
