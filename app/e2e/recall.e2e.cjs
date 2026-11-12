// End-to-end (v0.6.0): recall and removal of a council member, and replacing a declined round.
// A 2-of-3 SeedSigner council recalls @luca (2 of 2 on cards A, B); @luca is then removed from the DAO; a round
// @marco declines is replaced by one that also carries a payout approved since, on the same coin.
const { chromium } = require('playwright');
const { writeDownWords } = require('./words.cjs');
const fs = require('fs');
const { execFileSync } = require('child_process');

const URL0 = 'http://localhost:4173/';
const OUT = __dirname + '/out';
const SHOTS = OUT + '/shots-recall';
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


const DEST = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
async function councilAction(page, buttonName) {
  await open(page, '#/council');
  const b = page.getByRole('button', { name: buttonName, exact: true });
  await b.waitFor({ timeout: 20000 });
  await b.click();
  await b.waitFor({ state: 'detached', timeout: 20000 });
}


const CARDS = {
  A: `[d3bdd580/48h/1h/0h/2h]tpubDFKVE4hAcCsmYyXX8mURCAE3smjoLhyqGH5CtJjgyhBBQR9VopPxmK24XsjmbG4XTvHoQo73WBRnC2aLuG5mbUPemuyvUBJUEeDMM5nyG8e`,
  B: `[49c2d730/48h/1h/0h/2h]tpubDFUxuLmA93bTzumuAt8nqakLsDcNXk5ZB2mwZv1SxwX7u6THfmvdqBRrrBdkmCeLfQPcs8Rx3kEYsAZFYvQjSeJ6V1Q6dMn7Z7TzJHswBXU`,
  C: `[ec03225a/48h/1h/0h/2h]tpubDFCfvs2SLPX7J8JKkpaRQ6XKH2EksYsLNPAsucb9KDunGYemVrAm8VL4kNJ5Gm6icC3mBUinvirVXF5ZMatoCHuqmpAYKcmKUTLT7pMyXxE`,
};
const { UR, UREncoder } = require('@ngraveio/bc-ur');
const { HDKey } = require('@scure/bip32');
const { mnemonicToSeedSync } = require('@scure/bip39');
const { Transaction } = require('@scure/btc-signer');
const WORDS = {
  A: 'process wrestle rigid evoke cash ancient adjust minor size meat puzzle glue',
  B: 'tone define nominee garage idea web soul pizza luggage window tent loud',
  C: 'life deliver lawn corn chest awkward delay nest lunch cross hobby enroll', // testnet only
  D: 'require sting moon chicken brave loyal plunge mother faint chaos display year', // testnet only
};
CARDS.D = '[6b7fa6f3/48h/1h/0h/2h]tpubDDuqyuZ6pjotXF7ksPHZQFmp2R6X8dh9HkTd11T5yri3zegN3EkJzTcTmRvmfpi4Hoknae7JPYy4kHnMPUM8MgJcqVPn5LQSiELtiWuhFz4';
/** What a SeedSigner does with a PSBT and a loaded card: sign, trim, show as animated UR parts. */
function deviceSign(psbtB64, card) {
  const master = HDKey.fromMasterSeed(mnemonicToSeedSync(WORDS[card]), { private: 0x04358394, public: 0x043587cf });
  const tx = Transaction.fromPSBT(Buffer.from(psbtB64, 'base64'));
  for (let i = 0; i < tx.inputsLength; i++) tx.signIdx(master, i, [0x01]);
  const trimmed = new Transaction({ allowUnknownOutputs: true });
  for (let i = 0; i < tx.outputsLength; i++) { const o = tx.getOutput(i); trimmed.addOutput({ script: o.script, amount: o.amount }); }
  for (let i = 0; i < tx.inputsLength; i++) { const x = tx.getInput(i); trimmed.addInput({ txid: x.txid, index: x.index, sequence: x.sequence, partialSig: x.partialSig }); }
  const signed = Buffer.from(trimmed.toPSBT(0));
  const enc = new UREncoder(new UR(Buffer.concat([Buffer.from([0x59, signed.length >> 8, signed.length & 255]), signed]), 'crypto-psbt'), 100, 0, 10);
  return Array.from({ length: enc.fragmentsLength + 8 }, () => enc.nextPart()).slice(1).join('\n');
}
async function signOnDevice(page, rid, card, expectOk = true) {
  await open(page, `#/round/${rid}`);
  await page.getByText(/Firma con il SeedSigner/).waitFor({ timeout: 20000 });
  // The PSBT the device would scan from the animated QR (the page also offers it for other wallets).
  await page.getByRole('button', { name: /Firma con un altro wallet/ }).click();
  await page.getByRole('button', { name: 'Copia la PSBT' }).click();
  const psbt = await copied(page);
  await page.getByRole('button', { name: 'Fatto, avanti' }).click();
  await page.getByRole('button', { name: 'Ho firmato sul SeedSigner' }).click();
  await page.getByRole('button', { name: 'Scansiona la transazione firmata' }).click();
  await paste(page, deviceSign(psbt, card));
  if (expectOk) await page.getByText('Hai firmato ✓').waitFor({ timeout: 20000 });
  return psbt;
}
const DEVICE_A = fs.readFileSync(__dirname + '/../src/core/fixtures/seedsigner-0.8.6-xpub-card-a.txt', 'utf8').trim().split('\n').slice(5).join('\n');
async function signUpHw(page, name, scanned) {
  await page.goto(URL0 + '#/founder');
  await page.getByRole('textbox').fill(name);
  await page.getByLabel('Chiedo un posto nel Consiglio').check();
  await page.getByLabel(/Ho almeno 18 anni/).check();
  await page.getByRole('button', { name: 'Avanti' }).click();
  check(await page.getByLabel(/Su un SeedSigner/).isChecked(), `${name}: SeedSigner is the default`);
  check(await page.getByRole('button', { name: 'Crea con impronta o volto' }).isDisabled(), `${name}: no sign-up before the key is scanned`);
  await page.getByRole('button', { name: 'Scansiona la chiave dal SeedSigner' }).click();
  await paste(page, scanned);
  await page.getByText(/48h\/1h\/0h\/2h ✓/).waitFor();
  await page.getByRole('button', { name: 'Crea con impronta o volto' }).click();
  await page.getByRole('button', { name: 'Copia il codice' }).click({ timeout: 15000 });
  check(!(await page.getByText('Scrivi le 12 parole').count()), `${name}: no 12-word step`);
  return copied(page);
}


