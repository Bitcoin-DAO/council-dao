# COUNCIL DAO: v0.5.x in the wild (council change and growth)

**Release:** v0.5.1. **Network:** testnet4. **Council:** 2 of 3, one SeedSigner, SeedQR test cards A, B, C; card D (printed for this run) is the replacement. Test cards are testnet only.

## Plan

1. Found a 2-of-3 SeedSigner DAO with cards A, B, C (as SEEDSIGNER DAO), plus one founder on a phone.
2. Fund the treasury.
3. Card C plays the lost key: its holder opens Profile → "SeedQR card and plate lost?" → reports it.
4. On the Council page, "Start a council change: a new key for …". Scan card D's key export (Export Xpub → Multisig → Native Segwit → Sparrow). Check the new treasury address against Sparrow (cards A, B, D, 2 of 3). Publish; everyone votes.
5. After the tally: Prepare the round (the migration). Sign with cards A and B on the SeedSigner; check on the device that the single output is the new treasury address. Broadcast.
6. After the receipt: publish and approve the new settings version (Council page shows the council before and after).
7. Home: one "Treasury moved" movement, the balance in the new treasury.
8. A payout signed with card D and one other card: the new council works (the SeedSigner must load the new descriptor first).
9. History (footer): founding and the council change with the migration tx.
10. Growth (v0.5.1): the plain member proposes a council change, reason "A new council seat", joining with card C (now off the council), threshold 3 of 4. Check the new treasury address in Sparrow (cards A, B, C, D, 3 of 4). Everyone votes.
11. The migration is signed by the council in force (two of A, B, D). After the receipt, publish and approve settings version 3.
12. A payout signed with three cards, one of them C on the new member's phone. History shows both changes.
13. Optional: send a small amount to the old treasury address and check the home page shows it as "earlier treasury".

## Findings

**Founded** 11 November 2026, DAO id c2296c844748369e8dc140d85864486423e95b8b9812888ab00f7dc60d93725d; 2 of 3 on cards A, B, C.

