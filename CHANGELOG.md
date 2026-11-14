# Changelog

Each release is a git tag (`v0.1.1`). A DAO's copy runs one tagged release and records it in its README; a release moves to a DAO's next stage only after passing the one before ([guide, section 8](docs/guide.md#8-the-three-stages-practice-testnet-mainnet)).

## v0.8.5 · 14 November 2026

Found on COUNCIL DAO.
- **Preparing a round no longer waits for earlier treasuries.** The app showed the treasury only after reading every earlier one too (four on COUNCIL DAO, one address at a time from public explorers), so "Reading the treasury's current coins…" could last minutes. The treasury in force is now shown as soon as it is read; earlier treasuries are read afterwards in the background (the sweep page still waits for them).
- **Reading progress:** while the coins are read, the round page says how many addresses have been checked and which source is answering.
- **A payout in tranches that lapsed part-way** now says what was paid: "1 of 2 tranches paid (1,000 sats); tranche 2 lapsed on 14 November, with no report in time. The rest can be proposed again." Before, it read as if nothing had been paid.
- Test: the paid-on-delivery suite checks the new line.

## v0.8.4 · 14 November 2026

- **Payout to a member:** choosing the member now always fills in their name as the recipient (it can still be edited). Before, a name already in the box stayed, and the browser often put the phone owner's name there. Choosing no member clears the name and the member's standing address. The name box no longer offers the browser's autofill.
- Test: the payouts end-to-end suite checks both.
- Docs: descriptor floor (protocol 6.5), descriptor chain (6.6) and the watcher, from pull request #2; weakening is a broken floor line or a lower threshold.

## v0.8.3 · 13 November 2026

Found on COUNCIL DAO: two council phones published different final counts (one had not yet received a vote sent just before the close), and the proposal was stuck as disputed.

**Counts** (protocol 4.4)
- **The fuller count wins.** A count lists the votes it saw. When two counts differ, the one that saw every vote the other saw, and more, is the result: the other merely missed votes. Nobody chooses between counts; council approval of counts is gone from the protocol.
- **Counts correct themselves.** Within 10 minutes of the first count, a council phone that sees more votes than any count published publishes its own, which then wins. Counts dated later change nothing.
- **Counting waits after the close:** 90 seconds (a tenth of the vote in short practice votes) so votes sent just before the close reach the relays first.
- "Disputed" is left only for counts that each missed a different vote, or a count that does not add up; nothing is paid on such a proposal.

**The app's time**
- The app dates every vote, proposal and count, and decides when a vote is open or closed, by its own time: the phone's clock corrected by the time the site's server sends with each file (read on loading and every 10 minutes). A phone whose clock is off (as in "closes in 14 minutes" on a 10-minute vote) now dates its votes correctly.
- A note at the top when the phone's clock is 2 minutes or more off.
- The relay refuses events dated more than 10 minutes ahead of its clock (a backstop against a broken or tampered app).

**Other**
- **One proposal per form:** a second tap, or a retry after the address confirmation failed, no longer publishes the proposal again; the app opens the published proposal, where the address can be confirmed.

**Tests**
- Unit: the fuller count wins and settles; a different count that saw no more votes is a dispute; a count after the settle window changes nothing; the clock offset from a Date header.
- End-to-end: the suites wait past the close plus the counting pause.

## v0.8.2 · 13 November 2026

- **Paid in tranches:** with two or more tranches, the remove button (✕) took the whole row and squeezed the amount and days fields to nothing on a phone. It keeps its own small width now. The end-to-end test checks the fields' width and that the page has no sideways scroll.

## v0.8.1 · 13 November 2026

Fixes found while testing v0.8.0 on COUNCIL DAO.
- **Slow first load:** one relay that connected but never answered held the page on "Loading…" until the next 30-second refresh. Each read from the relays now ends after at most about 6.5 seconds with whatever arrived.
- **Paid in tranches:** ticking the box now scrolls the tranche fields into view (on a phone they opened below the screen), and the tranche row (amount, days) fits a phone screen.
- **Home:** "Sweep open: sign" is a button, centred, without the underline.

## v0.8.0 · 12 November 2026

**Paid on delivery** (protocol 4.6): staged payouts and bounties.
- **Staged payout:** a payout can be "paid in tranches, on delivery": up to 4 tranches (`maxTranches`) within 90 days of approval (`maxScheduleDays`), each with an amount and a due date in days after approval. The vote approves the whole schedule once.
- **Bounty:** a new choice in the proposal form. Its recipient is open: after approval, members claim it with their address (`dao.claim`), deliver and report; the council picks among those who claimed and reported when it prepares the round, and the round pays that claimant.
- **Reports** (`dao.report`): the proposer, the member being paid, or a bounty's claimant writes one per tranche on the proposal page. A tranche joins a round only after its report; the council's signature accepts the delivery, a decline with a reason rejects it, and the reporter can write again. With no report by the due date plus one round (practice mode: plus one voting period), the tranche lapses and so does the rest of the schedule.
- An ordinary payout can **ask for a report** after payment; it does not hold up the payment.
- **Where reports are read:** in Discussion, a chip on the thread ("Report 1 of 2") and a **Reports** filter; in the thread, each report is a card, marked paid once its tranche is paid; on the proposal page, the schedule with each tranche's status.
- **Committed:** the treasury card shows how much is promised in approved tranches not yet paid; the proposal form warns when a new schedule would promise more than the balance.
- Practice mode: a schedule day lasts the voting period / 7 (about 86 seconds with 10-minute votes).
- The relay accepts kinds 3591 and 3592.

**Other**
- The profile no longer says "Council members leave through a council change proposal."

**Tests**
- Unit: staged payout (schedule rules; report before each tranche; only the next tranche; lapse stops the rest; committed amount) and bounty (claims after the tally, members only; reports only by claimants; the round pays a claimant who reported).
- End-to-end (`e2e/delivery.e2e.cjs`): a 2-tranche payout and a bounty; reports and two claims; one round pays tranche 1 and the bounty to the claimant the council picked (checked with embit); tranche 2 lapses; the Reports filter and report cards in Discussion.

## v0.7.1 · 12 November 2026

- **"Propose a new member" lives on the Members page** only, under the member count and list version, for members signed in. Removed from the Proposals page and the profile; the new-proposal form's note links to the Members page.

## v0.7.0 · 12 November 2026

**Sweep rounds** (protocol 6.1)
- Coins that arrive at an earlier treasury after a council change can be moved into the treasury. On Home, the "Earlier treasury" card offers the council **Move it to the treasury**; the sweep page shows the amount and the treasury's first unused address, builds the round, and publishes it.
- A sweep round names the earlier treasury it empties and carries no proposals. Its single output goes to the current treasury. It needs that earlier treasury's threshold of signatures, from council members whose keys are in it; the round page says so, and shows the SeedSigner the earlier treasury's descriptor. It runs alongside the payout round: neither blocks the other.
- When the keys on the council can no longer sign from an earlier treasury, its card says the funds can be recovered only with the keys of those who left.
- The Council page counts an open sweep a member can sign as a to-do.

**Migration to an unused address** (protocol 6.1 changed)
- A council change's migration pays to the new treasury's **first receive address with no history on the chain**, read live; any of its first 20 receive addresses is valid, so every client can check a round later. Before, it was always the first address, which had been used before when a council returned to an earlier key set (COUNCIL DAO, finding 17).

**Tests**
- Unit: a sweep round (valid; wrong destination; the treasury in force refused as "earlier"; the earlier threshold; a payout round alongside it).
- End-to-end (`e2e/recall.e2e.cjs`): after the recall, a late payment to the old 2-of-3 treasury is swept to the 2-of-2 treasury's first unused address, signed with cards A and B, checked with embit.

## v0.6.5 · 12 November 2026

- **"Propose a new member" on the Proposals page** too, under New proposal, and as a link from the new-proposal form. It still opens the new-member flow (the candidate's code, the council's check, then the proposal); before, it was only on the profile.

## v0.6.4 · 12 November 2026

- **A council that returns to an earlier key set is recognised as the same treasury.** Treasuries are now compared by their keys and threshold, not by how the descriptor lists them. On COUNCIL DAO, recalling @CouncilC left cards A, B, C (2 of 3), the founding key set in another order: Home showed the same 12,054 sats twice, as the treasury and as an "earlier treasury". Now it shows once. While a move to such a wallet is under way, it shows as the new treasury, not as an earlier one.

## v0.6.3 · 12 November 2026

- **Block explorer links go to Blockbook** (the round's transaction, Home's "see it on the block explorer", History), through the chain gateway, when the DAO has a Blockbook source; otherwise the first source. Members found Blockbook the clearest. Replaces v0.6.1's "a source that knows it", which sent the link to mempool.space.

## v0.6.2 · 12 November 2026

- **Fixed: after a replaced round, the next round was refused ("another round is open").** A replaced round becomes void once its replacement is confirmed, but the check that only one round is open ran before that was worked out, so the replaced round still counted as open. Found on COUNCIL DAO: the council-change migration after a replacement was marked "Not valid". A round whose coin a confirmed round has already spent no longer counts as open. The migration round already published becomes valid with this version; nothing needs preparing again.

## v0.6.1 · 12 November 2026

- The transaction link on a round opens the explorer of a chain source that already knows the transaction. Before, it always opened the first source's explorer, which answered "not found" until that source had the transaction too (seen on COUNCIL DAO while the round showed "known to 2 of 3 sources").

## v0.6.0 · 11 November 2026

Fixes and gaps from the COUNCIL DAO run (`docs/runs/2026-11-council-dao.md`).

**Replacing a round**
- An open round that has not got enough signatures can be **replaced** by the council ("Is the round stuck, or a payout missing?" → **Replace this round**). The new round spends the same coins, so only one can confirm; it carries the open round's payouts and any approved since, and the council can leave one out (it goes back to waiting). The old round says it was replaced and is not broadcast; once the new one confirms, the old one is void. Signatures do not carry over. Before this, a declined or unsignable round blocked every later payout.

**Signing**
- A council member who is signed out sees "sign in first" on the round before the SeedSigner steps, with a Sign in button.
- A signature scanned back from the SeedSigner is kept on the phone until it is published: if the phone was signed out or the tab reloaded (old phones, camera), the member signs in and publishes it without signing on the device again.
- "not-signed-in" is now a plain message.
- Once a round has enough signatures, a council member who has not signed sees "not needed" instead of the signing steps.

**Other fixes**
- During a council change, **Donate** shows the new treasury's address, not the one being emptied.
- A founder left off the founders' list sees that the DAO is founded and a button to join as a member, instead of "talk to the person preparing the founding".
- The Remove member form explains that a council member is removed from the council first (council change, reason Recall or Resignation).
- **The member list follows council changes.** After a council change's migration has its receipt, the council publishes a new member list version that moves the "Council" mark (protocol, rosters: "a council change only once its migration round has a receipt"; this part was missing). Before, a recalled member stayed marked as council in the list, so a later proposal to remove them from the DAO passed but could never be applied. A removal can share a member-list version with the recall; the recall comes first.

**Tests**
- Unit: replacing an open round (coins, payouts carried and left out, void after the replacement confirms).
- End-to-end (`e2e/recall.e2e.cjs`): a council member recalled (2 of 3 → 2 of 2) and then removed from the DAO; a round declined by a council member is replaced by one that also pays a payout approved since, on the same coin.

## v0.5.2 · 11 November 2026

- **No more typing seed words after a lost-key report.** A council member who reported a lost SeedSigner key was told to type the words into the phone if they found them. That advice is gone: if the card or plate turns up, they load it on the SeedSigner and scan its key export (public only) from their profile; a matching fingerprint tells the council the key is back. The lost-key text speaks of the card and plate, not words.

## v0.5.1 · 11 November 2026

- **Growing the council:** a new council-change reason, **A new council seat** (`expansion`): someone joins, nobody leaves, and the threshold may change in the same proposal (2 of 3 → 3 of 4, say). Choosing it clears and locks "Who leaves". Protocol 4.1.2 updated.
- The form says which combination each reason needs when the choice does not fit.
- End-to-end: after the lost-key change, a plain member joins the council with card C (2 of 3 → 3 of 4); the second migration is signed by the council then in force, and a payout signed with three cards spends from the 3-of-4 treasury. History shows both changes.

## v0.5.0 · 10 November 2026

**Council change**: replacing a lost, resigned or recalled treasury key, adding or removing a council member, or changing the threshold. A multisig cannot drop a key, so every change moves the whole treasury to a new one (protocol 4.1.2, 6.1).

**The proposal**
- New proposal type **Council change**: the reason, who leaves, who joins (another member, or the same member with a new key after a lost card) and their SeedSigner key, scanned, and the signatures needed. The form shows the new council, the new treasury's first address and the full descriptor, and explains what is missing until it is complete.
- A lost-key report on the Council page offers **Start a council change**, prefilled for that member.
- If the keys that stay could not sign from the old treasury, the form and the proposal warn that anything sent there after the move could be lost (or recovered only with the outgoing key).
- Protocol 4.1.2: the incoming member may be the outgoing one with a new key; the optional `in_device` is copied to the new council entry.

**The move**
- Once the proposal passes, **Prepare the round** builds the migration: one output, the whole balance less the fee, to the new treasury. The old council signs it on their SeedSigners as for any round; the round page marks the output as the new treasury.
- After the receipt, the council endorses the new settings version; the Council page shows the council before and after.
- The home page follows the new treasury while the move is under way, then keeps watching earlier treasuries and shows one if anything arrives there. The move appears once in the movements, as "Treasury moved".
- Payout rounds after the change spend from the new treasury; the prepare page waits for a reading of the treasury in force.

**DAO history**
- **History** in the footer opens the DAO's history: founding, council changes (who left and joined, reason, threshold, the migration's transaction), rules and funding-model changes, closing, and any disputed version, each with its date, its proposal and the member and council counts at that date. Entries from DAO listings (address, software, listed) come later.

**Fixed**
- A vote changed within the same second as the previous one could lose to it (equal timestamps are ordered by event id). The app now dates each new event after the same key's previous one on the same subject.

**Tests**
- Unit: council-change checks (bad descriptor, outsider, threshold, migration to the wrong address, payout to the new treasury before its settings version).
- End-to-end (`e2e/council.e2e.cjs`): a 2-of-3 SeedSigner DAO, card C reported lost and replaced by card D; the migration signed with cards A and B and checked with embit; the next payout spends the migration's output; the history page.

## v0.4.0 · 10 November 2026

**SeedSigner founding and signing**: the mainnet flow, with every treasury key on a SeedSigner and none on a phone. Tested on a real SeedSigner (firmware 0.8.6) and passed in the wild on SEEDSIGNER DAO, from founding to closing (`docs/runs/2026-11-seedsigner-dao.md`). Formats recorded in `docs/seedsigner.md`.

**QR exchange with the SeedSigner**
- **Animated QRs** in UR format (the Sparrow standard), written for the app and matched part for part to the reference library; the phone's scanner collects the parts in any order and shows its progress.
- **Key export** read at sign-up (UR `crypto-account`), checked for network and path; a device left on the wrong network is told how to switch.
- **QR test page** (`#/qrtest`): scan keys, show a test wallet and transaction, scan the signed transaction back and see whose signature it carries. Nothing is published.

**Founding with SeedSigner keys**
- At council sign-up the treasury key goes **on a SeedSigner** (the default, and the only choice on mainnet) or, on testnet4, on the phone for practice. A SeedSigner key is scanned; there is no phone key and no 12-word step.
- The founding record notes which council keys are on SeedSigners. The setup page shows where each key lives, warns about a mixed council, and refuses a treasury key already on the council (one SeedSigner, several cards).
- The profile says where the key lives and keeps the lost-key report.

**Signing a round with a SeedSigner**
- Three steps on the round page: load the treasury wallet (descriptor QR; the device then verifies the change, S7), show the transaction (animated QR; check every address on the device, S1), scan the signed transaction back.
- The SeedSigner returns a trimmed transaction; the app puts its signatures back into the round's transaction, checks they are this member's, and publishes them. A wrong card is refused, naming the key needed.
- "Not enough funds" shows as soon as the prepare page opens, with the amount missing; the Council page offers no round meanwhile.

**Found in the run, fixed**
- **Receipts and forks:** a receipt was issued from mixed sources (one source's block, another's chain tip). Now each source's depth is measured against its own tip, the shallowest counts, and no receipt is issued while sources place the payment in different blocks; the round page says so.
- **Repeated votes:** tapping the current choice again publishes nothing; the record marks replaced votes as not counted.
- **QR codes** shrink to fit narrow phones.

**Tests**
- Unit: UR against the reference library and the real device's export; key reading; merging a trimmed signed PSBT; depth per source.
- End-to-end: the QR test page, and a SeedSigner DAO founded, funded, paid (cards A and B, a wrong card refused) and checked with embit.

## v0.3.1 · 9 November 2026

Found trying Discussion on TEST DAO.

- **A withdrawn draft is closed to new posts.** Its thread stays readable, with a line saying it is closed; posts dated after the withdrawal are ignored by every phone (protocol 4.5.3).

## v0.3.0 · 9 November 2026

The issues carried over from UNO's two runs (`docs/runs/`), and **Discussion**. Hardware keys move to v0.4.0 (`NEXT-RELEASE.md`).

**Discussion** (protocol 4.5, `docs/guide.md` 6.2.1)
- A **Discussion** page lists drafts and proposals by last activity, with what is new since this phone's last visit (a dot in the footer, a count per thread).
- **New idea:** a title and a line or two; the thread opens at once.
- **Versions:** the author posts v2, v3… with the proposal's fields; the newest is pinned at the top, the timeline below interleaves versions and posts.
- **Posts:** members only, plain text, links clickable; no editing or deleting. Anyone can read a thread from its shared link.
- **Submit:** the author submits a complete version as a proposal. Voting opens, the versions freeze, the thread carries on. The proposal page shows its **Discussion** and **Version**, and warns if the proposal differs from the version it names.
- **Withdraw:** the author can withdraw an unsubmitted draft; it stays visible, closed.
- New kinds 3587 (draft version), 3588 (post), 3589 (withdraw). The relay accepts them from any key, as it does every DAO kind; phones keep only members' posts, and the relay limits discussion events to 10 a minute per key.

**Treasury keys**
- **Council members write down the trial treasury key's 12 words at sign-up**, and type three of them back before the sign-up code is shown. Phones that already hold a key are asked on the profile, and signing waits for it.
- **A lost treasury key can be reported to the council** ("Tell the council my key is lost", new kind 3590). The Council page then shows the keys left against the threshold (spare, no spare, stuck), and the home page counts them. Typing the words back in clears it.

**Broadcasts and the chain**
- **A second broadcast by itself:** a minute after a broadcast, the app sends the transaction once more to the sources that do not know it yet; a council phone that sees an unconfirmed round does the same.
- **"Try again"** on the treasury reading waits 20 seconds after the last attempt.
- **`broadcastPages`** (optional config): the pages offered for "Send it by hand", which the app never reads.

**Tests**
- New end-to-end tests: **discussion**, and **closing a DAO** (close vote, the sweeping round checked independently, receipt, closing version, closed pages).
- Unit tests for discussion validation and key status; the 12-word step and the lost-key report in the payouts test.

**Deploying:** the relay must be redeployed for the new kinds (the "Deploy relay" workflow); until then phones cannot publish discussion events or key reports to the DAO's own relay.

## v0.2.8 · 9 November 2026

- **A closed DAO offers no new proposals.** The home page and the Proposals page no longer show "New proposal" or an empty "Open proposals" section once the DAO is closed; the home page links to the full record instead.

## v0.2.7 · 9 November 2026

Found when UNO DAO closed.

- **A closed DAO says so at the top of every page**, larger, under the header and the practice-mode banner, instead of a small box on the home page.
- **A closed DAO no longer invites funding**: the "Fund the treasury" card is gone once it is closed.

## v0.2.6 · 9 November 2026

Found when a council member of UNO DAO lost both the phone's data and the treasury key's 12 words.

- **Lost treasury words: the profile says what that means.** Under "type the 12 words", a council member now reads whether the treasury still works without their key (and that no spare is left), or that it is stuck, and that a council change gives them a new treasury key.

## v0.2.5 · 9 November 2026

Found during UNO DAO's rules change.

- **A passed rules or membership change says whether it is in force.** It takes effect only when the council signs the new version; the proposal now says "Approved, but not in force yet", with a link to the Council page, and later "In force ✓" with the version.
- **The software version shown on the Rules page is right again** (it still said 0.1.5).

## v0.2.4 · 9 November 2026

Found during UNO DAO's first payout round.

- **The gateway's broadcast report reads cleanly.** The gateway listed its services with " · ", which browsers read as "Â·" in a header; it now uses " | ", and the app reads both.
- **The gateway's two paths are told apart.** "Accepted by" and "Known to" named the gateway twice; they now say `(Blockbook)` and `(Esplora)` when two sources share one server.

## v0.2.3 · 9 November 2026

Found during UNO DAO's first payout proposal.

- **A disabled "Sign and publish" says what is missing** (for example the recipient's name), instead of staying grey without a reason.

## v0.2.2 · 9 November 2026

Found during UNO DAO's founding.

- **A missing sign-up passkey no longer blocks the last step.** If the phone says it has no passkey for the site when protecting the key (the passkey was deleted, or saved to another account), the app offers **Make a new passkey**: the key is still on the phone, in the sign-up, so it is protected with a new passkey instead. Applies to founders, new members and replaced keys.

## v0.2.1 · 9 November 2026

Found at the start of UNO DAO's 2-of-3 run.

- **Founding: the council size is the council you add.** The setup page showed "3 of 5" from the site file's five placeholder seats, though the council is whoever is added on the page. It now shows the real size, and the signatures needed follow it (2 of 3, 3 of 5) until changed by hand with − and +. At least 2 council members are needed to publish.

## v0.2.0 · 8 November 2026

The findings from UNO's practice run (6–8 November 2026, `docs/runs/2026-11-uno-practice.md`): 25 of 28 built, the rest noted in `MAINNET-READINESS.md`.

**Fees**
- A new rule, **round fees**: **fast** (the default) aims for the next block with a quarter more as headroom for the time signatures take, never under 2 sat/vB; **economical** aims for about an hour. Members change it by a rule-change vote.
- When the network asks more than the DAO's cap, the round goes at the cap with a warning, instead of being blocked.
- The round shows its fee as a share of what it pays, with its aim; the round page warns if the next-block fee has risen above the round's while signatures were collected.

**Broadcasts and confirmations**
- A broadcast goes to every chain source at once, and the round page lists which accepted, which refused and why, plus what a chain gateway reported for the services behind it. "Already known" counts as accepted.
- "On the network ✓" says which sources know the transaction.
- **Receipts wait for depth:** a council phone publishes the receipt only after 3 confirmations (`receiptConfirmations` in the config), so a reorg cannot leave a false receipt.
- Everyone's round page shows the confirmations as they grow ("Confirmed in block … (1 of 3)") and says when the receipt is waiting for a council member. It checks every 20 seconds.
- The Council page checks the chain: a round already on the network is no longer offered for broadcast or counted as a to-do.

**Treasury reading**
- The reading names its source ("Read from the blockchain: 15:24 · via blockbook.tbtc.zelcore.io · btc-dao-gateway").
- Open pages of the same site share one reading instead of each asking the chain.

**Chain gateway**
- Lets the app read which service answered and each broadcast's results; logs every broadcast's answers to the Worker's logs; answers the chain tip; keeps a shallow transaction's answer only briefly, so its confirmations can grow.

**Founding**
- On testnet4 the founders choose the vote length: **practice** (10-minute votes) or **live** (the site file's, 3 days by default). Members switch later by a rule-change vote; the DAO and its record carry on. A **practice mode** banner shows while votes are shorter than a day.
- A warning when the threshold equals the council size: one lost key would lock the treasury and block key replacement.
- After publishing the founding settings: who has approved, who has not yet, and what happens next.
- The first donation card is a **Fund the treasury** step, naming the BTC DAO Testnet Treasury on testnet.

**Members and keys**
- Key replacements that can never complete (the new key already in use, or a later one won) are hidden; a second replacement for a key already under way is stopped; replacing a council member's key when the others cannot reach the threshold is explained, not left waiting.
- The waiting pages say when an approved member or new key is waiting for the council to publish the member list; Sign in points a phone with a sign-up or replacement under way back to its page.
- After clearing a browser's data, the sign-in message explains that the passkey no longer has a key to open and points to the card or "I lost my key and card". Passkeys are named with the date they were made.
- A former member's profile shows only their record and **Join again**.
- Council pages opened while signed out offer Sign in and Come back with your card.

**Wording and pages**
- Browser translation is off (it rewrote "UNO" and proposals' binding text); the page's language is set before the first paint.
- "Remote" everywhere instead of "video call".
- Voting periods read in minutes, hours or days; vote-length changes are offered as 10 minutes, 1, 3 or 7 days.
- The home page says a round can be prepared as soon as payments are approved.
- Payout proposals: **Share** the recipient's confirmation link, with the DAO, proposal, amount and link in one message.
- The app's own confirmation dialogs, in its language, instead of the browser's.
- The identity card prints alone, on one page, without the browser's header and footer.

**Docs**
- Guide: own Google or Apple account per founder; practice or live votes; a spare key on the council.

**Tests**
- Unit (64): fee policy, depth from the chain tip, sources that know a transaction, broadcasting to every source, source names, vote length at founding. Gateway (18).
- End-to-end, Esplora, Blockbook and through the gateway: fast fee suggested, fee share and aim, sources named, depth shown to a member before the receipt, receipt after 3 confirmations; the card prints on one page; the header shows the member right after a restore; a former member is offered no member actions. The mock chain keeps mining so confirmations grow.

## v0.1.10 · 8 November 2026

Found in UNO's closing round: one of mempool.space's servers still reported the transaction while no miner had it, so the round page showed "On the network ✓" and offered no way to send it again.

**Broadcast again while unconfirmed**
- Until the round is confirmed, the round page keeps **Broadcast again** (sending twice is harmless), with a line saying when to use it.
- The signed transaction to copy and each source's broadcast page stay available under **Send it by hand**.

**Tests**
- End-to-end payout round through the chain gateway.

## v0.1.9 · 8 November 2026

Found in UNO's closing round: with mempool.space down, the app had no chain source it could read, although Zelcore's Blockbook was in sync throughout. It only refuses web pages.

**New: the chain gateway** (`gateway/`, design in `docs/chain-gateway.md`)
- A Cloudflare Worker per DAO, next to the relay, on the free plan. It reads the public chain services on the app's behalf and lets the DAO's site read the answers, so Zelcore's Blockbook becomes usable.
- Asks its sources in order, reuses answers briefly so open pages share one reading, refuses other sites' pages, and limits requests per visitor.
- Sends every broadcast to all its sources; "already known" counts as accepted.
- Answers in Blockbook's and Esplora's formats, so the app needs no change: the DAO's `chainApi` lists the gateway first.
- Holds no keys and cannot move coins.

**Tests**
- Gateway unit tests (15): reading, falling back, caching, "not found", allowed requests, origins, the limit, broadcasting to every source, transaction ids, redirects.
- End-to-end: the full payout round with the app reading the mock chain only through the gateway (`CHAIN=gateway bash app/e2e/run.sh payouts`).

## v0.1.8 · 8 November 2026

Found in UNO's closing round: the treasury could not be read ("/address/…: Failed to fetch"), while Blockbook answered in the browser. The message gave only the last failure, so nobody could tell which source failed or why.

**Chain errors name every source**
- When no source answers, the message lists each one with its own reason, for example "mempool.space: no answer in 30 s · blockbook.tbtc.zelcore.io: answers, but does not let this site read it".
- "Failed to fetch" is split in two: a source that cannot be reached, and one that answers but does not let web pages read the answer (no CORS header, often on a "too many requests" page).
- A 429 answer says "too many requests".

**Tests**
- Unit test: two failing sources are both named, each with its reason.

## v0.1.7 · 7 November 2026

Found before UNO's lost-key test: the identity card restores the identity key only, so a council member who restored from the card could vote but no longer sign rounds. In a 2-of-2 practice DAO that would have locked the treasury.

**Trial treasury key: type the 12 words back in**
- Profile → Treasury key: a council member whose phone has no trial treasury key gets a box for the 12 words.
- The words must give exactly the treasury key recorded for that member on the council (same fingerprint and xpub). Words of any other key are refused, so a typo cannot install the wrong key. Capitals and extra spaces are ignored.
- The round page and the Council page say when the key is missing, with a link to the box.
- Test networks only. On mainnet the treasury key stays on the SeedSigner and never touches the phone.

**Tests**
- End-to-end: a council phone loses its trial key, the round page flags it, another key's words are refused, its own words are accepted, and it signs the round.

## v0.1.6 · 6 November 2026

Found in UNO's practice run: the first payout round showed "Broadcast ✓", but neither mempool.space nor Blockbook had the transaction.

**A broadcast counts only when the network has it**
- A source has accepted a transaction only when it answers with that transaction's id. An unstable service can answer "OK" with a holding page, and that read as success.
- A transaction counts as on the network only when a source returns a real status for it. An error answer (Blockbook's "not found") or anything else means "not known".
- After a broadcast the round page names the source that took it ("Accepted by blockbook.tbtc.zelcore.io") and shows "On the network ✓" only once a source reports the transaction. It checks again every minute until the payment confirms.
- Until then the round page keeps **Broadcast again** (sending it twice is harmless) and the signed transaction to copy, with each source's broadcast page for doing it by hand.
- Council phones broadcast a ready round again by themselves if no source has seen it 10 minutes after they last sent it.

**Tests**
- Unit tests: an unknown transaction, an error answer and a holding page are not a status; a broadcast is accepted only with the transaction's id.
- End-to-end (Esplora and Blockbook): the round page names the accepting source, then shows the transaction on the network.

## v0.1.5 · 6 November 2026

Found in UNO's practice run: mempool.space's testnet4 indexer was unstable for most of the day, and it was the only source.

**A second chain source: Blockbook**
- `chainApi` entries can now be Blockbook servers, written `blockbook:<address>`, next to Esplora APIs. The app asks in Esplora's terms and translates Blockbook's answers for all six requests: address activity, transactions, unspent coins, transaction status, fee estimate and broadcast.
- Sources are asked in order; a source that fails is asked last for the next five minutes, so one slow source does not slow every request.
- The site's current `chainApi` is used first, then the one recorded at founding, so a founded DAO can add a source without a vote. A source shows data but never moves coins: every payment is checked against the treasury's descriptor.
- Explorer links and the manual broadcast page follow the first source (Blockbook: `/tx/<txid>` and `/sendtx`).
- Example config: Zelcore's testnet4 Blockbook (`blockbook:https://blockbook.tbtc.zelcore.io`) as the second source.

**Tests**
- Unit tests read UNO's practice treasury from Blockbook answers and fall back from a silent Esplora source.
- The end-to-end mock chain also answers as Blockbook (`CHAIN=blockbook bash e2e/run.sh payouts`): a full payout round, broadcast included, with Blockbook as the only source.

## v0.1.4 · 6 November 2026

Found in UNO's practice run: with mempool.space unstable, the treasury page kept loading or showed only an error.

**The treasury page shows what it last knew**
- Each phone remembers the last treasury reading and shows it at once, with the time it was read ("Read from the blockchain: 6 Nov, 13:48"), then refreshes in the background ("updating…"). A failed refresh shows "not updated, the blockchain is not answering" and keeps the balance.
- The funding address shows while the treasury is loading too.
- One reading at a time; a reading is refreshed after 5 minutes, at once after a payout round moves, and retried by itself at most every 2 minutes after a failure.
- A whole reading gives up after 2 minutes, and errors say what failed ("/address/…: no answer in 30 s").

**Payout rounds use only live coins**
- Preparing a round waits for a fresh reading of the treasury's coins and never builds from the remembered one.

## v0.1.3 · 6 November 2026

Found in UNO's practice run: with mempool.space working again, the treasury still timed out.

**Treasury page asks far less of the blockchain service**
- The treasury check looks 5 unused addresses past the last used one, not 20. The app only ever shows the first unused address and takes change in order, so used addresses stay contiguous. A new treasury now needs about 10 requests instead of 40.
- Requests go one at a time with a short pause, and each may take up to 30 seconds. mempool.space slows bursts down rather than refusing them, so later requests in a burst ran past the old 15-second limit.

**Docs**
- Testnet treasury log: 10,000 sats to UNO's practice.

## v0.1.2 · 6 November 2026

Found in UNO's practice run (2 of 2, two phones).

**Treasury page survives the blockchain service**
- Reading the treasury no longer sends bursts: two addresses at a time with a short pause, each request retried twice and given up after 15 seconds. mempool.space refused the old bursts, which reached the page only as "Failed to fetch", and a stalled request could leave the page loading for ever.
- When the blockchain cannot be read, the page still shows the treasury's funding address, worked out on the phone from the descriptor.

## v0.1.1 · 5 November 2026

**Remote founding without a call**
- Founder sign-up, code page: a **Share** button sends one message (DAO, role, pseudonym, short code and full code) through the phone's share sheet, or copies it where sharing is not available.
- The message names the role, **Council** or **Founder**, so a mistaken council request shows in the group.
- The code page's wording covers founding **in person** and **remote**.
- The setup page's paste box accepts the whole shared message, not only the bare code.
- The council box reads **I request a council seat**.

**Starting again**
- The code page has a **Start again** link.
- Starting the sign-up again also discards the setup draft, which belonged to the old identity.

**DAO-owned files**
- New `site/` folder: the DAO's own static pages and files, copied next to the app at build. Like `config/`, it belongs to the DAO and is never touched by updating btc-dao.

**Docs**
- BTC DAO Testnet Treasury: new dedicated wallet (`2N5SK7BFXGzefmMs9AHui2Y71fUh3uVVn2S`) and the first log entry.
- Guide: the remote route through the DAO's group at founding.

## v0.1.0

The testnet4 prototype: founding, passkey sign-in, identity cards, treasury, proposals and votes, membership, key replacement and payout rounds signed by the council. Tagged afterwards, at the commit the UNO stages were set up from.
