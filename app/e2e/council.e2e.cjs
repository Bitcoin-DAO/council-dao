// End-to-end (v0.5.0): a SeedSigner DAO replaces a lost key. Card C is reported lost; a council change gives
// @luca card D; the old council (cards A, B) signs the migration to the new treasury; after its receipt the
// new settings version is endorsed, and the next payout spends from the new treasury.
const { chromium } = require('playwright');
const { writeDownWords } = require('./words.cjs');
const fs = require('fs');
const { execFileSync } = require('child_process');

const URL0 = 'http://localhost:4173/';
const OUT = __dirname + '/out';
const SHOTS = OUT + '/shots-council';
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


const embitAddr = keys => execFileSync('python3', ['-c', `
from embit.descriptor import Descriptor
from embit.networks import NETWORKS
d=Descriptor.from_string("wsh(sortedmulti(2,${keys.map(k => CARDS[k] + '/0/*').join(',')}))")
print(d.derive(0).address(NETWORKS["test"]))`]).toString().trim();
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
async function signRound(a, mb) {
  await a.waitForURL(/#\/round\/[0-9a-f]{64}$/);
  const rid = a.url().split('/round/')[1];
  await signOnDevice(a, rid, 'A');
  await signOnDevice(mb, rid, 'B');
  await mb.getByText('Firme sufficienti ✓').waitFor({ timeout: 20000 });
  const before = broadcasts();
  await mb.getByRole('button', { name: 'Trasmetti la transazione' }).click();
  check(await seen(mb.getByText(/Sulla rete ✓/)), 'broadcast');
  return { rid, file: `${OUT}/${broadcasts().find(x => !before.includes(x))}` };
}

(async () => {
  const browser = await chromium.launch();
  const [A, B, C, F] = await Promise.all(['@anna', '@marco', '@luca', '@elena'].map(n => phone(browser, n)));

  log('Founding: 2 of 3, cards A, B, C');
  const codes = {};
  codes['@anna'] = await signUpHw(A.page, '@anna', CARDS.A);
  codes['@marco'] = await signUpHw(B.page, '@marco', CARDS.B);
  codes['@luca'] = await signUpHw(C.page, '@luca', CARDS.C);
  codes['@elena'] = await signUp(F.page, '@elena', false);
  const a = A.page;
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
  await open(B.page, '#/founder');
  await B.page.getByRole('button', { name: 'Approva e firma' }).click();
  for (const p of [A, B, C, F]) {
    await open(p.page, '#/founder');
    await p.page.getByRole('button', { name: 'Proteggi la chiave e continua' }).click({ timeout: 20000 });
    await p.page.getByText('Stampa la tua tessera d\'identità').waitFor({ timeout: 20000 });
  }
  const oldAddr = embitAddr(['A', 'B', 'C']);
  const newAddr = embitAddr(['A', 'B', 'D']);
  fs.writeFileSync(OUT + '/funded.json', JSON.stringify({ [oldAddr]: { value: 100000, txid: 'ce'.repeat(32) } }));

  log('@luca reports card C lost');
  const c = C.page;
  await open(c, '#/profile');
  await c.getByText('Tessera SeedQR e piastra perse?').click({ timeout: 20000 });
  await c.getByRole('button', { name: 'Avvisa il Consiglio che la mia chiave è persa' }).click({ timeout: 20000 });
  await c.getByText(/Il Consiglio è stato avvisato/).waitFor({ timeout: 15000 });

  log('@anna starts the council change from the report');
  await open(a, '#/council');
  await a.getByRole('button', { name: 'Avvia un cambio del Consiglio: nuova chiave per @luca' }).click({ timeout: 20000 });
  await a.waitForURL(/#\/new$/);
  check(await a.getByLabel('Tipo di proposta').inputValue() === 'change_council', 'the form opens on a council change');
  check(await a.getByLabel('Motivo').inputValue() === 'lost_key', 'reason: lost key');
  await a.getByLabel('Titolo', { exact: true }).fill('Nuova chiave per @luca');
  await a.getByLabel('Testo vincolante').fill('La tessera C è persa: @luca entra con la tessera D.');
  check(await seen(a.getByText(/Non ancora pronta: manca la chiave di chi entra/)), 'not ready before the key is scanned');
  check(await a.getByRole('button', { name: 'Firma e pubblica' }).isDisabled(), 'and cannot be published');
  await a.getByRole('button', { name: 'Scansiona la chiave di chi entra' }).click();
  await paste(a, CARDS.A);
  check(await seen(a.getByText(/questa chiave della tesoreria è già nel Consiglio/)), 'a card already on the council is refused');
  await a.getByRole('button', { name: 'Scansiona un\'altra chiave' }).click();
  await paste(a, CARDS.D);
  await a.getByText('6b7fa6f3 ✓').waitFor();
  const shown = (await a.locator('.addr').last().innerText()).replace(/\s+/g, '');
  check(shown === newAddr, `the new treasury address matches embit's for cards A, B, D (${shown})`);
  check(await seen(a.getByText('2 di 3')), 'still 2 of 3');
  check(!(await a.getByText(/le chiavi che restano non bastano/).count()), 'A and B can still sweep the old treasury: no warning');
  await shot(a, 'form');
  await a.getByRole('button', { name: 'Firma e pubblica' }).click();
  await a.waitForURL(/#\/p\/[0-9a-f]{64}$/);
  const pid = a.url().split('/p/')[1];
  check(await seen(a.getByText('6b7fa6f3 · SeedSigner', { exact: false })), 'proposal page: the incoming key');
  await voteAll([A, B, C, F], pid);
  await closeVote(a);

  log('The migration round: the whole balance to the new treasury');
  await open(a, '#/');
  await a.locator('.balance').filter({ hasText: /100/ }).first().waitFor({ timeout: 30000 });
  check(await seen(a.getByText('Nuova tesoreria (in arrivo)')), 'home: the incoming treasury is watched');
  await open(a, '#/round/new');
  check(await seen(a.getByText(/Cambio del Consiglio: tutto il saldo/)), 'prepare page: a migration');
  await a.getByRole('button', { name: 'Prepara la transazione' }).click({ timeout: 30000 });
  await a.getByText('Riepilogo').waitFor();
  await a.getByRole('button', { name: 'Firma e pubblica il giro' }).click();
  const mb = B.page;
  const mig = await signRound(a, mb);
  check(await seen(a.getByText('Nuova tesoreria')), 'round page: the output is the new treasury');
  const m = txOuts(mig.file);
  check(m.outs.length === 1 && m.outs[0][0] === newAddr && m.outs[0][1] > 99000, `one output, the whole balance less the fee, to the new treasury (${m.outs.map(o => o.join(' ')).join(', ')})`);
  check(/ALL OK/.test(execFileSync('python3', [__dirname + '/embit-check.py', mig.file]).toString()), 'signatures verify with embit');
  const migTxid = execFileSync('python3', ['-c', 'import sys,json\nfrom embit.transaction import Transaction\nprint(Transaction.parse(bytes.fromhex(json.load(open(sys.argv[1]))["hex"])).txid().hex())', mig.file]).toString().trim();

  log('Receipt, then the new settings version');
  check(await seen(a.getByText(/^Confermata nel blocco \d+\.$/), 90000) || (await open(a, `#/round/${mig.rid}`), await seen(a.getByText(/^Confermata nel blocco \d+\.$/), 60000)), 'receipt after 3 confirmations');
  await open(a, '#/council');
  check(await seen(a.getByText(/Consiglio dopo: .*6b7fa6f3/)), 'council page: the council after the change');
  await councilAction(a, 'Pubblica la versione 2 delle regole');
  await councilAction(mb, 'Approva la versione 2 delle regole');
  await open(F.page, '#/');
  await F.page.getByText('Tesoreria spostata (cambio del Consiglio)').waitFor({ timeout: 30000 }).catch(() => {});
  check(await seen(F.page.getByText('Tesoreria spostata (cambio del Consiglio)')), 'home: one movement for the move');
  check(!(await F.page.getByText('Nuova tesoreria (in arrivo)').count()), 'home: the new treasury is the treasury');
  await F.page.getByText(/Il descrittore/).first().click().catch(() => {});
  await shot(F.page, 'home-after');

  log('A payout from the new treasury');
  const f = F.page;
  await open(f, '#/new');
  await f.getByLabel('Titolo', { exact: true }).fill('Volantini');
  await f.getByLabel('Testo vincolante').fill('500 volantini per il meetup.');
  await f.getByLabel('Nome del beneficiario').fill('Tipografia');
  await f.getByLabel('Indirizzo bitcoin del beneficiario').fill(DEST);
  await f.getByLabel('Importo in sats').fill('30000');
  await f.getByLabel(/Sono io il beneficiario/).check();
  await f.getByRole('button', { name: 'Firma e pubblica' }).click();
  await f.waitForURL(/#\/p\/[0-9a-f]{64}$/);
  const pid2 = f.url().split('/p/')[1];
  await voteAll([A, B, C, F], pid2);
  await closeVote(a);
  await open(a, '#/round/new');
  await a.getByRole('button', { name: 'Prepara la transazione' }).click({ timeout: 30000 });
  await a.getByText('Riepilogo').waitFor();
  await a.getByRole('button', { name: 'Firma e pubblica il giro' }).click();
  const pay = await signRound(a, mb);
  const p = txOuts(pay.file);
  check(p.ins.length === 1 && p.ins[0] === migTxid, 'the payout spends the migration output (the new treasury)');
  check(p.outs.some(o => o[0] === DEST && o[1] === 30000), 'and pays 30000 to the recipient');
  check(/ALL OK/.test(execFileSync('python3', [__dirname + '/embit-check.py', pay.file]).toString()), 'signatures verify with embit');

  log('History');
  await open(f, '#/');
  await f.locator('nav.footer').getByRole('link', { name: 'Storia' }).click({ timeout: 30000 });
  await f.waitForURL(/#\/history$/);
  check(await seen(f.getByRole('heading', { name: 'Consiglio cambiato' })), 'history: council changed');
  check(await seen(f.getByText('Nuova chiave della tesoreria per @luca: ec03225a → 6b7fa6f3.')), 'history: the new key for @luca');
  check(await seen(f.getByText('Motivo: Chiave persa')), 'history: the reason');
  check(await seen(f.getByText('Spostamento della tesoreria:')), 'history: the migration tx');
  check(await seen(f.getByRole('heading', { name: 'Fondata' })), 'history: founded');
  check(await seen(f.getByText(/DAO su testnet/)), 'history: the stage at the top');
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