1. **The fourth phone was left off the founders.** Its code was not scanned at setup step 3, so the founding went out without it. Its page then said "You are not listed: talk to the person preparing the founding", a dead end once the DAO is founded. It joined instead as a candidate (#/candidate: council check in person, add_member proposal COUNCIL-0001, vote, member list version 2), which worked. *Fix:* once founded, the not-listed page should say so and link to the member sign-up; the setup page could ask "no founders besides the council?" before publishing.
2. **"Closes in 14 minutes" on a 10-minute vote.** The phones' clocks differ by about 4 minutes; a proposal is dated by the phone that publishes it. Nothing limits how far ahead an event can be dated, so a fast clock stretches a vote, and a slow one could date a late vote inside it. *Fix:* the DAO relay refuses events dated more than ~2 minutes ahead of its clock; the app warns when the phone's clock is off.
3. Two council members checked the candidate's code; one in-person check is enough (the page counts every check signed: "3 ✓").
4. **Lost-key report told a SeedSigner member to type the words into the phone if found.** Bad practice for any key. Fixed in v0.5.2: found again by scanning the SeedSigner's key export (public part), matched by fingerprint. The "start a council change" flow from the report was clear.
5. **Members can outvote the council** (asked during the run): by design, members decide and the council carries out; the council's check is that nothing moves without its signatures and approvals. Quorum 1/3 lets the council alone meet quorum when members stay away (gap G-02).
6. **Migration round (COUNCIL-0002):** prepared, signed with cards A and B on the SeedSigner, broadcast, known to 3 of 3 sources; tx 042e2f08c02139f3…. After "Enough signatures ✓" the signing steps (descriptor QR open) still show on the signer's page; they could fold away once the round has enough signatures.
7. **Migration confirmed** (block at 10:21, 9,684 sats to the new treasury, fee 316). During the move Home showed the old treasury at 0 and "New treasury (on its way)" at 9,684, as designed. *Problem:* "Donate to the treasury" still showed the old treasury's address while the move was under way; donations there would need a sweep. *Fix:* once the migration is broadcast, the donate box shows the new treasury's address (or nothing until the settings version is in force).
8. **Settings version 2 published and approved;** History shows "Council changed": reason lost key, new treasury key for @CouncilC ec03225a → 6b7fa6f3, 2/3 → 2/3, the migration tx, COUNCIL-0002.
9. **A second approved payout while a round is open cannot get a round of its own.** By design (protocol 6, "no other round is open"): two rounds would spend the same treasury coins and only one could confirm. The payout waits and joins the next round once the open one has its receipt. *Gap found:* the protocol also allows a **replacement round** (one that spends at least one of the open round's coins), but the app offers no way to make one. A round that can never be completed (declined by too many council members, or a signer unavailable) therefore blocks all payouts. *Fix:* "Replace this round" for the council: a new round on the same coins, with the open round's payouts plus any newly approved ones (or without a disputed one); the old round becomes void when the new one confirms.
10. **"Something went wrong: not-signed-in" after the SeedSigner signed** (@CouncilC, card D, payout round). The phone's session had ended; the signature could not be published. The round page let the member go through all three SeedSigner steps signed out, and the error is the raw code. *Fix:* the signing card asks to sign in (passkey) before step 1, and "not-signed-in" gets a plain message with a Sign in button; keep the scanned signature so it can be published after signing in, without re-signing on the device.
11. **Card D signs:** payout round (COUNCIL-0004, 1,000 sats, change 6,928 back to the treasury, fee 378 at 2 sat/vB) signed by @CouncilC with card D and @CouncilA, broadcast, known to 2 of 3 sources. The replacement key works. The sign-outs in finding 10 came from the old phone reloading the tab when the camera opened (low memory); on retry the scan went through. The plain "not-signed-in" message is still worth fixing; no other change needed.
12. **Growth to 3 of 4 (COUNCIL-0005, "A new council seat"):** @Member joined with card C (ec03225a); migration 1017f568a6eb…; settings version 3 approved. Members page: 4 members, 4 on the council.
13. **Payout from the 3-of-4 treasury (COUNCIL-0006):** 1,000 sats, change 5,180 back to the treasury, fee 432; signed by @CouncilA, @CouncilB and @Member (3 of 3 needed), confirmed in block 160699 (tx 26a6d1c6f9b8a1cb…). History shows both council changes in order.
14. **Old phones:** two older devices could not run the camera reliably. Workaround that worked: @Member's identity restored from the identity card into Firefox on a good phone (#/restore), which then signed as @Member. One good phone with several browsers can stand in for several members. Worth a line in the guide.

**Result:** v0.5.1/v0.5.2 council change passed in the wild: lost key replaced (2 of 3 kept), council grown (2 of 3 → 3 of 4), both migrations confirmed, payouts signed by the new keys. Balance left: 5,180 sats, to be returned by closing the DAO (3 of 4 signatures).

## v0.6.0 plan (same DAO, 3 of 4 on cards A, B, C, D)

1. After the update, the Council page offers a new member-list version: it moves the "Council" mark for @Member (the expansion). Publish and approve it.
2. **Replace a round:** two payouts. Approve the first, prepare its round, and have one council member **decline** it. Approve the second. On the round page, "Is the round stuck, or a payout missing?" → **Replace this round**; both payouts are listed (the second marked "approved since"). Sign 3 of 4, broadcast. The declined round says it was replaced.
3. **Signing kept:** on the old phone, sign at step 3 and, if the tab reloads, sign in again: the round offers to publish the kept signature without signing on the SeedSigner again.
4. **Recall and removal:** recall one council member (Council change, reason Recall, who joins: nobody, threshold 3 of 3 or 2 of 3); migration signed by the others; settings version 4. Then a Remove member proposal for them; after the vote, the member-list version removes them (it can be the same version that clears their Council mark).
5. History shows the recall; Members shows the new council.

Coins: about 5,180 sats left; a top-up of ~10,000 sats makes steps 2 and 4 comfortable.
15. **v0.6.0:** replacement round worked (COUNCIL-0007 declined, replaced with COUNCIL-0007 + 0008 "approved since" on the same 10,000-sat coin). Recall of @CouncilC (COUNCIL-0009) passed and waits for the payout round. The round's transaction link said "not found" while the round showed "known to 2 of 3 sources": it opened the first source's explorer, which did not have it yet. Fixed in v0.6.1 (link to a source that knows it).
16. **Replacement paid; the migration round after it was "Not valid: another round is open".** The replaced (declined) round still counted as open in the one-round check, which ran before replaced rounds are marked void. Fixed in v0.6.2 (unit test added); the published migration round becomes valid.
17. **The recall's new treasury is an earlier one.** After recalling @CouncilC the council is cards A, B, C again (C with @Member), 2 of 3: the founding key set, and the same wallet SEEDSIGNER DAO used (same test cards). The migration pays to its first address, tb1qp6z…, already used two days ago by SEEDSIGNER DAO. Safe (the new council holds those keys), but the app compares treasuries by descriptor text (keys in council order), so the founding and post-recall treasuries look like two wallets. *To fix:* compare descriptors by keys and threshold; pay a migration to the first unused address (protocol change); guide: one key per DAO.
18. **Migration needed the third signature (3 of 4, old treasury):** @CouncilB's phone still ran v0.6.1 (round "Not valid", hidden) until reloaded.
19. **Transaction box before broadcast:** with 2 of 3 signatures, the round showed "Waiting for the first confirmation" with a mempool.space link: some source answered "known" for a transaction not yet sent. Not reproduced yet; watch for it.
20. **Explorer links → Blockbook** (v0.6.3), as asked.
21. **Recall and removal done (v0.6.x):** recall of @CouncilC (COUNCIL-0009) migrated 12,054 sats to the 2-of-3 A, B, C wallet, signed 3 of 4 by @CouncilA, @Member, @CouncilB; settings version 4; member list version 4 cleared @CouncilC's Council mark; @CouncilC removed in member list version 5. Members: 3, all on the council.

**v0.6 result:** replacement round, recall and removal passed in the wild. Fixes found on the way: v0.6.1 (explorer link), v0.6.2 (replaced round blocked the next one), v0.6.3 (Blockbook links), v0.6.4 (same wallet in another key order).

## v0.7.0 plan: sweep an earlier treasury

COUNCIL DAO has two earlier treasuries: A, B, D (2 of 3, after the lost key) and A, B, C, D (3 of 4, after the growth). The council (A, B, C with @Member) can sign from both.
1. Send ~1,000 sats to an unused address of the A, B, D treasury.
2. Home shows "Earlier treasury" with the amount and, for the council, **Move it to the treasury**.
3. The sweep page: the amount, the treasury's first unused address; prepare and publish.
4. The round page says it is a sweep and needs 2 signatures from A, B (D's holder is off the council). Sign with cards A and B; the SeedSigner loads the A, B, D descriptor in step 1. Broadcast.
5. After the receipt, Home's earlier-treasury card is gone and the balance includes the sweep.