const embitAddr = (keys, m = 2, i = 0) => execFileSync('python3', ['-c', `
from embit.descriptor import Descriptor
from embit.networks import NETWORKS
d=Descriptor.from_string("wsh(sortedmulti(${m},${keys.map(k => CARDS[k] + '/0/*').join(',')}))")
print(d.derive(${i}).address(NETWORKS["test"]))`]).toString().trim();
const txOuts = file => JSON.parse(execFileSync('python3', ['-c', 'import sys,json\nfrom embit.transaction import Transaction\nfrom embit.networks import NETWORKS\nt=Transaction.parse(bytes.fromhex(json.load(open(sys.argv[1]))["hex"]))\nprint(json.dumps({"ins":[i.txid.hex() for i in t.vin],"outs":[[o.script_pubkey.address(NETWORKS["test"]), o.value] for o in t.vout]}))', file]).toString());
const broadcasts = () => fs.readdirSync(OUT).filter(x => x.startsWith('broadcast-'));
async function voteAll(pages, pid) {
  for (const p of pages) {
    await open(p.page, `#/p/${pid}`);
    await p.page.getByRole('button', { name: 'Sì', exact: true }).click();
    await p.page.getByText('Il tuo voto: Sì.').waitFor({ timeout: 15000 });
  }
}
async function closeVote(a) {
  log('Waiting for the close of the vote (~2 min)');
  await new Promise(r => setTimeout(r, 135000));
  await open(a, '#/council');
  await a.waitForTimeout(3000);
}
async function signRound(a, mb, more = []) {
  await a.waitForURL(/#\/round\/[0-9a-f]{64}$/);
  const rid = a.url().split('/round/')[1];
  await signOnDevice(a, rid, 'A');
  for (const [page, card] of more) await signOnDevice(page, rid, card);
  await signOnDevice(mb, rid, 'B');
  await mb.getByText('Firme sufficienti ✓').waitFor({ timeout: 20000 });
  const before = broadcasts();
  await mb.getByRole('button', { name: 'Trasmetti la transazione' }).click();
  check(await seen(mb.getByText(/Sulla rete ✓/)), 'broadcast');
  return { rid, file: `${OUT}/${broadcasts().find(x => !before.includes(x))}` };
}


async function propose(page, fill) {
  await open(page, '#/new');
  await fill();
  await page.getByRole('button', { name: 'Firma e pubblica' }).click();
  await page.waitForURL(/#\/p\/[0-9a-f]{64}$/);
  return page.url().split('/p/')[1];
}
async function payout(f, title, amount) {
  return propose(f, async () => {
    await f.getByLabel('Titolo', { exact: true }).fill(title);
    await f.getByLabel('Testo vincolante').fill(`${title}.`);
    await f.getByLabel('Nome del beneficiario').fill('Tipografia');
    await f.getByLabel('Indirizzo bitcoin del beneficiario').fill(DEST);
    await f.getByLabel('Importo in sats').fill(String(amount));
    await f.getByLabel(/Sono io il beneficiario/).check();
  });
}
const txid = file => execFileSync('python3', ['-c', 'import sys,json\nfrom embit.transaction import Transaction\nprint(Transaction.parse(bytes.fromhex(json.load(open(sys.argv[1]))["hex"])).txid().hex())', file]).toString().trim();

(async () => {
  const browser = await chromium.launch();
  const [A, B, C, F] = await Promise.all(['@anna', '@marco', '@luca', '@elena'].map(n => phone(browser, n)));

  log('Founding: 2 of 3, cards A, B, C');
  const codes = {};
  codes['@anna'] = await signUpHw(A.page, '@anna', CARDS.A);
  codes['@marco'] = await signUpHw(B.page, '@marco', CARDS.B);
  codes['@luca'] = await signUpHw(C.page, '@luca', CARDS.C);
  codes['@elena'] = await signUp(F.page, '@elena', false);
  const a = A.page, mb = B.page, f = F.page;
  await a.goto(URL0 + '#/setup');
  await a.getByRole('button', { name: '2 · Consiglio' }).click();
  for (const n of ['@marco', '@luca']) {
    await a.getByRole('button', { name: 'Scansiona un membro del Consiglio' }).click();
    await paste(a, codes[n]);
    await a.getByRole('button', { name: 'Coincide: aggiungi' }).click();
  }
  await a.getByRole('button', { name: '3 · Fondatori' }).click();
  await a.getByRole('button', { name: 'Scansiona un fondatore' }).click();
  await paste(a, codes['@elena']);
  await a.getByRole('button', { name: 'Coincide: aggiungi' }).click();
  await a.getByRole('button', { name: '4 · Pubblica' }).click();
  await a.getByRole('button', { name: 'Firma e pubblica' }).click();
  await a.getByText('Pubblicate ✓').waitFor({ timeout: 20000 });
  await open(mb, '#/founder');
  await mb.getByRole('button', { name: 'Approva e firma' }).click();
  for (const p of [A, B, C, F]) {
    await open(p.page, '#/founder');
    await p.page.getByRole('button', { name: 'Proteggi la chiave e continua' }).click({ timeout: 20000 });
    await p.page.getByText('Stampa la tua tessera d\'identità').waitFor({ timeout: 20000 });
  }
  fs.writeFileSync(OUT + '/funded.json', JSON.stringify({ [embitAddr(['A', 'B', 'C'])]: { value: 100000, txid: 'cf'.repeat(32) } }));

  log('A council member cannot be removed as a member first');
  await open(f, '#/new');
  await f.getByLabel('Tipo di proposta').selectOption('remove_member');
  const opts = await f.locator('label.field').filter({ hasText: /^\s*Membro/ }).locator('select').locator('option').allInnerTexts();
  check(!opts.includes('@luca'), `@luca (council) is not offered for removal (${opts.join(', ')})`);
  check(await seen(f.getByText(/prima un cambio del Consiglio \(motivo Revoca o Dimissioni\)/)), 'the form says how');

  log('Recall: @luca leaves the council, 2 of 3 → 2 of 2');
  const recallId = await propose(a, async () => {
    await a.getByLabel('Tipo di proposta').selectOption('change_council');
    await a.getByLabel('Motivo').selectOption('recall');
    await a.getByLabel('Chi esce dal Consiglio').selectOption({ label: '@luca · ec03225a' });
    await a.getByLabel('Titolo', { exact: true }).fill('Revoca di @luca');
    await a.getByLabel('Testo vincolante').fill('@luca lascia il Consiglio; servono 2 firme su 2.');
    check(await seen(a.getByText('2 di 2')), 'threshold 2 of 2');
    const shown = (await a.locator('.addr').last().innerText()).replace(/\s+/g, '');
    check(shown === embitAddr(['A', 'B']), `the new treasury matches embit's 2 of 2 on cards A, B (${shown})`);
    check(!(await a.getByText(/le chiavi che restano non bastano/).count()), 'A and B can still sign from the old treasury: no warning');
  });
  check(await seen(a.getByText('Revoca', { exact: true })), 'proposal page: the reason');
  await voteAll([A, B, C, F], recallId);
  await closeVote(a);
  await open(a, '#/round/new');
  await a.getByRole('button', { name: 'Prepara la transazione' }).click({ timeout: 30000 });
  await a.getByText('Riepilogo').waitFor();
  await a.getByRole('button', { name: 'Firma e pubblica il giro' }).click();
  const mig = await signRound(a, mb);
  const m = txOuts(mig.file);
  check(m.outs.length === 1 && m.outs[0][0] === embitAddr(['A', 'B']), 'migration: one output, to the 2-of-2 treasury');
  check(await (await open(a, `#/round/${mig.rid}`), seen(a.getByText(/^Confermata nel blocco \d+\.$/), 90000)), 'receipt');
  await councilAction(a, 'Pubblica la versione 2 delle regole');
  await councilAction(mb, 'Approva la versione 2 delle regole');
  await open(f, '#/members');
  check(await seen(f.getByText('4 membri · 2 nel Consiglio')), 'members: 4, 2 on the council');

  log('Removal of @luca, and a first payout, voted together');
  const removeId = await propose(f, async () => {
    await f.getByLabel('Tipo di proposta').selectOption('remove_member');
    await f.locator('label.field').filter({ hasText: /^\s*Membro/ }).locator('select').selectOption({ label: '@luca' });
    await f.getByLabel('Motivo', { exact: true }).fill('Revocato dal Consiglio, lascia la DAO');
    await f.getByLabel('Titolo', { exact: true }).fill('Rimozione di @luca');
    await f.getByLabel('Testo vincolante').fill('@luca lascia la DAO.');
  });
  const p1 = await payout(f, 'Volantini', 20000);
  for (const pid of [removeId, p1]) await voteAll([A, B, F], pid);
  await closeVote(a);
  await councilAction(a, 'Pubblica la versione 2');
  await councilAction(mb, 'Approva la versione 2');
  await open(f, '#/members');
  check(await seen(f.getByText('3 membri · 2 nel Consiglio')), 'members: 3, 2 on the council');
  check(!(await f.locator('main').getByText('@luca').count()), '@luca is no longer listed');

  log('A round @marco declines; a second payout passes; @anna replaces the round');
  await open(a, '#/round/new');
  await a.getByRole('button', { name: 'Prepara la transazione' }).click({ timeout: 30000 });
  await a.getByText('Riepilogo').waitFor();
  await a.getByRole('button', { name: 'Firma e pubblica il giro' }).click();
  await a.waitForURL(/#\/round\/[0-9a-f]{64}$/);
  const r1 = a.url().split('/round/')[1];
  await open(mb, `#/round/${r1}`);
  await mb.getByRole('button', { name: 'Rifiuta' }).click();
  await mb.locator('dialog textarea, .dialog textarea').first().fill('Manca il pagamento dei manifesti');
  await mb.getByRole('button', { name: 'OK', exact: true }).click();
  check(await seen(mb.getByText('@marco ha rifiutato: Manca il pagamento dei manifesti')), 'the decline is shown');
  const p2 = await payout(f, 'Manifesti', 15000);
  await voteAll([A, B, F], p2);
  await closeVote(a);
  await open(a, `#/round/${r1}`);
  await a.getByText('Il giro è bloccato o manca un pagamento?').click();
  await a.getByRole('button', { name: 'Sostituisci questo giro' }).click();
  await a.waitForURL(/#\/round\/new$/);
  check(await seen(a.getByText('Pagamenti nel nuovo giro')), 'replace page: the payouts to include');
  check(await seen(a.getByText(/Manifesti · approvato dopo/)), 'the payout approved since is offered');
  await a.getByRole('button', { name: 'Prepara la transazione' }).click({ timeout: 30000 });
  await a.getByText('Riepilogo').waitFor();
  await a.getByRole('button', { name: 'Firma e pubblica il giro' }).click();
  const rep = await signRound(a, mb);
  check(rep.rid !== r1, 'a new round');
  const q = txOuts(rep.file);
  check(q.outs.some(o => o[0] === DEST && o[1] === 20000) && q.outs.some(o => o[0] === DEST && o[1] === 15000), 'the replacement pays both payouts');
  check(q.ins.includes(txid(mig.file)), 'and spends the same coin as the declined round');
  check(/ALL OK/.test(execFileSync('python3', [__dirname + '/embit-check.py', rep.file]).toString()), 'signatures verify with embit');
  await open(a, `#/round/${r1}`);
  check(await seen(a.getByText('Questo giro è stato sostituito: non firmarlo.')), 'the declined round says it was replaced');
  for (const pid of [p1, p2]) {
    await open(f, `#/p/${pid}`);
    check(await seen(f.getByText(/Pagato|pagato/), 120000), `payout ${pid.slice(0, 6)} paid`);
  }

  log('A late payment to the old treasury (2 of 3, A, B, C) is swept to the 2-of-2 treasury');
  const lateAddr = embitAddr(['A', 'B', 'C'], 2, 1);
  const funded = JSON.parse(fs.readFileSync(OUT + '/funded.json', 'utf8'));
  funded[lateAddr] = { value: 30000, txid: 'ab'.repeat(32) };
  fs.writeFileSync(OUT + '/funded.json', JSON.stringify(funded));
  await open(a, '#/');
  await a.getByText('Tesoreria precedente').waitFor({ timeout: 60000 });
  await a.getByRole('button', { name: 'Spostali nella tesoreria' }).click({ timeout: 60000 });
  await a.waitForURL(/#\/sweep$/);
  const sweepTo = (await a.locator('.addr').first().innerText({ timeout: 60000 })).replace(/\s+/g, '');
  check(sweepTo === embitAddr(['A', 'B'], 2, 1), `the sweep goes to the treasury's first unused address (${sweepTo})`);
  await a.getByRole('button', { name: 'Prepara la transazione' }).click();
  await a.getByRole('button', { name: 'Firma e pubblica il giro' }).click();
  const sw = await signRound(a, mb);
  check(await seen(a.getByText(/^Recupero /)), 'the round is a sweep');
  const so = txOuts(sw.file);
  check(so.outs.length === 1 && so.outs[0][0] === embitAddr(['A', 'B'], 2, 1) && so.outs[0][1] > 29000, `one output, the late payment less the fee (${so.outs.map(o => o.join(' ')).join(', ')})`);
  check(so.ins.includes('ab'.repeat(32)), 'it spends the late payment');
  check(/ALL OK/.test(execFileSync('python3', [__dirname + '/embit-check.py', sw.file]).toString()), 'signatures verify with embit');

  log('History');
  await open(f, '#/history');
  check(await seen(f.getByText('Motivo: Revoca')), 'history: the recall');
  check(await seen(f.getByText('Esce: @luca (ec03225a).')), 'history: who left');
  check(await seen(f.getByText('Firme necessarie: 2/3 → 2/2.')), 'history: the threshold');
  await shot(f, 'history');

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
