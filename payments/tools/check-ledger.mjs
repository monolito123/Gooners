// Runs the ledger DDL from docs/04-serverless-backend.md §3.2 in a throwaway PostgreSQL cluster,
// posts the §3.4 catalogue for the R$ 129,90 example, and checks invariants L1–L4,
// idempotent re-posting and the no-negative-balance rule.
// Needs PostgreSQL binaries (initdb, pg_ctl, psql). Exits 0 on success, 1 on failure, 2 if PostgreSQL is missing.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const doc = readFileSync(join(here, '..', 'docs', '04-serverless-backend.md'), 'utf8');
const ddl = doc.match(/```sql\n([\s\S]*?)```/)?.[1];
if (!ddl) throw new Error('no ```sql block found in 04-serverless-backend.md');

function pgBin(name) {
  const dirs = ['/usr/lib/postgresql'];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const v of readdirSync(d).sort().reverse()) {
      const p = join(d, v, 'bin', name);
      if (existsSync(p)) return p;
    }
  }
  const which = spawnSync('which', [name], { encoding: 'utf8' });
  return which.status === 0 ? which.stdout.trim() : null;
}

const initdb = pgBin('initdb');
const pgctl = pgBin('pg_ctl');
const psqlBin = pgBin('psql');
if (!initdb || !pgctl || !psqlBin) {
  console.log('ledger: SKIP (PostgreSQL binaries not found)');
  process.exit(2);
}

const base = mkdtempSync(join(tmpdir(), 'goonerspay-ledger-'));
const data = join(base, 'data');
const sock = base;
const port = String(54000 + Math.floor(Math.random() * 1000));
const asPg = process.getuid && process.getuid() === 0; // initdb refuses to run as root
const run = (cmd, args, opts = {}) => {
  if (asPg) {
    execFileSync('chown', ['-R', 'postgres', base]);
    return execFileSync('runuser', ['-u', 'postgres', '--', cmd, ...args], { encoding: 'utf8', ...opts });
  }
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts });
};

let ok = true;
const fail = (m) => {
  ok = false;
  console.log('  FAIL ' + m);
};
const pass = (m) => console.log('  ok   ' + m);

function psql(sql, { allowError = false } = {}) {
  const args = ['-h', sock, '-p', port, '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'];
  const r = asPg
    ? spawnSync('runuser', ['-u', 'postgres', '--', psqlBin, ...args], { input: sql, encoding: 'utf8' })
    : spawnSync(psqlBin, args, { input: sql, encoding: 'utf8' });
  if (r.status !== 0 && !allowError) throw new Error('psql failed: ' + r.stderr);
  return { out: r.stdout.trim(), err: r.stderr.trim(), status: r.status };
}

