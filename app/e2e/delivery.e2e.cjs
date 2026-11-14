// End-to-end (v0.8.0): paid on delivery (protocol 4.6). A staged payout in two tranches and a bounty; reports
// and claims; one round pays tranche 1 and the bounty to the claimant the council picks; tranche 2 lapses.
const { chromium } = require('playwright');
const { writeDownWords } = require('./words.cjs');
const fs = require('fs');
const { execFileSync } = require('child_process');

const URL0 = 'http://localhost:4173/';
const OUT = __dirname + '/out';
const SHOTS = OUT + '/shots-delivery';
fs.mkdirSync(SHOTS, { recursive: true });
fs.writeFileSync(OUT + '/funded.json', '{}');
for (const f of fs.readdirSync(OUT)) if (f.startsWith('broadcast-')) fs.unlinkSync(`${OUT}/${f}`);
const RECIPIENT = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const ALL = [];
let failures = 0;
const log = (...a) => console.log('•', ...a);
const check = (cond, what) => {
  console.log(cond ? '  ✓' : '  ✗', what);
  if (!cond) failures++;
};
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const seen = (loc, timeout = 30000) => loc.first().waitFor({ timeout }).then(() => true, () => false);

async function phone(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'it-IT', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
  });
  page.on('pageerror', e => console.log(`  [${label}] pageerror`, e.message));
  page.on('dialog', d => d.accept());
  ALL.push({ page, label });
  return { ctx, page, label };
}
const copied = page => page.evaluate(() => navigator.clipboard.readText());
async function open(page, hash) {
  await page.goto(URL0 + hash);
  await page.reload();
}
async function paste(page, code) {
  await page.getByText('La fotocamera non è disponibile').waitFor();
  await page.locator('.scanner textarea').fill(code);
  await page.getByRole('button', { name: 'Usa', exact: true }).click();
}
async function signUp(page, name, council, wrongWords = false) {
  await page.goto(URL0 + '#/founder');
  await page.getByRole('textbox').fill(name);
  if (council) await page.getByLabel('Chiedo un posto nel Consiglio').check();
  await page.getByLabel(/Ho almeno 18 anni/).check();
  await page.getByRole('button', { name: 'Avanti' }).click();
  if (council) await page.getByLabel(/Su questo telefono/).check();
  await page.getByRole('button', { name: 'Crea con impronta o volto' }).click();
  if (council) await writeDownWords(page, { tryWrong: wrongWords });
  await page.getByRole('button', { name: 'Copia il codice' }).click();
  return copied(page);
}


const MARCO_ADDR = 'tb1qt95lqr64arnwv42sgkd3n9q0ddpmxzj8aem0we';
const ELENA_ADDR = 'tb1qrcl29p79agjrjnd2quk2s9u9jypu4lr3tcrpy2';
const txOuts = file => JSON.parse(execFileSync('python3', ['-c', 'import sys,json\nfrom embit.transaction import Transaction\nfrom embit.networks import NETWORKS\nt=Transaction.parse(bytes.fromhex(json.load(open(sys.argv[1]))["hex"]))\nprint(json.dumps([[o.script_pubkey.address(NETWORKS["test"]), o.value] for o in t.vout]))', file]).toString());
async function vote(pages, pid) {
  for (const p of pages) {
    await open(p.page, `#/p/${pid}`);
    await p.page.getByRole('button', { name: 'Sì', exact: true }).click();
    await p.page.getByText(/Il tuo voto:/).waitFor({ timeout: 15000 });
  }
}
async function report(page, pid, text) {
  await open(page, `#/p/${pid}`);
  await page.getByRole('textbox', { name: /Resoconto/ }).fill(text);
  await page.getByRole('button', { name: 'Firma e pubblica il resoconto' }).click();
  await page.getByText(text).first().waitFor({ timeout: 15000 });
}
async function claim(page, pid, address) {
  await open(page, `#/p/${pid}`);
  await page.getByLabel('Il tuo indirizzo bitcoin').fill(address);
  await page.getByRole('button', { name: 'Richiedi la taglia' }).click();
  await page.getByText('L\'hai richiesta con', { exact: false }).waitFor({ timeout: 15000 });
  check(await seen(page.getByText(address).first()), 'the claim shows the address claimed with');
  check(await seen(page.getByText('Se scelto, sarai pagato a')), 'the report form shows where the claimant would be paid');
}

(async () => {
  const browser = await chromium.launch();
  const [A, B, C, F] = await Promise.all(['@anna', '@marco', '@luca', '@elena'].map(n => phone(browser, n)));
  log('Founding a 2-of-3 treasury');
  const codes = {};
  for (const [p, n, c] of [[A, '@anna', 1], [B, '@marco', 1], [C, '@luca', 1], [F, '@elena', 0]]) codes[n] = await signUp(p.page, n, !!c);
  const a = A.page;
  await a.goto(URL0 + '#/setup');
  await a.getByRole('button', { name: '2 · Consiglio' }).click();
  for (const n of ['@marco', '@luca']) {
    await a.getByRole('button', { name: 'Scansiona un membro del Consiglio' }).click();
    await paste(a, codes[n]);
    await a.getByRole('button', { name: 'Coincide: aggiungi' }).click();
  }
  check(await a.getByText('2 di 3').isVisible(), 'threshold follows the council added: 2 of 3 (site file has 5 placeholders)');
  check(await a.getByText('3 finora').isVisible(), 'council size shown');
  await a.getByRole('button', { name: '3 · Fondatori' }).click();
  await a.getByRole('button', { name: 'Scansiona un fondatore' }).click();
  await paste(a, codes['@elena']);
  await a.getByRole('button', { name: 'Coincide: aggiungi' }).click();
  await a.getByRole('button', { name: '4 · Pubblica' }).click();
  await a.getByRole('button', { name: 'Firma e pubblica' }).click();
  await a.getByText('Pubblicate ✓').waitFor({ timeout: 20000 });
  await open(B.page, '#/founder');
  await B.page.getByRole('button', { name: 'Approva e firma' }).click();
  for (const p of [A, B, C, F]) {
    await open(p.page, '#/founder');
    await p.page.getByRole('button', { name: 'Proteggi la chiave e continua' }).click({ timeout: 20000 });
    await p.page.getByText('Stampa la tua tessera d\'identità').waitFor({ timeout: 20000 });
  }

  log('Funding the treasury (mock chain)');
  const f = F.page;
  await open(f, '#/');
  await f.locator('.addr').waitFor({ timeout: 30000 });
  check(await f.getByText('Servono 2 firme su 3').isVisible(), '2 of 3 shown');
  const addr0 = (await f.locator('.addr').innerText()).replace(/\s+/g, '');
  fs.writeFileSync(OUT + '/funded.json', JSON.stringify({ [addr0]: { value: 500000, txid: 'cd'.repeat(32) } }));


  log('A staged payout (2 tranches) and a bounty, voted together');
  await open(f, '#/new');
  await f.getByLabel('Titolo', { exact: true }).fill('Stampa in due rate');
  await f.getByLabel('Testo vincolante').fill('Volantini: prima metà, poi il resto.');
  await f.getByLabel('Nome del beneficiario').fill('@elena');
  await f.getByLabel('Indirizzo bitcoin del beneficiario').fill(RECIPIENT);
  await f.getByLabel('Pagato a rate, alla consegna').check();
  await f.getByLabel('Rata 1, sats').fill('20000');
  await f.getByLabel('Giorni').first().fill('1');
  await f.getByRole('button', { name: '+ Aggiungi una rata' }).click();
  await f.getByLabel('Rata 2, sats').fill('30000');
  await f.getByLabel('Giorni').nth(1).fill('2');
  check(await seen(f.getByText('Totale: 50.000 sats')), 'the form adds up the tranches');
  await f.getByLabel('Rata 2, sats').scrollIntoViewIfNeeded();
  await f.screenshot({ path: OUT + '/shot-two.png' });
  check(await f.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll on a phone');
  check((await f.getByLabel('Rata 2, sats').boundingBox()).width > 120, 'tranche fields keep their width with a remove button');
  await f.getByLabel(/Sono io il beneficiario/).check();
  await f.getByRole('button', { name: 'Firma e pubblica' }).click();
  await f.waitForURL(/#\/p\/[0-9a-f]{64}$/);
  const staged = f.url().split('/p/')[1];
  check(await seen(f.getByText('Rate, pagate alla consegna')), 'proposal page: the schedule');
  await open(f, '#/new');
  await f.getByLabel('Tipo di proposta').selectOption('bounty');
  await f.getByLabel('Titolo', { exact: true }).fill('Traduzione del sito');
  await f.getByLabel('Testo vincolante').fill('Tradurre il sito in inglese.');
  await f.getByLabel('Rata 1, sats').fill('15000');
  await f.getByLabel('Giorni').first().fill('5');
  await f.getByRole('button', { name: 'Firma e pubblica' }).click();
  await f.waitForURL(/#\/p\/[0-9a-f]{64}$/);
  const bounty = f.url().split('/p/')[1];
  check(await seen(f.getByText('Taglia (bounty)')), 'proposal page: a bounty');
  await vote([A, B, C, F], staged);
  await vote([A, B, C, F], bounty);
  log('Waiting for the close (~2 min)');
  await new Promise(r => setTimeout(r, 150000));
  await open(a, '#/council');
  await a.waitForTimeout(3000);

  log('Reports and claims');
  await open(f, `#/p/${staged}`);
  check(await seen(f.getByText(/aspetta il resoconto della consegna/)), 'staged: waiting for the first report');
  await report(f, staged, 'Stampata la prima metà dei volantini.');
  check(await seen(f.getByText('resoconto pronto')), 'tranche 1: report in');
  await claim(B.page, bounty, MARCO_ADDR);
  await claim(f, bounty, ELENA_ADDR);
  await report(B.page, bounty, 'Sito tradotto, con glossario.');
  await report(f, bounty, 'Traduzione fatta anch\'io.');
  check(await seen(f.getByText('Richiesta da: @marco, @elena')), 'two claims shown');
  await open(f, '#/');
  check(await seen(f.getByText(/di cui 65\.000 sats promessi/)), 'treasury: 65,000 sats committed');

  log('One round pays tranche 1 and the bounty; the council picks @marco');
  await open(a, '#/round/new');
  await a.getByText(/rata 1 di 2/).waitFor({ timeout: 30000 });
  await a.getByLabel(/Chi paga la taglia/).selectOption({ label: '@marco' });
  await a.getByRole('button', { name: 'Prepara la transazione' }).click({ timeout: 30000 });
  await a.getByText('Riepilogo').waitFor();
  await a.getByRole('button', { name: 'Firma e pubblica il giro' }).click();
  await a.waitForURL(/#\/round\/[0-9a-f]{64}$/);
  const rid = a.url().split('/round/')[1];
  check(await seen(a.getByText('Hai firmato ✓')), 'preparer signed');
  const mb = B.page;
  await open(mb, `#/round/${rid}`);
  await mb.getByRole('button', { name: 'Firma con la chiave di prova' }).click({ timeout: 20000 });
  await mb.getByText('Firme sufficienti ✓').waitFor({ timeout: 20000 });
  await mb.getByRole('button', { name: 'Trasmetti la transazione' }).click();
  check(await seen(mb.getByText(/Sulla rete ✓/)), 'broadcast');
  const b = fs.readdirSync(OUT).find(x => x.startsWith('broadcast-'));
  const outs = txOuts(`${OUT}/${b}`);
  check(outs.some(o => o[0] === RECIPIENT && o[1] === 20000), 'pays tranche 1 (20,000) to the staged recipient');
  check(outs.some(o => o[0] === MARCO_ADDR && o[1] === 15000), "pays the bounty to @marco's claim");
  check(!outs.some(o => o[0] === ELENA_ADDR), 'not to the other claimant');
  check(/ALL OK/.test(execFileSync('python3', [__dirname + '/embit-check.py', `${OUT}/${b}`]).toString()), 'signatures verify with embit');
  check(await (await open(a, `#/round/${rid}`), seen(a.getByText(/^Confermata nel blocco \d+\.$/), 90000)), 'receipt');

  log('After the round: bounty paid, tranche 2 lapses without a report');
  await open(f, `#/p/${bounty}`);
  check(await seen(f.getByText(/Pagato ✓/)), 'bounty paid');
  let lapsed = false;
  for (let i = 0; i < 12 && !lapsed; i++) {
    await open(f, `#/p/${staged}`);
    lapsed = await seen(f.getByText('decaduta'), 5000);
    if (!lapsed) await f.waitForTimeout(10000);
  }
  check(lapsed, 'tranche 2 lapsed with no report');
  check(await seen(f.getByText('pagata ✓')), 'tranche 1 shows paid');
  check(await seen(f.getByText(/^Pagate 1 rate su 2 \(/)), 'the payment line says what was paid before the lapse');
  await open(f, '#/');
  await f.waitForTimeout(3000);
  check(!(await f.getByText(/promessi in rate/).count()), 'nothing committed any more');

  log('Discussion: reports');
  await open(f, '#/discussion');
  await f.getByRole('button', { name: 'Resoconti' }).click();
  check(await seen(f.getByText('Resoconto 1 di 2')), 'thread chip: report 1 of 2');
  check(await seen(f.getByText('Resoconto 1 di 1')), 'bounty thread chip');
  await f.getByText('Stampa in due rate').click();
  check(await seen(f.getByText('Resoconto, rata 1')), 'report card in the thread');
  await shot(f, 'thread');

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch(async e => {
  console.error(e);
  for (const { page, label } of ALL) {
    try {
      await page.screenshot({ path: `${SHOTS}/fail-${label.replace(/[^a-z0-9-]/gi, '')}.png`, fullPage: true });
      console.log(`--- ${label}:`, (await page.locator('main').innerText()).slice(0, 900).replace(/\n+/g, ' | '));
    } catch {}
  }
  process.exit(1);
});