try {
  run(initdb, ['-D', data, '-A', 'trust', '-U', asPg ? 'postgres' : process.env.USER || 'postgres', '--no-sync'], { stdio: 'pipe' });
  run(pgctl, ['-D', data, '-o', `-k ${sock} -p ${port} -c listen_addresses=''`, '-w', 'start', '-l', join(base, 'log')], { stdio: 'pipe' });

  psql(ddl);
  pass('DDL from 04 §3.2 applies cleanly');

  const T = '00000000-0000-4000-8000-000000000001';
  const m = 'mer_01JB8Z2K5D6F7G8H9J0K1M2N3P';
  const accounts = [
    ['asset.scheme_receivable.visa', 'debit', 64],
    ['asset.settlement_bank', 'debit', 1],
    ['asset.safeguarding_reserve', 'debit', 64],
    ['asset.pix_settlement', 'debit', 1],
    [`liability.merchant_payable.${m}`, 'credit', 1],
    [`liability.merchant_wallet.${m}`, 'credit', 1],
    ['liability.pix_in_transit', 'credit', 1],
    ['revenue.mdr', 'credit', 64],
    ['revenue.advance_fees', 'credit', 1],
    ['expense.interchange', 'debit', 1],
    ['expense.scheme_fees', 'debit', 1],
    ['equity.opening', 'credit', 1],
  ];
  psql(
    accounts
      .map(([id, side, shards]) => `INSERT INTO ledger_accounts (tenant_id, account_id, code, currency, normal_side, shard_count) VALUES ('${T}', '${id}', '${id.split('.').slice(0, 2).join('.')}', 'BRL', '${side}', ${shards});`)
      .join('\n'),
  );
  const side = Object.fromEntries(accounts.map(([id, s, n]) => [id, { side: s, shards: n }]));

  // Mirror of the ledger service's posting procedure (04 §3.3).
  function post(journalId, key, type, lines) {
    const debits = lines.filter((l) => l[1] === 'debit').reduce((a, l) => a + l[2], 0);
    const credits = lines.filter((l) => l[1] === 'credit').reduce((a, l) => a + l[2], 0);
    if (lines.length < 2 || debits !== credits || lines.some((l) => l[2] <= 0)) {
      return { status: 'rejected_unbalanced' };
    }
    let h = 0;
    for (const c of journalId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const stmts = [
      'BEGIN ISOLATION LEVEL SERIALIZABLE;',
      `INSERT INTO journals (tenant_id, journal_id, idempotency_key, type, effective_date) VALUES ('${T}', '${journalId}', '${key}', '${type}', DATE '2026-10-29');`,
    ];
    lines.forEach(([acct, dir, amount], i) => {
      const shard = h % side[acct].shards;
      const delta = dir === side[acct].side ? amount : -amount;
      stmts.push(`INSERT INTO postings (tenant_id, journal_id, seq, account_id, shard, direction, amount, currency) VALUES ('${T}', '${journalId}', ${i}, '${acct}', ${shard}, '${dir}', ${amount}, 'BRL');`);
      stmts.push(
        `INSERT INTO balances (tenant_id, account_id, shard, balance, version) VALUES ('${T}', '${acct}', ${shard}, ${delta}, 1) ON CONFLICT (tenant_id, account_id, shard) DO UPDATE SET balance = balances.balance + ${delta}, version = balances.version + 1, updated_at = now();`,
      );
    });
    // Step 5: abort if a non-negative account would go below zero (all shards summed).
    stmts.push(
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM (SELECT b.account_id, SUM(b.balance) s FROM balances b JOIN ledger_accounts a USING (tenant_id, account_id) WHERE b.tenant_id = '${T}' AND NOT a.allow_negative GROUP BY b.account_id) x WHERE x.s < 0) THEN RAISE EXCEPTION 'negative_balance'; END IF; END $$;`,
    );
    stmts.push(`INSERT INTO outbox (tenant_id, topic, key, payload) VALUES ('${T}', 'ledger.journals.v1', '${journalId}', '{"type":"${type}"}');`);
    stmts.push('COMMIT;');
    const r = psql(stmts.join('\n'), { allowError: true });
    if (r.status === 0) return { status: 'posted' };
    if (/journals_tenant_id_idempotency_key_key|duplicate key/.test(r.err)) return { status: 'duplicate' };
    if (/negative_balance/.test(r.err)) return { status: 'rejected_negative' };
    throw new Error(r.err);
  }

  const W = `liability.merchant_wallet.${m}`;
  const P = `liability.merchant_payable.${m}`;
  const catalogue = [
    ['jr_open', 'k_open', 'opening_capital', [['asset.settlement_bank', 'debit', 10000000], ['equity.opening', 'credit', 10000000]]],
    ['jr_buffer', 'k_buffer', 'safeguard_topup', [['asset.safeguarding_reserve', 'debit', 100000], ['asset.settlement_bank', 'credit', 100000]]],
    ['jr_capture', 'k_capture', 'card_capture', [['asset.scheme_receivable.visa', 'debit', 12766], ['expense.interchange', 'debit', 208], ['expense.scheme_fees', 'debit', 16], [P, 'credit', 12576], ['revenue.mdr', 'credit', 414]]],
    ['jr_release', 'k_release', 'instant_release', [[P, 'debit', 12576], [W, 'credit', 12415], ['revenue.advance_fees', 'credit', 161]]],
    ['jr_topup', 'k_topup', 'safeguard_topup', [['asset.safeguarding_reserve', 'debit', 12415], ['asset.settlement_bank', 'credit', 12415]]],
    ['jr_prefund', 'k_prefund', 'pix_prefund', [['asset.pix_settlement', 'debit', 50000], ['asset.settlement_bank', 'credit', 50000]]],
    ['jr_send', 'k_send', 'payout_send', [[W, 'debit', 12415], ['liability.pix_in_transit', 'credit', 12415]]],
    ['jr_confirm', 'k_confirm', 'payout_confirm', [['liability.pix_in_transit', 'debit', 12415], ['asset.pix_settlement', 'credit', 12415]]],
    ['jr_safe_release', 'k_safe_release', 'safeguard_release', [['asset.settlement_bank', 'debit', 12415], ['asset.safeguarding_reserve', 'credit', 12415]]],
    ['jr_settle', 'k_settle', 'scheme_settlement', [['asset.settlement_bank', 'debit', 12766], ['asset.scheme_receivable.visa', 'credit', 12766]]],
  ];
  // L5 safeguarding: client liabilities (wallets + payouts in flight) never exceed the reserve.
  const l5 = () =>
    Number(
      psql(`SELECT COALESCE(SUM(CASE WHEN account_id LIKE 'liability.merchant_wallet.%' OR account_id LIKE 'liability.merchant_reserve.%' OR account_id = 'liability.pix_in_transit' THEN balance ELSE 0 END), 0)
              - COALESCE(SUM(CASE WHEN account_id = 'asset.safeguarding_reserve' THEN balance ELSE 0 END), 0) FROM balances;`).out,
    );
  let l5ok = true;
  // The reserve starts with a treasury buffer (04 §3.6), so an instant release is backed
  // before its own top-up lands. L5 must hold after every single journal.
  for (const [id, key, type, lines] of catalogue) {
    const r = post(id, key, type, lines);
    if (r.status !== 'posted') fail(`${type} expected posted, got ${r.status}`);
    if (l5() > 0) {
      l5ok = false;
      fail(`L5 violated after ${type}`);
    }
  }
  pass(`posted ${catalogue.length} journals from the 04 §3.4 catalogue`);
  if (l5ok) pass('L5 safeguarding held after every journal');

  const dup = post('jr_capture_retry', 'k_capture', 'card_capture', catalogue[1][3]);
  dup.status === 'duplicate' ? pass('re-posting with the same idempotency key is a no-op') : fail('duplicate key was not detected: ' + dup.status);

  const unbalanced = post('jr_bad', 'k_bad', 'card_capture', [[P, 'credit', 100], ['revenue.mdr', 'credit', 1]]);
  unbalanced.status === 'rejected_unbalanced' ? pass('unbalanced journal rejected') : fail('unbalanced journal accepted');

  const overdraw = post('jr_overdraw', 'k_overdraw', 'payout_send', [[W, 'debit', 1], ['liability.pix_in_transit', 'credit', 1]]);
  overdraw.status === 'rejected_negative' ? pass('payout beyond the wallet balance rejected (L3)') : fail('overdraw accepted: ' + overdraw.status);

  const l1 = psql(`SELECT count(*) FROM (SELECT journal_id FROM postings GROUP BY journal_id HAVING SUM(CASE direction WHEN 'debit' THEN amount ELSE -amount END) <> 0) x;`).out;
  l1 === '0' ? pass('L1 every journal balances') : fail('L1 unbalanced journals: ' + l1);

  const l2 = psql(`SELECT count(*) FROM (
      SELECT p.account_id, p.shard, SUM(CASE WHEN p.direction = a.normal_side THEN p.amount ELSE -p.amount END) s
      FROM postings p JOIN ledger_accounts a USING (tenant_id, account_id) GROUP BY p.account_id, p.shard) x
    FULL JOIN balances b ON b.account_id = x.account_id AND b.shard = x.shard
    WHERE x.s IS DISTINCT FROM b.balance;`).out;
  l2 === '0' ? pass('L2 balances equal the sum of postings') : fail('L2 mismatches: ' + l2);

  const l3 = psql(`SELECT count(*) FROM (SELECT account_id, SUM(balance) s FROM balances GROUP BY account_id) x WHERE s < 0;`).out;
  l3 === '0' ? pass('L3 no negative balances') : fail('L3 negatives: ' + l3);

  const l4 = psql(`SELECT SUM(CASE a.normal_side WHEN 'debit' THEN b.balance ELSE -b.balance END) FROM balances b JOIN ledger_accounts a USING (tenant_id, account_id);`).out;
  l4 === '0' ? pass('L4 trial balance is zero') : fail('L4 trial balance: ' + l4);

  const final = psql(`SELECT account_id || '=' || SUM(balance) FROM balances GROUP BY account_id ORDER BY account_id;`).out.split('\n');
  const want = {
    'asset.scheme_receivable.visa': '0',
    [W]: '0',
    [P]: '0',
    'liability.pix_in_transit': '0',
    'revenue.mdr': '414',
    'revenue.advance_fees': '161',
    'asset.safeguarding_reserve': '100000',
  };
  const got = Object.fromEntries(final.map((l) => l.split('=')));
  const bad = Object.entries(want).filter(([k, v]) => got[k] !== v);
  bad.length === 0 ? pass('end state: receivable, payable, wallet and in-transit closed; reserve back to its buffer; revenue R$ 4,14 + R$ 1,61') : fail('end state: ' + JSON.stringify(bad.map(([k]) => [k, got[k]])));
} finally {
  try {
    run(pgctl, ['-D', data, '-m', 'immediate', 'stop'], { stdio: 'pipe' });
  } catch {}
  rmSync(base, { recursive: true, force: true });
}
console.log(ok ? 'ledger: OK' : 'ledger: FAILED');
process.exit(ok ? 0 : 1);
